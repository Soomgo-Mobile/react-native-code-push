#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EXAMPLES_DIR="$ROOT_DIR/Examples"

RN_VERSIONS=(
  "0.77.3"
  "0.78.3"
  "0.79.7"
  "0.80.3"
  "0.81.6"
  "0.82.1"
  "0.83.2"
  "0.84.0"
)

FORCE_RECREATE=0
SKIP_SETUP=0
FAILED_E2E=()
PASSED_E2E=()
RUN_ANDROID=1
RUN_IOS=1
LEGACY_ARCH_MAX_MINOR=76
MAESTRO_ONLY=0
ONLY_SETUP=0

# CLI options:
# --force-recreate: remove and recreate existing Examples/RNxxxx app directories
# --skip-setup: skip app setup and run with the current workspace state
# --maestro-only: skip build and run Maestro flows only
# --only-setup: run setup only and skip E2E execution
# --only android|ios: run E2E for the selected platform only
# --legacy-arch-max-version <minor(2 digits)>: use legacy architecture setup for RN x.y.z when y <= given minor
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
    --legacy-arch-max-version)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --legacy-arch-max-version (e.g. 76 for 0.76.x)" >&2
        exit 1
      fi
      if ! [[ "$2" =~ ^[0-9]{2}$ ]]; then
        echo "Invalid value for --legacy-arch-max-version: $2 (expected exactly two digits, e.g. 76 or 81)" >&2
        exit 1
      fi
      LEGACY_ARCH_MAX_MINOR=$((10#$2))
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Usage: $0 [--force-recreate] [--skip-setup] [--maestro-only] [--only-setup] [--only android|ios] [--legacy-arch-max-version <minor(2 digits)>]" >&2
      exit 1
      ;;
  esac
done

run_cmd() {
  echo
  echo "[command] $*"
  "$@"
}

app_name_from_rn_version() {
  local version="$1"
  local compact="${version//./}"
  echo "RN${compact}"
}

should_use_legacy_architecture() {
  local rn_version="$1"
  local rn_minor
  if ! [[ "$rn_version" =~ ^[0-9]+\.([0-9]+)\.[0-9]+$ ]]; then
    echo "Invalid RN version format: $rn_version (expected: <major>.<minor>.<patch>)" >&2
    exit 1
  fi
  rn_minor=$((10#${BASH_REMATCH[1]}))
  [[ "$rn_minor" -le "$LEGACY_ARCH_MAX_MINOR" ]]
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

  local setup_args=(npm run setup-example-app -- -v "$rn_version")
  if should_use_legacy_architecture "$rn_version"; then
    setup_args+=(--disable-new-architecture)
  fi

  run_cmd "${setup_args[@]}"
}

run_e2e_for_app_platform() {
  local app_name="$1"
  local platform="$2"
  local e2e_args=(--app "$app_name" --platform "$platform")

  if [[ "$MAESTRO_ONLY" -eq 1 ]]; then
    e2e_args+=(--maestro-only)
  fi

  if run_cmd npm run e2e -- "${e2e_args[@]}"; then
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

  if [[ "$RUN_ANDROID" -eq 0 && "$RUN_IOS" -eq 0 ]]; then
    echo "Both platforms are skipped. Nothing to run."
    return 0
  fi

  for rn_version in "${RN_VERSIONS[@]}"; do
    local_app_name="$(app_name_from_rn_version "$rn_version")"
    setup_app_if_needed "$rn_version" "$local_app_name"
  done

  if [[ "$ONLY_SETUP" -eq 1 ]]; then
    echo "[done] setup completed (--only-setup)"
    return 0
  fi

  if [[ "$RUN_ANDROID" -eq 1 ]]; then
    echo
    echo "############################################################"
    echo "[E2E] platform=android (all versions)"
    echo "############################################################"
    for rn_version in "${RN_VERSIONS[@]}"; do
      local_app_name="$(app_name_from_rn_version "$rn_version")"
      echo
      echo "[ANDROID] version=$rn_version app=$local_app_name"
      run_e2e_for_app_platform "$local_app_name" "android"
    done
  fi

  if [[ "$RUN_IOS" -eq 1 ]]; then
    echo
    echo "############################################################"
    echo "[E2E] platform=ios (all versions)"
    echo "############################################################"
    for rn_version in "${RN_VERSIONS[@]}"; do
      local_app_name="$(app_name_from_rn_version "$rn_version")"
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
