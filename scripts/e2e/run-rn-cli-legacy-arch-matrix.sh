#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EXAMPLES_DIR="$ROOT_DIR/Examples"
RN_TARGETS=()

FORCE_RECREATE=0
SKIP_SETUP=0
FAILED_E2E=()
PASSED_E2E=()
RUN_ANDROID=1
RUN_IOS=1
MAESTRO_ONLY=0
ONLY_SETUP=0
TARGET_MAX_MINOR=81 # Run only react-native < 0.82.x

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force-recreate)
      FORCE_RECREATE=1
      shift
      ;;
    --skip-setup)
      SKIP_SETUP=1
      shift
      ;;
    --maestro-only)
      MAESTRO_ONLY=1
      shift
      ;;
    --only-setup)
      ONLY_SETUP=1
      shift
      ;;
    --only)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --only (android|ios)" >&2
        exit 1
      fi
      case "$2" in
        android)
          RUN_ANDROID=1
          RUN_IOS=0
          ;;
        ios)
          RUN_ANDROID=0
          RUN_IOS=1
          ;;
        *)
          echo "Invalid platform for --only: $2 (expected: android|ios)" >&2
          exit 1
          ;;
      esac
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Usage: $0 [--force-recreate] [--skip-setup] [--maestro-only] [--only-setup] [--only android|ios]" >&2
      exit 1
      ;;
  esac
done

run_cmd() {
  echo
  echo "[command] $*"
  "$@"
}

run_cmd_in_dir() {
  local cwd="$1"
  shift

  echo
  echo "[command] (cd $cwd && $*)"
  (
    cd "$cwd"
    "$@"
  )
}

read_rn_version_from_app() {
  local app_name="$1"
  local app_package_json="$EXAMPLES_DIR/$app_name/package.json"

  if [[ ! -f "$app_package_json" ]]; then
    echo "Cannot find package.json for $app_name: $app_package_json" >&2
    return 1
  fi

  local rn_version
  if ! rn_version="$(
    node -e '
const fs = require("fs");
const pkgPath = process.argv[1];
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const rnVersion = (pkg.dependencies && pkg.dependencies["react-native"])
  || (pkg.devDependencies && pkg.devDependencies["react-native"]);
if (!rnVersion) {
  process.exit(1);
}
process.stdout.write(String(rnVersion));
' "$app_package_json"
  )"; then
    echo "Cannot resolve react-native version for $app_name from $app_package_json" >&2
    return 1
  fi

  echo "$rn_version"
}

