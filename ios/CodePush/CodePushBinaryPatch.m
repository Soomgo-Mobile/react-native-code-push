#import "CodePushBinaryPatch.h"
#import "CodePush.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/*
 * The applier itself is the shared C code the other platform and the host build compile
 * as well, referenced where it lives rather than copied here, which is what keeps the
 * appliers of the platforms from drifting apart. It is included by this file alone, so
 * no C type reaches a header of this pod.
 */
#include "binarypatch_zstd_decompressor.h"
#include "libHDiffPatch/HPatch/patch.h"

NSString *const CodePushBinaryPatchReasonBaseBundleUnavailable = @"base_bundle_unavailable";
NSString *const CodePushBinaryPatchReasonBaseHashMismatch = @"base_hash_mismatch";
NSString *const CodePushBinaryPatchReasonInvalidManifest = @"invalid_manifest";
NSString *const CodePushBinaryPatchReasonUnsupportedFormat = @"unsupported_format";
NSString *const CodePushBinaryPatchReasonPatchApplyFailed = @"patch_apply_failed";
NSString *const CodePushBinaryPatchReasonTargetVerificationFailed = @"target_verification_failed";
NSString *const CodePushBinaryPatchReasonPackageVerificationFailed = @"package_verification_failed";

#pragma mark - Private constants

/*
 * The manifest a patch archive carries. These values are the format contract itself: the
 * CLI that writes a manifest and the applier of the other platform spell them exactly
 * this way, and an archive is unreadable to a client that spells them differently.
 */
static NSString *const BinaryPatchManifestFileName = @"codepush-binary-patch.json";
static NSString *const BinaryPatchAlgorithm = @"hdiffpatch-m-zstd";
static NSString *const BinaryPatchAlgorithmKey = @"algorithm";
static NSString *const BinaryPatchBaseBundleHashKey = @"baseBundleHash";
static NSString *const BinaryPatchBundlePathKey = @"bundlePath";
static NSString *const BinaryPatchFileKey = @"patchFile";
static NSString *const BinaryPatchFormatVersionKey = @"formatVersion";
static NSString *const BinaryPatchTargetBundleHashKey = @"targetBundleHash";
static NSString *const BinaryPatchTargetBundleSizeKey = @"targetBundleSize";
static const NSInteger BinaryPatchFormatVersion = 1;

/* The manifest of the assets to delete that a diff archive carries at its root. Paired
 * with CodePushPackage.m's DiffManifestFileName, which is file-local there as well. */
static NSString *const AssetDiffManifestFileName = @"hotcodepush.json";

/*
 * The largest bundle a patch is allowed to promise. A manifest is untrusted input, and
 * the size in it decides how much disk the restore asks for before a single byte of the
 * patch has been read. A large Hermes bundle stays under 50 MB, and a release that somehow
 * exceeds the bound still installs from its full archive, so the headroom below is generous
 * enough for the limit to only ever catch a manifest that is wrong. The other platform's
 * applier holds the same value.
 */
static const long long BinaryPatchMaxTargetBundleSize = 128LL * 1024 * 1024;

/** Name the restored bundle is written under, inside the working directory. */
static NSString *const BinaryPatchTargetFileName = @"target.bundle";

#pragma mark - Native applier

/* Scratch buffer handed to patch_decompress_with_cache() to reduce stream reads. */
#define APPLY_CACHE_SIZE (1024 * 1024)

/*
 * What the applier below reports.
 *
 * These are the result codes the other platform's wrapper hands back across its own
 * boundary, kept in step so both wrappers answer the same failure with the same reason.
 * The code that platform reserves for a native library that could not be loaded has no
 * counterpart here: the applier is linked into the app binary.
 */
typedef NS_ENUM(NSInteger, CodePushBinaryPatchApplyResult) {
    CodePushBinaryPatchApplyResultOK = 0,
    CodePushBinaryPatchApplyResultInvalidArgument = 1,
    CodePushBinaryPatchApplyResultIOError = 2,
    CodePushBinaryPatchApplyResultInvalidHeader = 3,
    CodePushBinaryPatchApplyResultUnsupportedCompression = 4,
    CodePushBinaryPatchApplyResultSizeMismatch = 5,
    CodePushBinaryPatchApplyResultApplyFailed = 6
};

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

/*
 * Applies a patch to a base bundle and writes the restored bundle to a file.
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
 * verifies the base and target hashes; this function cannot.
 */
