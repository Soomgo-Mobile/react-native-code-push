#!/usr/bin/env bash
#
# Builds the `hdiffz` / `hpatchz` command line tools that the CodePush CLI uses to
# generate and verify binary patches, and installs them into `.hdiffpatch-tools/`
# (git-ignored) at the repository root.
#
# The tools are built from source instead of being vendored as prebuilt binaries so
# that the exact upstream revision is reproducible on every platform and no opaque
# executable is committed to the repository.
#
# The `make` flags below disable every codec except zstd. That keeps the build to a
# single extra dependency (sisong/zstd, which must sit next to the HDiffPatch clone)
# and matches the patch format the appliers support: `hdiffz -f -m-6 -c-zstd-21-24`.
#
# Usage:
#   scripts/binary-patch/build-hdiffpatch.sh [--force]
#
# Environment:
#   HDIFFPATCH_TOOLS_DIR  install directory (default: <repo>/.hdiffpatch-tools)
#
set -euo pipefail

HDIFFPATCH_REPO="https://github.com/sisong/HDiffPatch.git"
HDIFFPATCH_TAG="v5.1.3"
# sisong/zstd is a fork of facebook/zstd that HDiffPatch's makefile expects as a
# sibling directory. It publishes no release tags, so it is pinned by commit: an
# unpinned default branch would silently change the generator on any upstream push,
# and this SHA is the snapshot the vendored decompressor sources came from.
ZSTD_REPO="https://github.com/sisong/zstd.git"
ZSTD_COMMIT="68c88c7c7ad22b5e6882a5296ef96d27dc8750c4"

force=0
for arg in "$@"; do
  case "$arg" in
    --force) force=1 ;;
    *)
      echo "error: unknown argument: $arg" >&2
      echo "usage: $0 [--force]" >&2
      exit 2
      ;;
  esac
done

script_dir=$(cd "$(dirname "$0")" && pwd)
repo_root=$(cd "$script_dir/../.." && pwd)
tools_dir="${HDIFFPATCH_TOOLS_DIR:-$repo_root/.hdiffpatch-tools}"

if [ "$force" -eq 0 ] && [ -x "$tools_dir/hdiffz" ] && [ -x "$tools_dir/hpatchz" ]; then
  echo "hdiffz/hpatchz already present in $tools_dir (pass --force to rebuild)"
  exit 0
fi

for tool in git make cc c++; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "error: '$tool' is required to build hdiffz/hpatchz" >&2
    exit 1
  fi
done

work_dir=$(mktemp -d)
cleanup() { rm -rf "$work_dir"; }
trap cleanup EXIT

echo "cloning $HDIFFPATCH_REPO @ $HDIFFPATCH_TAG"
git clone --quiet --depth 1 --branch "$HDIFFPATCH_TAG" "$HDIFFPATCH_REPO" "$work_dir/HDiffPatch"
echo "cloning $ZSTD_REPO @ $ZSTD_COMMIT"
# `git clone --branch` does not take a commit, so the pinned commit is fetched into an
# empty repository instead - still a single-commit download.
git init --quiet "$work_dir/zstd"
git -C "$work_dir/zstd" remote add origin "$ZSTD_REPO"
git -C "$work_dir/zstd" fetch --quiet --depth 1 origin "$ZSTD_COMMIT"
git -C "$work_dir/zstd" checkout --quiet FETCH_HEAD

jobs=$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)
echo "building hdiffz/hpatchz (zstd only, $jobs jobs)"
make -C "$work_dir/HDiffPatch" \
  BSD=0 LDEF=0 LZMA=0 MD5=0 VCD=0 BZIP2=0 ZLIB=0 ZSTD=1 DIR_DIFF=0 XXH=0 \
  -j"$jobs"

mkdir -p "$tools_dir"
cp "$work_dir/HDiffPatch/hdiffz" "$work_dir/HDiffPatch/hpatchz" "$tools_dir/"
chmod +x "$tools_dir/hdiffz" "$tools_dir/hpatchz"

echo "installed:"
echo "  $tools_dir/hdiffz"
echo "  $tools_dir/hpatchz"
