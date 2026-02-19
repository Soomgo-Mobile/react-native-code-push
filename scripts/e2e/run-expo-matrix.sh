#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EXAMPLES_DIR="$ROOT_DIR/Examples"

FORCE_RECREATE=0
SKIP_SETUP=0

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
    *)
      echo "Unknown option: $1" >&2
      echo "Usage: $0 [--force-recreate] [--skip-setup]" >&2
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

run_e2e_for_app() {
  local app_name="$1"

  run_cmd npm run e2e -- --app "$app_name" --framework expo --platform android
  run_cmd npm run e2e -- --app "$app_name" --framework expo --platform ios
}

main() {
  cd "$ROOT_DIR"

  local sdk54_app="Expo54"
  local sdk55_beta_app="Expo55Beta"

  echo
  echo "============================================================"
  echo "[Expo] sdk=54 app=$sdk54_app"
  echo "============================================================"
  setup_app_if_needed "54" "false" "$sdk54_app"
  run_e2e_for_app "$sdk54_app"

  echo
  echo "============================================================"
  echo "[Expo] sdk=55 beta app=$sdk55_beta_app"
  echo "============================================================"
  setup_app_if_needed "55" "true" "$sdk55_beta_app"
  run_e2e_for_app "$sdk55_beta_app"
}

main