static CodePushBinaryPatchApplyResult CodePushApplyBinaryPatch(const unsigned char* baseData,
                                                               size_t baseSize,
                                                               const unsigned char* patchData,
                                                               size_t patchSize,
                                                               const char* outputPath,
                                                               long long expectedTargetSize) {
    unsigned char* cache = NULL;
    hpatch_compressedDiffInfo diffInfo;
    hpatch_TDecompress decompressor;
    hpatch_TStreamInput baseStream;
    hpatch_TStreamInput patchStream;
    hpatch_TStreamOutput targetStream;
    TSequentialFileWriter writer;
    hpatch_BOOL applied;
    CodePushBinaryPatchApplyResult result = CodePushBinaryPatchApplyResultOK;

    if ((baseData == NULL) || (patchData == NULL) || (outputPath == NULL) || (expectedTargetSize <= 0)) {
        return CodePushBinaryPatchApplyResultInvalidArgument;
    }

    binarypatch_zstd_decompressor_init(&decompressor);

    if (!getCompressedDiffInfo_mem(&diffInfo, patchData, patchData + patchSize)) {
        CPLog(@"The binary patch header could not be read.");
        return CodePushBinaryPatchApplyResultInvalidHeader;
    }
    if ((strlen(diffInfo.compressType) > 0) && !decompressor.is_can_open(diffInfo.compressType)) {
        CPLog(@"The binary patch uses an unsupported codec: %s", diffInfo.compressType);
        return CodePushBinaryPatchApplyResultUnsupportedCompression;
    }
    if (diffInfo.oldDataSize != (hpatch_StreamPos_t)baseSize) {
        CPLog(@"The binary patch expects a %llu byte base bundle, this one is %llu bytes.",
              (unsigned long long)diffInfo.oldDataSize, (unsigned long long)baseSize);
        return CodePushBinaryPatchApplyResultSizeMismatch;
    }
    if (diffInfo.newDataSize != (hpatch_StreamPos_t)expectedTargetSize) {
        CPLog(@"The binary patch produces %llu bytes, the manifest promises %llu.",
              (unsigned long long)diffInfo.newDataSize, (unsigned long long)expectedTargetSize);
        return CodePushBinaryPatchApplyResultSizeMismatch;
    }

    cache = (unsigned char*)malloc(APPLY_CACHE_SIZE);
    if (cache == NULL) {
        CPLog(@"Out of memory while allocating the binary patch cache.");
        return CodePushBinaryPatchApplyResultIOError;
    }

    writer.file = fopen(outputPath, "wb");
    writer.writtenSize = 0;
    if (writer.file == NULL) {
        CPLog(@"The restored bundle could not be opened for writing.");
        free(cache);
        return CodePushBinaryPatchApplyResultIOError;
    }

    mem_as_hStreamInput(&baseStream, baseData, baseData + baseSize);
    mem_as_hStreamInput(&patchStream, patchData, patchData + patchSize);
    memset(&targetStream, 0, sizeof(targetStream));
    targetStream.streamImport = &writer;
    targetStream.streamSize = diffInfo.newDataSize;
    targetStream.write = _write_sequential;

    applied = patch_decompress_with_cache(&targetStream, &baseStream, &patchStream, &decompressor,
                                          cache, cache + APPLY_CACHE_SIZE);
    if (fclose(writer.file) != 0) {
        CPLog(@"The restored bundle could not be flushed to disk.");
        result = CodePushBinaryPatchApplyResultIOError;
    } else if (!applied) {
        CPLog(@"Applying the binary patch failed (decError=%d).", (int)decompressor.decError);
        result = CodePushBinaryPatchApplyResultApplyFailed;
    }

    free(cache);
    return result;
}

@implementation CodePushBinaryPatch

#pragma mark - Public methods

