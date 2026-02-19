#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EXAMPLES_DIR="$ROOT_DIR/Examples"

RN_VERSIONS=(
  "0.74.7"
  "0.76.9"
  "0.79.7"
  "0.80.3"
  "0.81.6"
  "0.82.1"
  "0.83.2"
  "0.84.1"
)

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

app_name_from_rn_version() {
  local version="$1"
  local compact="${version//./}"
  echo "RN${compact}"
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

run_e2e_for_app() {
  local app_name="$1"

  run_cmd npm run e2e -- --app "$app_name" --platform android
  run_cmd npm run e2e -- --app "$app_name" --platform ios
}

main() {
  cd "$ROOT_DIR"

  for rn_version in "${RN_VERSIONS[@]}"; do
    local_app_name="$(app_name_from_rn_version "$rn_version")"

    echo
    echo "============================================================"
    echo "[RN CLI] version=$rn_version app=$local_app_name"
    echo "============================================================"

    setup_app_if_needed "$rn_version" "$local_app_name"
    run_e2e_for_app "$local_app_name"
  done
}

main
