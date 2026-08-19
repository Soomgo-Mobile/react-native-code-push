#!/usr/bin/env bash
#
# Compiles the host build of the binary patch applier from the vendored sources in
# the tree this script lives in. The CLI test suite runs it to prove that the
# committed sources really do restore the target bundle byte for byte.
#
# Only the zstd decompress path of the vendored zstd copy is compiled; the
# compressor and the assembly fast path are not part of the applier.
#
# Usage:
#   build.sh [output-binary-path]   (default: <script dir>/build/apply_patch_host)
#
set -euo pipefail

script_dir=$(cd "$(dirname "$0")" && pwd)
root_dir=$(cd "$script_dir/.." && pwd)
out_bin="${1:-$script_dir/build/apply_patch_host}"

cc_bin="${CC:-cc}"
if ! command -v "$cc_bin" >/dev/null 2>&1; then
  echo "error: C compiler '$cc_bin' not found" >&2
  exit 1
fi

mkdir -p "$(dirname "$out_bin")"

# ZSTD_DISABLE_ASM: the amd64 assembly source is intentionally not vendored.
# _IS_USED_MULTITHREAD=0: patches are applied on a single thread.
"$cc_bin" -O2 -Wall \
  -DZSTD_DISABLE_ASM=1 \
  -D_IS_USED_MULTITHREAD=0 \
  -I"$root_dir" \
  -I"$root_dir/vendor/HDiffPatch" \
  -I"$root_dir/vendor/zstd" \
  "$script_dir/apply_patch_host.c" \
  "$root_dir/binarypatch_zstd_decompressor.c" \
  "$root_dir/vendor/HDiffPatch/libHDiffPatch/HPatch/patch.c" \
  "$root_dir/vendor/zstd/common/debug.c" \
  "$root_dir/vendor/zstd/common/entropy_common.c" \
  "$root_dir/vendor/zstd/common/error_private.c" \
  "$root_dir/vendor/zstd/common/fse_decompress.c" \
  "$root_dir/vendor/zstd/common/xxhash.c" \
  "$root_dir/vendor/zstd/common/zstd_common.c" \
  "$root_dir/vendor/zstd/decompress/huf_decompress.c" \
  "$root_dir/vendor/zstd/decompress/zstd_ddict.c" \
  "$root_dir/vendor/zstd/decompress/zstd_decompress.c" \
  "$root_dir/vendor/zstd/decompress/zstd_decompress_block.c" \
  -o "$out_bin"

echo "built: $out_bin"
