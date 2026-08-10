cmake_minimum_required(VERSION 3.13)

project(codepush-binarypatch C)

# The applier sources live outside the platform directories because the host build and
# the other platform compile the very same files. Referencing them where they are is
# what keeps the appliers of the platforms from drifting apart, so they are deliberately
# not copied into this directory.
set(BINARY_PATCH_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../../../../../cpp/binarypatch)

add_library(codepush-binarypatch SHARED
        ${CMAKE_CURRENT_SOURCE_DIR}/binarypatch_jni.c
        ${BINARY_PATCH_DIR}/binarypatch_zstd_decompressor.c
        ${BINARY_PATCH_DIR}/vendor/HDiffPatch/libHDiffPatch/HPatch/patch.c
        ${BINARY_PATCH_DIR}/vendor/zstd/common/debug.c
        ${BINARY_PATCH_DIR}/vendor/zstd/common/entropy_common.c
        ${BINARY_PATCH_DIR}/vendor/zstd/common/error_private.c
        ${BINARY_PATCH_DIR}/vendor/zstd/common/fse_decompress.c
        ${BINARY_PATCH_DIR}/vendor/zstd/common/xxhash.c
        ${BINARY_PATCH_DIR}/vendor/zstd/common/zstd_common.c
        ${BINARY_PATCH_DIR}/vendor/zstd/decompress/huf_decompress.c
        ${BINARY_PATCH_DIR}/vendor/zstd/decompress/zstd_ddict.c
        ${BINARY_PATCH_DIR}/vendor/zstd/decompress/zstd_decompress.c
        ${BINARY_PATCH_DIR}/vendor/zstd/decompress/zstd_decompress_block.c)

target_include_directories(codepush-binarypatch PRIVATE
        ${BINARY_PATCH_DIR}
        ${BINARY_PATCH_DIR}/vendor/HDiffPatch
        ${BINARY_PATCH_DIR}/vendor/zstd)

# ZSTD_DISABLE_ASM: the assembly fast path is intentionally not vendored.
# _IS_USED_MULTITHREAD=0: patches are applied on the thread that downloads them.
target_compile_definitions(codepush-binarypatch PRIVATE
        ZSTD_DISABLE_ASM=1
        _IS_USED_MULTITHREAD=0)

find_library(log-lib log)
target_link_libraries(codepush-binarypatch ${log-lib})