+ (BOOL)restoreBundleInUnzippedFolder:(NSString *)unzippedFolderPath
                        workingFolder:(NSString *)workingFolderPath
                        baseBundleURL:(NSURL *)baseBundleURL
                        failureReason:(NSString **)failureReason
{
    NSFileManager *fileManager = [NSFileManager defaultManager];
    NSString *contentsFolderPath = [self contentsFolderInUnzippedFolder:unzippedFolderPath];
    NSString *manifestFilePath = [contentsFolderPath stringByAppendingPathComponent:BinaryPatchManifestFileName];
    if (![self isFileAtPath:manifestFilePath]) {
        return [self failWithReason:CodePushBinaryPatchReasonInvalidManifest
                   outFailureReason:failureReason];
    }

    NSError *error = nil;
    NSData *manifestData = [NSData dataWithContentsOfFile:manifestFilePath
                                                  options:0
                                                    error:&error];
    id manifest = manifestData ? [NSJSONSerialization JSONObjectWithData:manifestData
                                                                options:kNilOptions
                                                                  error:&error]
                               : nil;
    if (![manifest isKindOfClass:[NSDictionary class]]) {
        CPLog(@"The binary patch manifest could not be read: %@", error);
        return [self failWithReason:CodePushBinaryPatchReasonInvalidManifest
                   outFailureReason:failureReason];
    }

    if ([[self numberInManifest:manifest forKey:BinaryPatchFormatVersionKey] integerValue] != BinaryPatchFormatVersion
        || ![BinaryPatchAlgorithm isEqualToString:[self stringInManifest:manifest forKey:BinaryPatchAlgorithmKey]]) {
        return [self failWithReason:CodePushBinaryPatchReasonUnsupportedFormat
                   outFailureReason:failureReason];
    }

    NSString *targetBundleFilePath = [self pathInsideFolder:contentsFolderPath
                                               relativePath:[self stringInManifest:manifest forKey:BinaryPatchBundlePathKey]];
    NSString *patchFilePath = [self pathInsideFolder:contentsFolderPath
                                        relativePath:[self stringInManifest:manifest forKey:BinaryPatchFileKey]];
    NSString *baseBundleHash = [self stringInManifest:manifest forKey:BinaryPatchBaseBundleHashKey];
    NSString *targetBundleHash = [self stringInManifest:manifest forKey:BinaryPatchTargetBundleHashKey];
    long long targetBundleSize = [[self numberInManifest:manifest forKey:BinaryPatchTargetBundleSizeKey] longLongValue];
    if (targetBundleFilePath == nil || patchFilePath == nil || ![self isFileAtPath:patchFilePath]
        || baseBundleHash.length == 0 || targetBundleHash.length == 0
        || targetBundleSize <= 0 || targetBundleSize > BinaryPatchMaxTargetBundleSize) {
        return [self failWithReason:CodePushBinaryPatchReasonInvalidManifest
                   outFailureReason:failureReason];
    }

    // An earlier attempt that was killed while patching leaves its restored bundle behind.
    [fileManager removeItemAtPath:workingFolderPath error:nil];
    if (![fileManager createDirectoryAtPath:workingFolderPath
                withIntermediateDirectories:YES
                                 attributes:nil
                                      error:&error]) {
        CPLog(@"Unable to create the binary patch working directory at %@: %@", workingFolderPath, error);
        return [self failWithReason:CodePushBinaryPatchReasonPatchApplyFailed
                   outFailureReason:failureReason];
    }

    NSString *reason = [self restoreBundleFromPatchAtPath:patchFilePath
                                            baseBundleURL:baseBundleURL
                                           baseBundleHash:baseBundleHash
                                     targetBundleFilePath:targetBundleFilePath
                                         targetBundleHash:targetBundleHash
                                         targetBundleSize:targetBundleSize
                                         manifestFilePath:manifestFilePath
                                            workingFolder:workingFolderPath];
    // Whatever the attempt did, it leaves nothing of its own behind.
    [fileManager removeItemAtPath:workingFolderPath error:nil];
    if (reason != nil) {
        return [self failWithReason:reason outFailureReason:failureReason];
    }

    return YES;
}

#pragma mark - Private methods

/**
 * Everything the restore does once the manifest has been read and the working directory
 * exists, so that the one caller can empty that directory whichever way this ends.
 *
 * @return the reason the full archive has to be downloaded instead, or nil when the
 *         update contents are now the ones the full archive would have delivered
 */
