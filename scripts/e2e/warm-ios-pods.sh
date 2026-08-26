#!/usr/bin/env bash
set -euo pipefail

# Copies an example app's installed CocoaPods from a checkout that already has them.
#
# `pod install` for React Native downloads the prebuilt artifact tarballs and then hands
# each one back to `/usr/bin/curl` as a `file://` URL to unpack it. Where reading a local
# file that way is not permitted, that step fails with `curl: (37) Couldn't open file` and
# the iOS build cannot start - even though the tarball is sitting right there. Copying an
# already-extracted `Pods` directory in means `pod install` finds everything it needs and
# skips the step entirely.
#
# Usage:
#   scripts/e2e/warm-ios-pods.sh --app RN0840 [--from /path/to/other/checkout]
#
# --from defaults to the main working tree of this repository, which is where a linked
# worktree can usually find a complete install.

APP_NAME=""
SOURCE_ROOT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --app" >&2
        exit 1
      fi
      APP_NAME="$2"
      shift 2
      ;;
    --from)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --from" >&2
        exit 1
      fi
      SOURCE_ROOT="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$APP_NAME" ]]; then
  echo "Usage: scripts/e2e/warm-ios-pods.sh --app <name> [--from <checkout>]" >&2
  exit 1
fi

TARGET_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [[ -z "$SOURCE_ROOT" ]]; then
  # The main working tree holds the shared git directory, so its parent is the checkout.
  common_dir="$(git -C "$TARGET_ROOT" rev-parse --path-format=absolute --git-common-dir)"
  SOURCE_ROOT="$(dirname "$common_dir")"
fi

SOURCE_APP="$SOURCE_ROOT/Examples/$APP_NAME"
TARGET_APP="$TARGET_ROOT/Examples/$APP_NAME"

if [[ "$SOURCE_APP" == "$TARGET_APP" ]]; then
  echo "Source and target are the same checkout; pass --from to name the one to copy from." >&2
  exit 1
fi

if [[ ! -d "$TARGET_APP" ]]; then
  echo "Example app not found: $TARGET_APP" >&2
  exit 1
fi

# An install that stopped at the prebuilt step leaves the artifacts but not the pod they
# unpack into, and copying that in would fail the same way. This is what tells them apart.
if [[ ! -d "$SOURCE_APP/ios/Pods/React-Core-prebuilt" ]]; then
  echo "No extracted pods to copy from: $SOURCE_APP/ios/Pods/React-Core-prebuilt" >&2
  echo "Run the iOS build once in that checkout first, or pass a different --from." >&2
  exit 1
fi

echo "[warm-ios-pods] from: $SOURCE_APP"
echo "[warm-ios-pods]   to: $TARGET_APP"

copy_tree() {
  local source="$1"
  local target="$2"
  local staged="${target}.warming"

  # Copied beside what is being replaced and swapped in once it is whole. A copy that
  # stops partway would otherwise leave the target with nothing, and a checkout with no
  # pods is exactly what this script exists to fix and cannot fix twice.
  rm -rf "$staged"
  # -c clones on APFS, so this costs almost no time and no disk until something diverges.
  cp -Rc "$source" "$staged" 2>/dev/null || cp -R "$source" "$staged"
  rm -rf "$target"
  mv "$staged" "$target"
}

copy_tree "$SOURCE_APP/ios/Pods" "$TARGET_APP/ios/Pods"

if [[ -f "$SOURCE_APP/ios/Podfile.lock" ]]; then
  cp "$SOURCE_APP/ios/Podfile.lock" "$TARGET_APP/ios/Podfile.lock"
fi

for workspace in "$SOURCE_APP/ios/"*.xcworkspace; do
  [[ -d "$workspace" ]] || continue
  copy_tree "$workspace" "$TARGET_APP/ios/$(basename "$workspace")"
done

echo "[warm-ios-pods] done; $(du -sh "$TARGET_APP/ios/Pods" | cut -f1) of pods in place"
echo "[warm-ios-pods] the next pod install will reuse them instead of unpacking the prebuilt artifacts"