is_target_rn_version() {
  local rn_version="$1"
  local rn_major
  local rn_minor

  if ! [[ "$rn_version" =~ ([0-9]+)\.([0-9]+)\.([0-9]+) ]]; then
    echo "Invalid RN version format: $rn_version (expected to include <major>.<minor>.<patch>)" >&2
    exit 1
  fi

  rn_major=$((10#${BASH_REMATCH[1]}))
  rn_minor=$((10#${BASH_REMATCH[2]}))

  [[ "$rn_major" -eq 0 && "$rn_minor" -le "$TARGET_MAX_MINOR" ]]
}

resolve_rn_targets() {
  local app_name
  local rn_version

  while IFS= read -r app_name; do
    [[ "$app_name" == "CodePushDemoApp" ]] && continue
    [[ "$app_name" == RN* ]] || continue

    rn_version="$(read_rn_version_from_app "$app_name")" || exit 1
    if is_target_rn_version "$rn_version"; then
      RN_TARGETS+=("${app_name}|${rn_version}")
    else
      echo "[skip] target excluded (requires react-native < 0.82): app=$app_name version=$rn_version"
    fi
  done < <(
    find "$EXAMPLES_DIR" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; \
      | sort
  )

  if [[ ${#RN_TARGETS[@]} -eq 0 ]]; then
    echo "No RN app found for legacy matrix (react-native < 0.82) under $EXAMPLES_DIR." >&2
    exit 1
  fi
}

setup_app_if_needed() {
  local rn_version="$1"
  local app_name="$2"
  local app_path="$EXAMPLES_DIR/$app_name"

  if [[ "$SKIP_SETUP" -eq 1 ]]; then
    echo "[skip] setup for $app_name (--skip-setup)"
    return
  fi

  if [[ -d "$app_path" ]]; then
    if [[ "$FORCE_RECREATE" -eq 1 ]]; then
      echo "[cleanup] removing existing app directory: $app_path"
      rm -rf "$app_path"
    else
      echo "[skip] app already exists: $app_path"
      return
    fi
  fi

  run_cmd npm run setup-example-app -- -v "$rn_version"
}

prepare_android_legacy_architecture() {
  local app_path="$1"
  local gradle_properties_path="$app_path/android/gradle.properties"
  local backup_path

  if [[ ! -f "$gradle_properties_path" ]]; then
    echo "[error] missing gradle.properties: $gradle_properties_path" >&2
    return 1
  fi

  backup_path="$(mktemp "${TMPDIR:-/tmp}/legacy-android-gradle-properties.XXXXXX")"
  cp "$gradle_properties_path" "$backup_path"

  if ! node -e '
const fs = require("fs");
const filePath = process.argv[1];
const original = fs.readFileSync(filePath, "utf8");
let next;
if (/^newArchEnabled\s*=.*$/m.test(original)) {
  next = original.replace(/^newArchEnabled\s*=.*$/m, "newArchEnabled=false");
} else {
  const suffix = original.endsWith("\n") ? "" : "\n";
  next = `${original}${suffix}newArchEnabled=false\n`;
}
fs.writeFileSync(filePath, next);
' "$gradle_properties_path"; then
    cp "$backup_path" "$gradle_properties_path"
    rm -f "$backup_path"
    return 1
  fi

  echo "$backup_path"
}

restore_android_legacy_architecture() {
  local app_path="$1"
  local backup_path="$2"
  local gradle_properties_path="$app_path/android/gradle.properties"

  if [[ ! -f "$backup_path" ]]; then
    echo "[warn] backup not found for restore: $backup_path" >&2
    return 1
  fi

  cp "$backup_path" "$gradle_properties_path"
  rm -f "$backup_path"
}

prepare_ios_legacy_architecture() {
  local app_path="$1"
  local ios_dir_path="$app_path/ios"

  if [[ ! -d "$ios_dir_path" ]]; then
    echo "[error] missing iOS directory: $ios_dir_path" >&2
    return 1
  fi

  run_cmd_in_dir "$ios_dir_path" env RCT_NEW_ARCH_ENABLED=0 bundle exec pod install
}

run_e2e_for_app_platform() {
  local app_name="$1"
  local platform="$2"
  local app_path="$EXAMPLES_DIR/$app_name"
  local e2e_args=(--app "$app_name" --platform "$platform")
  local android_backup_path=""
  local e2e_exit_code=0

  if [[ "$MAESTRO_ONLY" -eq 1 ]]; then
    e2e_args+=(--maestro-only)
  fi

  if [[ "$MAESTRO_ONLY" -eq 0 ]]; then
    if [[ "$platform" == "android" ]]; then
      echo "[prepare] android legacy architecture: app=$app_name"
      if ! android_backup_path="$(prepare_android_legacy_architecture "$app_path")"; then
        FAILED_E2E+=("${app_name}:${platform}")
        echo "[warn] failed to prepare Android legacy architecture (app=${app_name})"
        return
      fi
    else
      echo "[prepare] iOS legacy architecture pods: app=$app_name"
      if ! prepare_ios_legacy_architecture "$app_path"; then
        FAILED_E2E+=("${app_name}:${platform}")
        echo "[warn] failed to prepare iOS legacy architecture (app=${app_name})"
        return
      fi
    fi
  fi

  if [[ "$platform" == "ios" ]]; then
    if ! run_cmd env RCT_NEW_ARCH_ENABLED=0 npm run e2e -- "${e2e_args[@]}"; then
      e2e_exit_code=1
    fi
  else
    if ! run_cmd npm run e2e -- "${e2e_args[@]}"; then
      e2e_exit_code=1
    fi
  fi

  if [[ -n "$android_backup_path" ]]; then
    if ! restore_android_legacy_architecture "$app_path" "$android_backup_path"; then
      echo "[warn] failed to restore Android gradle.properties: $app_name"
      e2e_exit_code=1
    fi
  fi

  if [[ "$e2e_exit_code" -eq 0 ]]; then
    PASSED_E2E+=("${app_name}:${platform}")
  else
    FAILED_E2E+=("${app_name}:${platform}")
    echo "[warn] e2e failed (app=${app_name}, platform=${platform})"
  fi
}

print_e2e_summary() {
  echo
  echo "============================================================"
  echo "[E2E SUMMARY]"
  echo "============================================================"
  echo "passed: ${#PASSED_E2E[@]}"
  echo "failed: ${#FAILED_E2E[@]}"

  if [[ ${#FAILED_E2E[@]} -gt 0 ]]; then
    echo
    echo "Failed E2E targets:"
    for failed in "${FAILED_E2E[@]}"; do
      echo " - $failed"
    done
  fi
}

main() {
  cd "$ROOT_DIR"
  resolve_rn_targets

  if [[ "$RUN_ANDROID" -eq 0 && "$RUN_IOS" -eq 0 ]]; then
    echo "Both platforms are skipped. Nothing to run."
    return 0
  fi

  local target
  local local_app_name
  local rn_version

  for target in "${RN_TARGETS[@]}"; do
    IFS='|' read -r local_app_name rn_version <<< "$target"
    setup_app_if_needed "$rn_version" "$local_app_name"
  done

  if [[ "$ONLY_SETUP" -eq 1 ]]; then
    echo "[done] setup completed (--only-setup)"
    return 0
  fi

  if [[ "$RUN_ANDROID" -eq 1 ]]; then
    echo
    echo "############################################################"
    echo "[E2E] platform=android (react-native < 0.82)"
    echo "############################################################"
    for target in "${RN_TARGETS[@]}"; do
      IFS='|' read -r local_app_name rn_version <<< "$target"
      echo
      echo "[ANDROID] version=$rn_version app=$local_app_name"
      run_e2e_for_app_platform "$local_app_name" "android"
    done
  fi

  if [[ "$RUN_IOS" -eq 1 ]]; then
    echo
    echo "############################################################"
    echo "[E2E] platform=ios (react-native < 0.82)"
    echo "############################################################"
    for target in "${RN_TARGETS[@]}"; do
      IFS='|' read -r local_app_name rn_version <<< "$target"
      echo
      echo "[iOS] version=$rn_version app=$local_app_name"
      run_e2e_for_app_platform "$local_app_name" "ios"
    done
  fi

  print_e2e_summary

  if [[ ${#FAILED_E2E[@]} -gt 0 ]]; then
    return 1
  fi
}

main