+ (NSString *)restoreBundleFromPatchAtPath:(NSString *)patchFilePath
                             baseBundleURL:(NSURL *)baseBundleURL
                            baseBundleHash:(NSString *)baseBundleHash
                      targetBundleFilePath:(NSString *)targetBundleFilePath
                          targetBundleHash:(NSString *)targetBundleHash
                          targetBundleSize:(long long)targetBundleSize
                          manifestFilePath:(NSString *)manifestFilePath
                             workingFolder:(NSString *)workingFolderPath
{
    NSFileManager *fileManager = [NSFileManager defaultManager];
    // A volume that will not say how much room is left is not taken to have none: a
    // restore that runs out of space still fails, just later and by writing a short file.
    NSNumber *freeSize = [fileManager attributesOfFileSystemForPath:workingFolderPath
                                                              error:nil][NSFileSystemFreeSize];
    if (freeSize != nil && freeSize.longLongValue < targetBundleSize) {
        CPLog(@"Not enough free space to restore a %lld byte bundle.", targetBundleSize);
        return CodePushBinaryPatchReasonPatchApplyFailed;
    }

    NSString *baseBundlePath = [baseBundleURL path];
    if (baseBundlePath == nil) {
        CPLog(@"The app binary carries no JS bundle to patch against.");
        return CodePushBinaryPatchReasonBaseBundleUnavailable;
    }

    NSError *error = nil;
    // Applying a patch is the one step that needs a whole bundle at once, and the base
    // bundle is a read-only file inside the app binary: mapping it hands the applier the
    // random access it needs without the update ever holding a copy of it.
    // The apply below reads `.bytes` for its whole duration, which is not a use of the
    // NSData itself, so ARC is free to release these two right after their last mention -
    // unmapping the base bundle out from under the applier. Both must stay alive until
    // the scope ends.
    __attribute__((objc_precise_lifetime)) NSData *baseBundle = [NSData dataWithContentsOfFile:baseBundlePath
                                                                                       options:NSDataReadingMappedIfSafe
                                                                                         error:&error];
    if (baseBundle == nil) {
        CPLog(@"Unable to read the JS bundle inside the app binary: %@", error);
        return CodePushBinaryPatchReasonBaseBundleUnavailable;
    }
    if (![baseBundleHash isEqualToString:[CodePushUpdateUtils computeHashForData:baseBundle]]) {
        return CodePushBinaryPatchReasonBaseHashMismatch;
    }

    __attribute__((objc_precise_lifetime)) NSData *patch = [NSData dataWithContentsOfFile:patchFilePath
                                                                                 options:0
                                                                                   error:&error];
    if (patch == nil) {
        CPLog(@"Unable to read the binary patch: %@", error);
        return CodePushBinaryPatchReasonPatchApplyFailed;
    }

    NSString *restoredBundleFilePath = [workingFolderPath stringByAppendingPathComponent:BinaryPatchTargetFileName];
    CodePushBinaryPatchApplyResult applyResult = CodePushApplyBinaryPatch(baseBundle.bytes,
                                                                         baseBundle.length,
                                                                         patch.bytes,
                                                                         patch.length,
                                                                         [restoredBundleFilePath fileSystemRepresentation],
                                                                         targetBundleSize);
    if (applyResult != CodePushBinaryPatchApplyResultOK) {
        CPLog(@"The binary patch applier returned %ld.", (long)applyResult);
        return applyResult == CodePushBinaryPatchApplyResultUnsupportedCompression
            ? CodePushBinaryPatchReasonUnsupportedFormat
            : CodePushBinaryPatchReasonPatchApplyFailed;
    }

    NSDictionary *restoredBundleAttributes = [fileManager attributesOfItemAtPath:restoredBundleFilePath
                                                                           error:&error];
    if (restoredBundleAttributes == nil || (long long)[restoredBundleAttributes fileSize] != targetBundleSize) {
        CPLog(@"The restored bundle is not %lld bytes long: %@", targetBundleSize, error);
        return CodePushBinaryPatchReasonTargetVerificationFailed;
    }

    NSString *restoredBundleHash = [CodePushUpdateUtils computeHashForFileAtPath:restoredBundleFilePath];
    if (restoredBundleHash == nil || ![targetBundleHash isEqualToString:restoredBundleHash]) {
        return CodePushBinaryPatchReasonTargetVerificationFailed;
    }

    if (![self moveItemAtPath:restoredBundleFilePath toPath:targetBundleFilePath]
        || ![fileManager removeItemAtPath:patchFilePath error:&error]
        || ![fileManager removeItemAtPath:manifestFilePath error:&error]) {
        // The contents are half restored, so they must not be installed. The download
        // that follows empties the unzipped archive before it replaces it, which is what
        // clears them.
        CPLog(@"Unable to put the restored bundle in place of the patch: %@", error);
        return CodePushBinaryPatchReasonPatchApplyFailed;
    }

    return nil;
}

