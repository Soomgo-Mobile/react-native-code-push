#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EXAMPLES_DIR="$ROOT_DIR/Examples"

FORCE_RECREATE=0
SKIP_SETUP=0
FAILED_E2E=()
PASSED_E2E=()
RUN_ANDROID=1
RUN_IOS=1
EXPO_APPS=()

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
      echo "Usage: $0 [--force-recreate] [--skip-setup] [--only android|ios]" >&2
      exit 1
      ;;
  esac
done

run_cmd() {
  echo
  echo "[command] $*"
  "$@"
}

resolve_expo_apps() {
  local app_name

  while IFS= read -r app_name; do
    [[ "$app_name" == "CodePushDemoApp" ]] && continue
    [[ "$app_name" == Expo* ]] || continue
    EXPO_APPS+=("$app_name")
  done < <(
    find "$EXAMPLES_DIR" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; \
      | sort
  )

  if [[ ${#EXPO_APPS[@]} -eq 0 ]]; then
    echo "No Expo app found to run E2E under $EXAMPLES_DIR." >&2
    exit 1
  fi
}

parse_expo_app_name() {
  local app_name="$1"

  if [[ ! "$app_name" =~ ^Expo([0-9]+)(Beta)?$ ]]; then
    return 1
  fi

  local sdk="${BASH_REMATCH[1]}"
  local beta_suffix="${BASH_REMATCH[2]:-}"
  local is_beta="false"

  if [[ -n "$beta_suffix" ]]; then
    is_beta="true"
  fi

  echo "$sdk $is_beta"
}

setup_app_if_needed() {
  local app_name="$1"
  local app_path="$EXAMPLES_DIR/$app_name"
  local parsed
  local sdk
  local is_beta

  if [[ "$SKIP_SETUP" -eq 1 ]]; then
    echo "[skip] setup for $app_name (--skip-setup)"
    return
  fi

  if ! parsed="$(parse_expo_app_name "$app_name")"; then
    echo "[skip] setup for $app_name (unsupported app naming)"
    return
  fi
  read -r sdk is_beta <<< "$parsed"

  if [[ -d "$app_path" ]]; then
    if [[ "$FORCE_RECREATE" -eq 1 ]]; then
      echo "[cleanup] removing existing app directory: $app_path"
      rm -rf "$app_path"
    else
      echo "[skip] app already exists: $app_path"
      return
    fi
  fi

  if [[ "$is_beta" == "true" ]]; then
    run_cmd npm run setup-expo-example-app -- --sdk "$sdk" --beta
  else
    run_cmd npm run setup-expo-example-app -- --sdk "$sdk"
  fi
}

run_e2e_for_app_platform() {
  local app_name="$1"
  local platform="$2"

  if run_cmd npm run e2e -- --app "$app_name" --framework expo --platform "$platform"; then
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

  resolve_expo_apps

  local app_name
  for app_name in "${EXPO_APPS[@]}"; do
    echo
    echo "============================================================"
    echo "[Expo] app=$app_name"
    echo "============================================================"
    setup_app_if_needed "$app_name"
    if [[ "$RUN_ANDROID" -eq 1 ]]; then
      run_e2e_for_app_platform "$app_name" "android"
    fi
    if [[ "$RUN_IOS" -eq 1 ]]; then
      run_e2e_for_app_platform "$app_name" "ios"
    fi
  done

  print_e2e_summary

  if [[ ${#FAILED_E2E[@]} -gt 0 ]]; then
    return 1
  fi
}

main
