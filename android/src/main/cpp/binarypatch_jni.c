/*
 * JNI entry point of the CodePush binary patch applier.
 *
 * The applier itself is the shared C code one directory tree up, which the host build and
 * the other platform compile as well; this file only moves data across the JNI boundary
 * and turns a failure into the result code `HDiffPatchNative` hands back to Java.
 *
 * Memory contract, the same one the host build documents:
 *   - the base bundle is held whole, because the patches are produced with `hdiffz -m`,
 *     which patches with random access to the base data
 *   - the patch is held whole, being far smaller than either bundle
 *   - the restored bundle is written sequentially to a file, so a patch session never
 *     holds two bundles at once
 *
 * A patch carries no checksum of the base data and its zstd streams carry no content
 * checksum, so a successful apply here is not proof of a correct result. The caller
 * verifies the base and target hashes; this file cannot.
 */

#include <jni.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>

#include <android/log.h>

#include "binarypatch_zstd_decompressor.h"
#include "libHDiffPatch/HPatch/patch.h"

#define LOG_TAG "ReactNative"
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

/* Mirrored by CodePushBinaryPatch.PatchApplier; the two lists have to stay in step. */
#define RESULT_OK 0
#define RESULT_INVALID_ARGUMENT 1
#define RESULT_IO_ERROR 2
#define RESULT_INVALID_HEADER 3
#define RESULT_UNSUPPORTED_COMPRESSION 4
#define RESULT_SIZE_MISMATCH 5
#define RESULT_APPLY_FAILED 6

/* Scratch buffer handed to patch_decompress_with_cache() to reduce stream reads. */
#define APPLY_CACHE_SIZE (1024 * 1024)

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

JNIEXPORT jint JNICALL
Java_com_microsoft_codepush_react_HDiffPatchNative_applyPatch(JNIEnv* env,
                                                             jclass clazz,
                                                             jbyteArray base,
                                                             jbyteArray patch,
                                                             jstring outputPath,
                                                             jlong expectedTargetSize) {
    jbyte* baseData = NULL;
    jbyte* patchData = NULL;
    const char* outputPathChars = NULL;
    unsigned char* cache = NULL;
    jsize baseSize = 0;
    jsize patchSize = 0;
    hpatch_compressedDiffInfo diffInfo;
    hpatch_TDecompress decompressor;
    hpatch_TStreamInput baseStream;
    hpatch_TStreamInput patchStream;
    hpatch_TStreamOutput targetStream;
    TSequentialFileWriter writer;
    hpatch_BOOL applied;
    int result = RESULT_OK;

    (void)clazz;

    if ((base == NULL) || (patch == NULL) || (outputPath == NULL) || (expectedTargetSize <= 0)) {
        return RESULT_INVALID_ARGUMENT;
    }

    baseSize = (*env)->GetArrayLength(env, base);
    patchSize = (*env)->GetArrayLength(env, patch);
    baseData = (*env)->GetByteArrayElements(env, base, NULL);
    patchData = (*env)->GetByteArrayElements(env, patch, NULL);
    outputPathChars = (*env)->GetStringUTFChars(env, outputPath, NULL);
    if ((baseData == NULL) || (patchData == NULL) || (outputPathChars == NULL)) {
        LOGE("[CodePush] out of memory while reading the binary patch inputs");
        result = RESULT_IO_ERROR;
        goto cleanup;
    }

    binarypatch_zstd_decompressor_init(&decompressor);

    if (!getCompressedDiffInfo_mem(&diffInfo, (const unsigned char*)patchData,
                                   (const unsigned char*)patchData + patchSize)) {
        LOGE("[CodePush] the binary patch header could not be read");
        result = RESULT_INVALID_HEADER;
        goto cleanup;
    }
    if ((strlen(diffInfo.compressType) > 0) && !decompressor.is_can_open(diffInfo.compressType)) {
        LOGE("[CodePush] the binary patch uses an unsupported codec: %s", diffInfo.compressType);
        result = RESULT_UNSUPPORTED_COMPRESSION;
        goto cleanup;
    }
    if (diffInfo.oldDataSize != (hpatch_StreamPos_t)baseSize) {
        LOGE("[CodePush] the binary patch expects a %llu byte base bundle, this one is %llu bytes",
             (unsigned long long)diffInfo.oldDataSize, (unsigned long long)baseSize);
        result = RESULT_SIZE_MISMATCH;
        goto cleanup;
    }
    if (diffInfo.newDataSize != (hpatch_StreamPos_t)expectedTargetSize) {
        LOGE("[CodePush] the binary patch produces %llu bytes, the manifest promises %llu",
             (unsigned long long)diffInfo.newDataSize, (unsigned long long)expectedTargetSize);
        result = RESULT_SIZE_MISMATCH;
        goto cleanup;
    }

    cache = (unsigned char*)malloc(APPLY_CACHE_SIZE);
    if (cache == NULL) {
        LOGE("[CodePush] out of memory while allocating the binary patch cache");
        result = RESULT_IO_ERROR;
        goto cleanup;
    }

    writer.file = fopen(outputPathChars, "wb");
    writer.writtenSize = 0;
    if (writer.file == NULL) {
        LOGE("[CodePush] the restored bundle could not be opened for writing");
        result = RESULT_IO_ERROR;
        goto cleanup;
    }

    mem_as_hStreamInput(&baseStream, (const unsigned char*)baseData, (const unsigned char*)baseData + baseSize);
    mem_as_hStreamInput(&patchStream, (const unsigned char*)patchData, (const unsigned char*)patchData + patchSize);
    memset(&targetStream, 0, sizeof(targetStream));
    targetStream.streamImport = &writer;
    targetStream.streamSize = diffInfo.newDataSize;
    targetStream.write = _write_sequential;

    applied = patch_decompress_with_cache(&targetStream, &baseStream, &patchStream, &decompressor,
                                          cache, cache + APPLY_CACHE_SIZE);
    if (fclose(writer.file) != 0) {
        LOGE("[CodePush] the restored bundle could not be flushed to disk");
        result = RESULT_IO_ERROR;
        goto cleanup;
    }
    if (!applied) {
        LOGE("[CodePush] applying the binary patch failed (decError=%d)", (int)decompressor.decError);
        result = RESULT_APPLY_FAILED;
        goto cleanup;
    }

cleanup:
    free(cache);
    if (outputPathChars != NULL) {
        (*env)->ReleaseStringUTFChars(env, outputPath, outputPathChars);
    }
    /* JNI_ABORT: neither array is written to, so nothing has to be copied back. */
    if (patchData != NULL) {
        (*env)->ReleaseByteArrayElements(env, patch, patchData, JNI_ABORT);
    }
    if (baseData != NULL) {
        (*env)->ReleaseByteArrayElements(env, base, baseData, JNI_ABORT);
    }

    return (jint)result;
}
