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

setup_app_if_needed() {
  local sdk="$1"
  local beta="$2"
  local app_name="$3"
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

  if [[ "$beta" == "true" ]]; then
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

  local sdk54_app="Expo54"
  local sdk55_beta_app="Expo55Beta"

  echo
  echo "============================================================"
  echo "[Expo] sdk=54 app=$sdk54_app"
  echo "============================================================"
  setup_app_if_needed "54" "false" "$sdk54_app"
  if [[ "$RUN_ANDROID" -eq 1 ]]; then
    run_e2e_for_app_platform "$sdk54_app" "android"
  fi
  if [[ "$RUN_IOS" -eq 1 ]]; then
    run_e2e_for_app_platform "$sdk54_app" "ios"
  fi

  echo
  echo "============================================================"
  echo "[Expo] sdk=55 beta app=$sdk55_beta_app"
  echo "============================================================"
  setup_app_if_needed "55" "true" "$sdk55_beta_app"
  if [[ "$RUN_ANDROID" -eq 1 ]]; then
    run_e2e_for_app_platform "$sdk55_beta_app" "android"
  fi
  if [[ "$RUN_IOS" -eq 1 ]]; then
    run_e2e_for_app_platform "$sdk55_beta_app" "ios"
  fi

  print_e2e_summary

  if [[ ${#FAILED_E2E[@]} -gt 0 ]]; then
    return 1
  fi
}

main
