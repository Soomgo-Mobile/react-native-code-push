/*
 * zstd decompressor for HDiffPatch.
 *
 * HDiffPatch's patch functions take the decompressor as a plugin, so every codec
 * the appliers must understand has to be supplied through `hpatch_TDecompress`.
 * CodePush patches are always produced with `hdiffz -f -m-6 -c-zstd-21-24`, so
 * zstd is the only codec implemented here; upstream ships a demo header covering
 * a dozen codecs, but pulling that in would drag along headers for codecs the
 * appliers never see.
 *
 * `hpatch_TDecompress` carries a mutable `decError` field, so each patch session
 * must own its instance. Callers therefore declare the struct themselves and
 * initialize it through `binarypatch_zstd_decompressor_init()`.
 *
 * This file and the vendored sources next to it sit outside the platform
 * directories because both platforms compile them: iOS through the podspec at the
 * repository root, Android through externalNativeBuild. One shared copy is what
 * keeps the two appliers from drifting apart.
 */

#ifndef BINARYPATCH_ZSTD_DECOMPRESSOR_H
#define BINARYPATCH_ZSTD_DECOMPRESSOR_H

#include "libHDiffPatch/HPatch/patch_types.h"

#ifdef __cplusplus
extern "C" {
#endif

/*
 * The `compressType` string that `hdiffz -c-zstd-...` writes into the patch
 * header, and the only value this decompressor accepts.
 */
#define BINARYPATCH_ZSTD_COMPRESS_TYPE "zstd"

/*
 * Fills `out_decompressor` with the zstd plugin implementation. The struct is
 * fully overwritten, so it needs no prior initialization, and it holds no state
 * that must be released.
 */
void binarypatch_zstd_decompressor_init(hpatch_TDecompress* out_decompressor);

#ifdef __cplusplus
}
#endif

#endif /* BINARYPATCH_ZSTD_DECOMPRESSOR_H */
