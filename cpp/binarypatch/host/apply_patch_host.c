/*
 * Host build of the CodePush binary patch applier.
 *
 * This is the reference implementation of the native applier contract, compiled
 * for the development machine so the CLI test suite can verify that the vendored
 * sources plus the zstd decompressor restore the exact target bytes. The Android
 * and iOS wrappers apply patches the same way.
 *
 * Memory contract:
 *   - old (the base bundle) is loaded whole; `hdiffz -m` patches require random
 *     access to the base data
 *   - patch is loaded whole; patches stay far smaller than the bundles
 *   - new (the target bundle) is written sequentially to a file, so the process
 *     never holds both bundles in memory
 *
 * Usage:
 *   apply_patch_host <old> <patch> <new-out>
 *
 * Exit codes let a caller tell why an apply failed, which is what decides between
 * retrying and falling back to a full bundle download:
 *   0  success
 *   1  bad arguments
 *   2  input/output file error
 *   3  patch header could not be parsed (corrupt header)
 *   4  patch uses a compression codec this applier does not support
 *   5  the base file size does not match what the patch expects
 *   6  applying the patch failed (corrupt or truncated patch body)
 *
 * Note: a compressed diff carries no checksum of the base data. Applying a patch
 * to a *different* base of the *same* size succeeds and silently produces wrong
 * output, so the caller must verify the base and target hashes itself.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "binarypatch_zstd_decompressor.h"
#include "libHDiffPatch/HPatch/patch.h"

/* Scratch buffer handed to patch_decompress_with_cache() to reduce stream reads. */
#define APPLY_CACHE_SIZE (4 * 1024 * 1024)

typedef struct {
    FILE*              file;
    hpatch_StreamPos_t writtenSize;
} TSequentialFileWriter;

static hpatch_BOOL _write_sequential(const hpatch_TStreamOutput* stream,
                                     hpatch_StreamPos_t writeToPos,
                                     const unsigned char* data,
                                     const unsigned char* data_end) {
    TSequentialFileWriter* self = (TSequentialFileWriter*)stream->streamImport;
    const size_t length = (size_t)(data_end - data);
    /* patch_decompress_with_cache() only ever appends; anything else is a bug. */
    if (writeToPos != self->writtenSize) {
        return hpatch_FALSE;
    }
    if (fwrite(data, 1, length, self->file) != length) {
        return hpatch_FALSE;
    }
    self->writtenSize += length;
    return hpatch_TRUE;
}

static unsigned char* read_whole_file(const char* path, size_t* out_size) {
    FILE* file = fopen(path, "rb");
    long size;
    unsigned char* buffer;
    if (!file) {
        return NULL;
    }
    if (fseek(file, 0, SEEK_END) != 0) {
        fclose(file);
        return NULL;
    }
    size = ftell(file);
    if ((size < 0) || (fseek(file, 0, SEEK_SET) != 0)) {
        fclose(file);
        return NULL;
    }
    /* malloc(0) may return NULL, which would be indistinguishable from failure. */
    buffer = (unsigned char*)malloc(size ? (size_t)size : 1);
    if (!buffer) {
        fclose(file);
        return NULL;
    }
    if (size && (fread(buffer, 1, (size_t)size, file) != (size_t)size)) {
        free(buffer);
        fclose(file);
        return NULL;
    }
    fclose(file);
    *out_size = (size_t)size;
    return buffer;
}

int main(int argc, char* argv[]) {
    const char* oldPath;
    const char* patchPath;
    const char* newPath;
    unsigned char* oldData = NULL;
    unsigned char* patchData = NULL;
    unsigned char* cache = NULL;
    size_t oldSize = 0;
    size_t patchSize = 0;
    hpatch_compressedDiffInfo diffInfo;
    hpatch_TDecompress decompressor;
    hpatch_TStreamInput oldStream;
    hpatch_TStreamInput patchStream;
    hpatch_TStreamOutput newStream;
    TSequentialFileWriter writer;
    hpatch_BOOL applied;
    int exitCode = 0;

    if (argc != 4) {
        fprintf(stderr, "usage: %s <old> <patch> <new-out>\n", argv[0]);
        return 1;
    }
    oldPath = argv[1];
    patchPath = argv[2];
    newPath = argv[3];

    oldData = read_whole_file(oldPath, &oldSize);
    if (!oldData) {
        fprintf(stderr, "error: cannot read old file: %s\n", oldPath);
        return 2;
    }
    patchData = read_whole_file(patchPath, &patchSize);
    if (!patchData) {
        fprintf(stderr, "error: cannot read patch file: %s\n", patchPath);
        free(oldData);
        return 2;
    }

    binarypatch_zstd_decompressor_init(&decompressor);

    if (!getCompressedDiffInfo_mem(&diffInfo, patchData, patchData + patchSize)) {
        fprintf(stderr, "error: cannot read patch header\n");
        exitCode = 3;
        goto cleanup;
    }
    if ((strlen(diffInfo.compressType) > 0) && !decompressor.is_can_open(diffInfo.compressType)) {
        fprintf(stderr, "error: unsupported compressType: %s\n", diffInfo.compressType);
        exitCode = 4;
        goto cleanup;
    }
    if (diffInfo.oldDataSize != (hpatch_StreamPos_t)oldSize) {
        fprintf(stderr, "error: old size mismatch: patch expects %llu, file is %llu\n",
                (unsigned long long)diffInfo.oldDataSize, (unsigned long long)oldSize);
        exitCode = 5;
        goto cleanup;
    }

    mem_as_hStreamInput(&oldStream, oldData, oldData + oldSize);
    mem_as_hStreamInput(&patchStream, patchData, patchData + patchSize);

    writer.file = fopen(newPath, "wb");
    writer.writtenSize = 0;
    if (!writer.file) {
        fprintf(stderr, "error: cannot open output file: %s\n", newPath);
        exitCode = 2;
        goto cleanup;
    }
    memset(&newStream, 0, sizeof(newStream));
    newStream.streamImport = &writer;
    newStream.streamSize = diffInfo.newDataSize;
    newStream.write = _write_sequential;

    cache = (unsigned char*)malloc(APPLY_CACHE_SIZE);
    if (!cache) {
        fprintf(stderr, "error: out of memory\n");
        fclose(writer.file);
        exitCode = 2;
        goto cleanup;
    }

    applied = patch_decompress_with_cache(&newStream, &oldStream, &patchStream, &decompressor,
                                          cache, cache + APPLY_CACHE_SIZE);
    if (fclose(writer.file) != 0) {
        fprintf(stderr, "error: cannot flush output file: %s\n", newPath);
        exitCode = 2;
        goto cleanup;
    }
    if (!applied) {
        fprintf(stderr, "error: patch apply failed (decError=%d)\n", (int)decompressor.decError);
        exitCode = 6;
        goto cleanup;
    }
    printf("ok: wrote %llu bytes to %s\n", (unsigned long long)writer.writtenSize, newPath);

cleanup:
    free(cache);
    free(patchData);
    free(oldData);
    return exitCode;
}