/**
 * Finds the contents root inside an unzipped archive.
 *
 * An archive wraps its files in a single directory, and the manifest's paths are
 * relative to that directory rather than to the archive. An archive whose files are at
 * the top level is its own contents root, which is how the tooling that unpacks one
 * reads it too. A diff archive carries the manifest of the assets to delete beside that
 * wrapper directory, at the root, so that file does not count against the shape.
 */
+ (NSString *)contentsFolderInUnzippedFolder:(NSString *)unzippedFolderPath
{
    NSFileManager *fileManager = [NSFileManager defaultManager];
    NSArray *entries = [fileManager contentsOfDirectoryAtPath:unzippedFolderPath error:nil];
    NSString *wrapperPath = nil;
    for (NSString *entry in entries) {
        NSString *entryPath = [unzippedFolderPath stringByAppendingPathComponent:entry];
        BOOL isDirectory = NO;
        BOOL exists = [fileManager fileExistsAtPath:entryPath isDirectory:&isDirectory];
        if (exists && !isDirectory && [entry isEqualToString:AssetDiffManifestFileName]) {
            continue;
        }
        if (wrapperPath == nil && exists && isDirectory) {
            wrapperPath = entryPath;
            continue;
        }

        return unzippedFolderPath;
    }

    return wrapperPath != nil ? wrapperPath : unzippedFolderPath;
}

/**
 * Resolves a path the manifest points at, refusing anything that would reach outside
 * the archive - an archive is untrusted input, and its manifest is no more trusted
 * than its entries.
 *
 * @return the resolved path, or nil when the path is unusable
 */
+ (NSString *)pathInsideFolder:(NSString *)folderPath
                  relativePath:(NSString *)relativePath
{
    if (relativePath.length == 0 || [relativePath isAbsolutePath]) {
        return nil;
    }

    NSString *resolvedFolderPath = [[folderPath stringByStandardizingPath] stringByAppendingString:@"/"];
    NSString *resolvedPath = [[folderPath stringByAppendingPathComponent:relativePath] stringByStandardizingPath];
    if (![resolvedPath hasPrefix:resolvedFolderPath]) {
        return nil;
    }

    return resolvedPath;
}

/** Move, replacing whatever the archive may have carried at the destination. */
+ (BOOL)moveItemAtPath:(NSString *)sourcePath
                toPath:(NSString *)destinationPath
{
    NSFileManager *fileManager = [NSFileManager defaultManager];
    NSString *destinationFolderPath = [destinationPath stringByDeletingLastPathComponent];
    NSError *error = nil;
    if (![fileManager fileExistsAtPath:destinationFolderPath]
        && ![fileManager createDirectoryAtPath:destinationFolderPath
                   withIntermediateDirectories:YES
                                    attributes:nil
                                         error:&error]) {
        CPLog(@"Unable to create %@: %@", destinationFolderPath, error);
        return NO;
    }

    [fileManager removeItemAtPath:destinationPath error:nil];
    if (![fileManager moveItemAtPath:sourcePath toPath:destinationPath error:&error]) {
        CPLog(@"Unable to move %@ to %@: %@", sourcePath, destinationPath, error);
        return NO;
    }

    return YES;
}

+ (BOOL)isFileAtPath:(NSString *)path
{
    BOOL isDirectory = NO;
    return [[NSFileManager defaultManager] fileExistsAtPath:path isDirectory:&isDirectory] && !isDirectory;
}

/** The value of a manifest key, or nil when it is absent or not a string. */
+ (NSString *)stringInManifest:(NSDictionary *)manifest
                        forKey:(NSString *)key
{
    id value = manifest[key];
    return [value isKindOfClass:[NSString class]] ? value : nil;
}

/** The value of a manifest key, or nil when it is absent or not a number. */
+ (NSNumber *)numberInManifest:(NSDictionary *)manifest
                        forKey:(NSString *)key
{
    id value = manifest[key];
    return [value isKindOfClass:[NSNumber class]] ? value : nil;
}

+ (BOOL)failWithReason:(NSString *)reason
      outFailureReason:(NSString **)failureReason
{
    if (failureReason != NULL) {
        *failureReason = reason;
    }

    return NO;
}

@end
