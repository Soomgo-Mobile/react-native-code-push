#!/bin/bash
#
# Exports the JS bundle an Xcode build embeds in the app, so a later CodePush release can
# compute a binary patch against exactly the bytes the store binary ships.
#
# Add it as a "Run Script" build phase placed after "Bundle React Native code and images":
#
#     "$SRCROOT/../node_modules/@bravemobile/react-native-code-push/scripts/export-embedded-bundle.sh"
#
# The bundle and a `binary-patch-base.json` record describing it land in
# `$BUILD_DIR/codepush/embedded-bundle/$CONFIGURATION-$PLATFORM_NAME/`. Set
# CODEPUSH_EXPORT_DIR to export somewhere else; the `$CONFIGURATION-$PLATFORM_NAME`
# directory is appended to it either way, so builds of different configurations never
# overwrite each other.
#
# Builds that embed no bundle - Debug for the simulator, or any build run with
# SKIP_BUNDLING - have nothing to export, and the script exits without doing anything.

set -euo pipefail

if [[ -z "${CONFIGURATION_BUILD_DIR:-}" || -z "${UNLOCALIZED_RESOURCES_FOLDER_PATH:-}" || -z "${BUILD_DIR:-}" || -z "${CONFIGURATION:-}" || -z "${PLATFORM_NAME:-}" ]]; then
    echo "error: export-embedded-bundle.sh must run as an Xcode build phase; the build settings it needs are not set." >&2
    exit 1
fi

# The name React Native gives the bundle it writes into the app, which BUNDLE_NAME renames.
embedded_bundle="$CONFIGURATION_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/${BUNDLE_NAME:-main}.jsbundle"

if [[ ! -f "$embedded_bundle" ]]; then
    exit 0
fi

export_dir="${CODEPUSH_EXPORT_DIR:-$BUILD_DIR/codepush/embedded-bundle}/$CONFIGURATION-$PLATFORM_NAME"
mkdir -p "$export_dir"
cp "$embedded_bundle" "$export_dir/"

exported_bundle="$export_dir/$(basename "$embedded_bundle")"
bundle_hash="$(shasum -a 256 "$exported_bundle" | awk '{ print $1 }')"

# Read from the built product rather than the source Info.plist, where the versions are
# still unexpanded build settings.
binary_version=""
build_number=""
info_plist="$CONFIGURATION_BUILD_DIR/${INFOPLIST_PATH:-}"
if [[ -n "${INFOPLIST_PATH:-}" && -f "$info_plist" ]]; then
    binary_version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$info_plist" 2>/dev/null || true)"
    build_number="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$info_plist" 2>/dev/null || true)"
fi

# A build outside a git checkout still exports a usable record, just without the commit.
git_sha="$(git -C "${PROJECT_DIR:-$PWD}" rev-parse HEAD 2>/dev/null || true)"

# Record name and field names are a contract shared with the CodePush CLI
# (cli/functions/makeBinaryPatchBundle.ts) and the Android export script
# (android/codepush-export.gradle). Keep the three in step.
record_json=""

append_field() {
    local name="$1" value="$2"
    if [[ -z "$value" ]]; then
        return 0
    fi
    if [[ -n "$record_json" ]]; then
        record_json+=","$'\n'
    fi
    record_json+="  \"$name\": \"$value\""
}

append_field baseBundleHash "$bundle_hash"
append_field binaryVersion "$binary_version"
append_field buildNumber "$build_number"
append_field gitSha "$git_sha"

printf '{\n%s\n}\n' "$record_json" > "$export_dir/binary-patch-base.json"

echo "CodePush: exported the embedded bundle to $exported_bundle"
