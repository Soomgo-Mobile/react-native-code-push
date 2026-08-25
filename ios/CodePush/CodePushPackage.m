#import "CodePush.h"
#import "CodePushBinaryPatch.h"
#if __has_include(<SSZipArchive/SSZipArchive.h>)
#import <SSZipArchive/SSZipArchive.h>
#else
#import "SSZipArchive.h"
#endif

@implementation CodePushPackage

#pragma mark - Private constants

static NSString *const AssetDiffDownloadUrlKey = @"assetDiffDownloadUrl";
static NSString *const UpdateArchiveAssetDiff = @"asset-diff";
static NSString *const UpdateArchiveBinaryPatch = @"binary-patch";
static NSString *const BinaryPatchDownloadUrlKey = @"binaryPatchDownloadUrl";
static NSString *const BinaryPatchFolderName = @"binary-patch";
// The fields of what a download that tried a patch reports back with. They are read by the
// app that asked for the download and by nothing else, so they never reach a file.
static NSString *const UpdateArchiveAttemptApplyDurationMsKey = @"applyDurationMs";
static NSString *const UpdateArchiveAttemptDurationMsKey = @"durationMs";
static NSString *const UpdateArchiveResultArchiveKey = @"archive";
static NSString *const UpdateArchiveResultAttemptsKey = @"attempts";
static NSString *const UpdateArchiveResultFallbackReasonKey = @"fallbackReason";
static NSString *const UpdateArchiveResultStatusKey = @"status";
static NSString *const UpdateArchiveResultTotalDurationMsKey = @"totalDurationMs";
static NSString *const UpdateArchiveResultStatusApplied = @"applied";
static NSString *const UpdateArchiveResultStatusFallback = @"fallback";
static NSString *const DiffManifestFileName = @"hotcodepush.json";
static NSString *const DownloadFileName = @"download.zip";
static NSString *const DownloadUrlKey = @"downloadUrl";
static NSString *const RelativeBundlePathKey = @"bundlePath";
static NSString *const StatusFile = @"codepush.json";
static NSString *const UpdateBundleFileName = @"app.jsbundle";
static NSString *const UpdateMetadataFileName = @"app.json";
static NSString *const UnzippedFolderName = @"unzipped";

#pragma mark - Public methods

+ (void)clearUpdates
{
    [[NSFileManager defaultManager] removeItemAtPath:[self getCodePushPath] error:nil];
}

+ (void)downloadAndReplaceCurrentBundle:(NSString *)remoteBundleUrl
{
    NSURL *urlRequest = [NSURL URLWithString:remoteBundleUrl];
    NSError *error = nil;
    NSString *downloadedBundle = [NSString stringWithContentsOfURL:urlRequest
                                                          encoding:NSUTF8StringEncoding
                                                             error:&error];
    
    if (error) {
        CPLog(@"Error downloading from URL %@", remoteBundleUrl);
    } else {
        NSString *currentPackageBundlePath = [self getCurrentPackageBundlePath:&error];
        [downloadedBundle writeToFile:currentPackageBundlePath
                           atomically:YES
                             encoding:NSUTF8StringEncoding
                                error:&error];
    }
}

+ (void)downloadPackage:(NSDictionary *)updatePackage
 expectedBundleFileName:(NSString *)expectedBundleFileName
         operationQueue:(dispatch_queue_t)operationQueue
       progressCallback:(void (^)(long long, long long))progressCallback
           doneCallback:(void (^)(NSDictionary *updateArchiveResult))doneCallback
           failCallback:(void (^)(NSError *err))failCallback
{
    // A release that was published with a binary patch offers up to three archives of the
    // same update. The asset diff is the smallest and is tried first, the patch archive
    // stands in when the diff fails on its asset side, and the full archive is always
    // there when none of it works out.
    NSMutableArray<NSDictionary *> *archivesToTry = [NSMutableArray array];
    NSString *assetDiffDownloadUrl = updatePackage[AssetDiffDownloadUrlKey];
    if ([assetDiffDownloadUrl isKindOfClass:[NSString class]] && [assetDiffDownloadUrl length] > 0) {
        [archivesToTry addObject:@{ UpdateArchiveResultArchiveKey: UpdateArchiveAssetDiff,
                                    DownloadUrlKey: assetDiffDownloadUrl }];
    }

    NSString *binaryPatchDownloadUrl = updatePackage[BinaryPatchDownloadUrlKey];
    if ([binaryPatchDownloadUrl isKindOfClass:[NSString class]] && [binaryPatchDownloadUrl length] > 0) {
        [archivesToTry addObject:@{ UpdateArchiveResultArchiveKey: UpdateArchiveBinaryPatch,
                                    DownloadUrlKey: binaryPatchDownloadUrl }];
    }

    if ([archivesToTry count] == 0) {
        // A download that never had a patch to try has nothing to report about one.
        [self downloadAndInstallPackage:updatePackage
                 expectedBundleFileName:expectedBundleFileName
                         operationQueue:operationQueue
                            downloadUrl:updatePackage[DownloadUrlKey]
                    isBinaryPatchUpdate:NO
                       progressCallback:progressCallback
                           doneCallback:^{
                               doneCallback(nil);
                           }
                           failCallback:failCallback
                   patchAppliedCallback:nil
                  patchFallbackCallback:nil];
        return;
    }

    [self tryNextArchive:archivesToTry
           attemptsSoFar:[NSMutableArray array]
   firstAttemptStartTime:[NSDate date]
           updatePackage:updatePackage
  expectedBundleFileName:expectedBundleFileName
          operationQueue:operationQueue
        progressCallback:progressCallback
            doneCallback:doneCallback
            failCallback:failCallback];
}

/*
 * Tries the first archive of the queue, and decides what a failure of it means for the
 * rest. A failure after the bundle was restored is on the asset side of the archive, so
 * the next archive - which does not share it - is worth trying. A failure before that
 * point is in the bundle patch every archive carries byte for byte, or is something no
 * verdict exists for, and either way the remaining archives are passed over: they could
 * only fail the same way, and trying them would put more doomed downloads in front of the
 * full one.
 *
 * Every way the ladder can end, the update is installed - by an archive of the queue or
 * by the full download behind it - so no failure here reaches the caller as an error, and
 * the result retells the attempts one by one.
 */
+ (void)tryNextArchive:(NSArray<NSDictionary *> *)archivesToTry
         attemptsSoFar:(NSMutableArray<NSDictionary *> *)attempts
 firstAttemptStartTime:(NSDate *)firstAttemptStartTime
         updatePackage:(NSDictionary *)updatePackage
expectedBundleFileName:(NSString *)expectedBundleFileName
        operationQueue:(dispatch_queue_t)operationQueue
      progressCallback:(void (^)(long long, long long))progressCallback
          doneCallback:(void (^)(NSDictionary *updateArchiveResult))doneCallback
          failCallback:(void (^)(NSError *err))failCallback
{
    NSString *archive = archivesToTry[0][UpdateArchiveResultArchiveKey];
    NSArray<NSDictionary *> *remainingArchives = [archivesToTry subarrayWithRange:NSMakeRange(1, [archivesToTry count] - 1)];
    NSDate *attemptStartTime = [NSDate date];

    // Set once the applier has restored the bundle, which is also what tells a failure
    // that follows apart from one that came before.
    __block NSNumber *applyDurationMs = nil;

    void (^giveUpAttempt)(NSString *failureReason) = ^(NSString *failureReason) {
        [self deleteBinaryPatchFolder];
        [attempts addObject:[self archiveAttemptEntry:archive
                                        failureReason:failureReason
                                      applyDurationMs:applyDurationMs
                                     attemptStartTime:attemptStartTime]];

        if (applyDurationMs != nil && [remainingArchives count] > 0) {
            [self tryNextArchive:remainingArchives
                   attemptsSoFar:attempts
           firstAttemptStartTime:firstAttemptStartTime
                   updatePackage:updatePackage
          expectedBundleFileName:expectedBundleFileName
                  operationQueue:operationQueue
                progressCallback:progressCallback
                    doneCallback:doneCallback
                    failCallback:failCallback];
            return;
        }

        // Timed before the full download starts, because that is not time the patch
        // path spent.
        NSDictionary *fallbackResult = [self archiveFallbackResult:failureReason
                                                           archive:archive
                                                          attempts:attempts
                                             firstAttemptStartTime:firstAttemptStartTime];
        [self downloadAndInstallPackage:updatePackage
                 expectedBundleFileName:expectedBundleFileName
                         operationQueue:operationQueue
                            downloadUrl:updatePackage[DownloadUrlKey]
                    isBinaryPatchUpdate:NO
                       progressCallback:progressCallback
                           doneCallback:^{
                               doneCallback(fallbackResult);
                           }
                           failCallback:failCallback
                   patchAppliedCallback:nil
                  patchFallbackCallback:nil];
    };

    [self downloadAndInstallPackage:updatePackage
             expectedBundleFileName:expectedBundleFileName
                     operationQueue:operationQueue
                        downloadUrl:archivesToTry[0][DownloadUrlKey]
                isBinaryPatchUpdate:YES
                   progressCallback:progressCallback
                       doneCallback:^{
                           [self deleteBinaryPatchFolder];
                           [attempts addObject:[self archiveAttemptEntry:archive
                                                           failureReason:nil
                                                         applyDurationMs:applyDurationMs
                                                        attemptStartTime:attemptStartTime]];
                           doneCallback([self appliedArchiveResult:archive
                                                          attempts:attempts
                                             firstAttemptStartTime:firstAttemptStartTime]);
                       }
                       failCallback:^(NSError *err) {
                           CPLog(@"The %@ archive could not be applied (%@). Falling back.", archive, err.localizedDescription);
                           // An error raised after the bundle was restored is the restored
                           // update failing the checks every update passes before it is
                           // installed. Before that point the appliers have no word for what
                           // happened - the archive not being downloadable, say - and
                           // inventing one here would put a value on the wire that no
                           // platform reports, so the fallback is reported without a reason.
                           giveUpAttempt(applyDurationMs == nil
                               ? nil
                               : CodePushArchiveFallbackReasonPackageVerificationFailed);
                       }
               patchAppliedCallback:^(double durationMs) {
                   applyDurationMs = @(durationMs);
               }
              patchFallbackCallback:^(NSString *failureReason) {
                  CPLog(@"The %@ archive failed (%@). Falling back.", archive, failureReason);
                  giveUpAttempt(failureReason);
              }];
}

/*
 * One archive the ladder tried: which archive it was, why it was given up on when it was,
 * how long the try ran whichever way it ended, and how long its apply took when it got that
 * far.
 */
+ (NSDictionary *)archiveAttemptEntry:(NSString *)archive
                        failureReason:(NSString *)failureReason
                      applyDurationMs:(NSNumber *)applyDurationMs
                     attemptStartTime:(NSDate *)attemptStartTime
{
    NSMutableDictionary *entry = [NSMutableDictionary dictionaryWithDictionary:@{
        UpdateArchiveResultArchiveKey: archive,
        UpdateArchiveAttemptDurationMsKey: @(round([[NSDate date] timeIntervalSinceDate:attemptStartTime] * 1000)),
    }];
    if (failureReason) {
        entry[UpdateArchiveResultFallbackReasonKey] = failureReason;
    }
    // An attempt that never restored the bundle has no apply to report.
    if (applyDurationMs) {
        entry[UpdateArchiveAttemptApplyDurationMsKey] = applyDurationMs;
    }

    return entry;
}

/*
 * The result of an archive the update was installed from, timed over the whole path.
 */
+ (NSDictionary *)appliedArchiveResult:(NSString *)archive
                              attempts:(NSArray<NSDictionary *> *)attempts
                 firstAttemptStartTime:(NSDate *)firstAttemptStartTime
{
    return @{
        UpdateArchiveResultStatusKey: UpdateArchiveResultStatusApplied,
        UpdateArchiveResultArchiveKey: archive,
        UpdateArchiveResultTotalDurationMsKey: @(round([[NSDate date] timeIntervalSinceDate:firstAttemptStartTime] * 1000)),
        UpdateArchiveResultAttemptsKey: [attempts copy],
    };
}

/*
 * The result of a patch path the update had to be downloaded in full after.
 *
 * There is no completed apply to time here, so the path itself is what is timed: from the
 * first archive being asked for to the moment the last one was given up on. The reason is
 * left out when the last attempt ended in an error none of the appliers has a word for.
 */
+ (NSDictionary *)archiveFallbackResult:(NSString *)failureReason
                                archive:(NSString *)archive
                               attempts:(NSArray<NSDictionary *> *)attempts
                  firstAttemptStartTime:(NSDate *)firstAttemptStartTime
{
    NSMutableDictionary *result = [NSMutableDictionary dictionaryWithDictionary:@{
        UpdateArchiveResultStatusKey: UpdateArchiveResultStatusFallback,
        UpdateArchiveResultArchiveKey: archive,
        UpdateArchiveResultTotalDurationMsKey: @(round([[NSDate date] timeIntervalSinceDate:firstAttemptStartTime] * 1000)),
        UpdateArchiveResultAttemptsKey: [attempts copy],
    }];
    if (failureReason) {
        result[UpdateArchiveResultFallbackReasonKey] = failureReason;
    }

    return result;
}

/*
 * Downloads an update from one of its archives and installs it.
 *
 * isBinaryPatchUpdate says whether the archive holds a binary patch of the JS bundle,
 * which has to be applied before the contents are the update. Both the asset diff and the
 * patch archive are downloaded that way; the full archive never is, so an update being
 * downloaded in full can never end up on the patch path.
 *
 * patchAppliedCallback is called with how long the apply took the moment the bundle has
 * been restored, which is before the update is known to install. It is nil for a full
 * download, which has no patch to apply.
 *
 * patchFallbackCallback is called instead of doneCallback when the patch cannot be
 * applied: the update was not installed, and the caller has to move on to the next
 * archive. It is nil for a full download, which has nothing to fall back to.
 */
+ (void)downloadAndInstallPackage:(NSDictionary *)updatePackage
           expectedBundleFileName:(NSString *)expectedBundleFileName
                   operationQueue:(dispatch_queue_t)operationQueue
                      downloadUrl:(NSString *)downloadUrl
              isBinaryPatchUpdate:(BOOL)isBinaryPatchUpdate
                 progressCallback:(void (^)(long long, long long))progressCallback
                     doneCallback:(void (^)(void))doneCallback
                     failCallback:(void (^)(NSError *err))failCallback
             patchAppliedCallback:(void (^)(double applyDurationMs))patchAppliedCallback
            patchFallbackCallback:(void (^)(NSString *failureReason))patchFallbackCallback
{
    NSString *newUpdateHash = updatePackage[@"packageHash"];
    NSString *newUpdateFolderPath = [self getPackageFolderPath:newUpdateHash];
    NSString *newUpdateMetadataPath = [newUpdateFolderPath stringByAppendingPathComponent:UpdateMetadataFileName];
    NSError *error;
    
    if ([[NSFileManager defaultManager] fileExistsAtPath:newUpdateFolderPath]) {
        // This removes any stale data in newUpdateFolderPath that could have been left
        // uncleared due to a crash or error during the download or install process.
        [[NSFileManager defaultManager] removeItemAtPath:newUpdateFolderPath
                                                   error:&error];
    } else if (![[NSFileManager defaultManager] fileExistsAtPath:[self getCodePushPath]]) {
        [[NSFileManager defaultManager] createDirectoryAtPath:[self getCodePushPath]
                                  withIntermediateDirectories:YES
                                                   attributes:nil
                                                        error:&error];
                                                        
        // Ensure that none of the CodePush updates we store on disk are
        // ever included in the end users iTunes and/or iCloud backups
        NSURL *codePushURL = [NSURL fileURLWithPath:[self getCodePushPath]];
        [codePushURL setResourceValue:@YES forKey:NSURLIsExcludedFromBackupKey error:nil];
    }
    
    if (error) {
        return failCallback(error);
    }
    
    NSString *downloadFilePath = [self getDownloadFilePath];
    NSString *bundleFilePath = [newUpdateFolderPath stringByAppendingPathComponent:UpdateBundleFileName];
    
    CodePushDownloadHandler *downloadHandler = [[CodePushDownloadHandler alloc]
                                                init:downloadFilePath
                                                operationQueue:operationQueue
                                                progressCallback:progressCallback
                                                doneCallback:^(BOOL isZip) {
                                                    NSError *error = nil;
                                                    NSString * unzippedFolderPath = [CodePushPackage getUnzippedFolderPath];
                                                    NSMutableDictionary * mutableUpdatePackage = [updatePackage mutableCopy];
                                                    if (isZip) {
                                                        if ([[NSFileManager defaultManager] fileExistsAtPath:unzippedFolderPath]) {
                                                            // This removes any unzipped download data that could have been left
                                                            // uncleared due to a crash or error during the download process.
                                                            [[NSFileManager defaultManager] removeItemAtPath:unzippedFolderPath
                                                                                                       error:&error];
                                                            if (error) {
                                                                failCallback(error);
                                                                return;
                                                            }
                                                        }
                                                        
                                                        NSError *nonFailingError = nil;
                                                        [SSZipArchive unzipFileAtPath:downloadFilePath
                                                                        toDestination:unzippedFolderPath];
                                                        [[NSFileManager defaultManager] removeItemAtPath:downloadFilePath
                                                                                                   error:&nonFailingError];
                                                        if (nonFailingError) {
                                                            CPLog(@"Error deleting downloaded file: %@", nonFailingError);
                                                            nonFailingError = nil;
                                                        }
                                                        
                                                        // Rebuild the JS bundle the archive only carries a patch of, which leaves the
                                                        // contents identical to the ones the full archive would have delivered.
                                                        if (isBinaryPatchUpdate) {
                                                            NSDate *patchStartTime = [NSDate date];
                                                            NSString *patchFailureReason = nil;
                                                            if (![CodePushBinaryPatch restoreBundleInUnzippedFolder:unzippedFolderPath
                                                                                                     workingFolder:[self getBinaryPatchFolderPath]
                                                                                                     baseBundleURL:[CodePush binaryBundleURL]
                                                                                                     failureReason:&patchFailureReason]) {
                                                                patchFallbackCallback(patchFailureReason);
                                                                return;
                                                            }

                                                            double applyDurationMs = round([[NSDate date] timeIntervalSinceDate:patchStartTime] * 1000);
                                                            CPLog(@"Restored the update from its binary patch in %.0f ms.", applyDurationMs);
                                                            patchAppliedCallback(applyDurationMs);
                                                        }

                                                        NSString *diffManifestFilePath = [unzippedFolderPath stringByAppendingPathComponent:DiffManifestFileName];
                                                        BOOL isDiffUpdate = [[NSFileManager defaultManager] fileExistsAtPath:diffManifestFilePath];
                                                        
                                                        if (isDiffUpdate) {
                                                            // A merge that cannot complete has a word of its own, because it says
                                                            // the diff went wrong on its asset side - the one failure the patch
                                                            // archive, which carries every asset, is not implicated in. A diff
                                                            // manifest served outside the patch path keeps failing as the error
                                                            // it always was.
                                                            void (^mergeFailCallback)(NSError *) = !isBinaryPatchUpdate ? failCallback : ^(NSError *mergeError) {
                                                                CPLog(@"The asset diff could not be merged (%@).", mergeError.localizedDescription);
                                                                patchFallbackCallback(CodePushArchiveFallbackReasonAssetMergeFailed);
                                                            };

                                                            // Copy the current package to the new package.
                                                            NSString *currentPackageFolderPath = [self getCurrentPackageFolderPath:&error];
                                                            if (error) {
                                                                mergeFailCallback(error);
                                                                return;
                                                            }

                                                            if (currentPackageFolderPath == nil) {
                                                                // Currently running the binary version, copy files from the bundled resources
                                                                NSString *newUpdateCodePushPath = [newUpdateFolderPath stringByAppendingPathComponent:[CodePushUpdateUtils manifestFolderPrefix]];
                                                                [[NSFileManager defaultManager] createDirectoryAtPath:newUpdateCodePushPath
                                                                                          withIntermediateDirectories:YES
                                                                                                           attributes:nil
                                                                                                                error:&error];
                                                                if (error) {
                                                                    mergeFailCallback(error);
                                                                    return;
                                                                }

                                                                [[NSFileManager defaultManager] copyItemAtPath:[CodePush bundleAssetsPath]
                                                                                                        toPath:[newUpdateCodePushPath stringByAppendingPathComponent:[CodePushUpdateUtils assetsFolderName]]
                                                                                                         error:&error];
                                                                if (error) {
                                                                    mergeFailCallback(error);
                                                                    return;
                                                                }

                                                                [[NSFileManager defaultManager] copyItemAtPath:[[CodePush binaryBundleURL] path]
                                                                                                        toPath:[newUpdateCodePushPath stringByAppendingPathComponent:[[CodePush binaryBundleURL] lastPathComponent]]
                                                                                                         error:&error];
                                                                if (error) {
                                                                    mergeFailCallback(error);
                                                                    return;
                                                                }
                                                            } else {
                                                                [[NSFileManager defaultManager] copyItemAtPath:currentPackageFolderPath
                                                                                                        toPath:newUpdateFolderPath
                                                                                                         error:&error];
                                                                if (error) {
                                                                    mergeFailCallback(error);
                                                                    return;
                                                                }
                                                            }

                                                            // Delete files mentioned in the manifest.
                                                            NSString *manifestContent = [NSString stringWithContentsOfFile:diffManifestFilePath
                                                                                                                  encoding:NSUTF8StringEncoding
                                                                                                                     error:&error];
                                                            if (error) {
                                                                mergeFailCallback(error);
                                                                return;
                                                            }

                                                            NSData *data = [manifestContent dataUsingEncoding:NSUTF8StringEncoding];
                                                            NSDictionary *manifestJSON = [NSJSONSerialization JSONObjectWithData:data
                                                                                                                         options:kNilOptions
                                                                                                                           error:&error];
                                                            if (error) {
                                                                mergeFailCallback(error);
                                                                return;
                                                            }

                                                            // A manifest that does not name the files to delete is not a manifest
                                                            // with nothing to delete - the CLI writes the key on every release, an
                                                            // empty list included. Iterating what is not there would skip every
                                                            // deletion and merge on, so it is refused here, the way the other
                                                            // platform's merge refuses it, for the two platforms to report one
                                                            // reason for one state.
                                                            NSArray *deletedFiles = [manifestJSON isKindOfClass:[NSDictionary class]]
                                                                ? manifestJSON[@"deletedFiles"]
                                                                : nil;
                                                            if (![deletedFiles isKindOfClass:[NSArray class]]) {
                                                                error = [CodePushErrorUtils errorWithMessage:[NSString stringWithFormat:@"The asset diff manifest at %@ does not name the files to delete.", diffManifestFilePath]];
                                                                mergeFailCallback(error);
                                                                return;
                                                            }

                                                            for (NSString *deletedFileName in deletedFiles) {
                                                                // The manifest is untrusted input, so an entry that reaches outside the
                                                                // package folder is ignored rather than followed. Whether skipping it
                                                                // left the update whole is the folder hash check's answer to give.
                                                                NSString *absoluteDeletedFilePath = [self pathInsideFolder:newUpdateFolderPath
                                                                                                             relativePath:deletedFileName];
                                                                if (absoluteDeletedFilePath && [[NSFileManager defaultManager] fileExistsAtPath:absoluteDeletedFilePath]) {
                                                                    [[NSFileManager defaultManager] removeItemAtPath:absoluteDeletedFilePath
                                                                                                               error:&error];
                                                                    if (error) {
                                                                        mergeFailCallback(error);
                                                                        return;
                                                                    }
                                                                }
                                                            }

                                                            [[NSFileManager defaultManager] removeItemAtPath:diffManifestFilePath
                                                                                                       error:&error];
                                                            if (error) {
                                                                mergeFailCallback(error);
                                                                return;
                                                            }
                                                        }
                                                        
                                                        [CodePushUpdateUtils copyEntriesInFolder:unzippedFolderPath
                                                                                      destFolder:newUpdateFolderPath
                                                                                           error:&error];
                                                        if (error) {
                                                            failCallback(error);
                                                            return;
                                                        }
                                                        
                                                        [[NSFileManager defaultManager] removeItemAtPath:unzippedFolderPath
                                                                                                   error:&nonFailingError];
                                                        if (nonFailingError) {
                                                            CPLog(@"Error deleting downloaded file: %@", nonFailingError);
                                                            nonFailingError = nil;
                                                        }
                                                        
                                                        NSString *relativeBundlePath = [CodePushUpdateUtils findMainBundleInFolder:newUpdateFolderPath
                                                                                                                  expectedFileName:expectedBundleFileName
                                                                                                                             error:&error];
                                                        
                                                        if (error) {
                                                            failCallback(error);
                                                            return;
                                                        }
                                                        
                                                        if (relativeBundlePath) {
                                                            [mutableUpdatePackage setValue:relativeBundlePath forKey:RelativeBundlePathKey];
                                                        } else {
                                                            NSString *errorMessage = [NSString stringWithFormat:@"Update is invalid - A JS bundle file named \"%@\" could not be found within the downloaded contents. Please ensure that your app is syncing with the correct deployment and that you are releasing your CodePush updates using the exact same JS bundle file name that was shipped with your app's binary.", expectedBundleFileName];
                                                            
                                                            error = [CodePushErrorUtils errorWithMessage:errorMessage];
                                                            
                                                            failCallback(error);
                                                            return;
                                                        }
                                                        
                                                        if ([[NSFileManager defaultManager] fileExistsAtPath:newUpdateMetadataPath]) {
                                                            [[NSFileManager defaultManager] removeItemAtPath:newUpdateMetadataPath
                                                                                                       error:&error];
                                                            if (error) {
                                                                failCallback(error);
                                                                return;
                                                            }
                                                        }

                                                        CPLog((isDiffUpdate) ? @"Applying diff update." : @"Applying full update.");

                                                        if (![CodePushUpdateUtils verifyFolderHash:newUpdateFolderPath
                                                                                      expectedHash:newUpdateHash
                                                                                             error:&error]) {
                                                            CPLog(@"The update contents failed the data integrity check.");
                                                            if (!error) {
                                                                error = [CodePushErrorUtils errorWithMessage:@"The update contents failed the data integrity check."];
                                                            }

                                                            failCallback(error);
                                                            return;
                                                        } else {
                                                            CPLog(@"The update contents succeeded the data integrity check.");
                                                        }

                                                    } else {
                                                        if (isBinaryPatchUpdate) {
                                                            // Whatever the archive URL served, it is not an update archive - an error page
                                                            // answered with a 200 looks like this too. Moving it into place would
                                                            // install bytes no hash has ever been checked against, so the full archive
                                                            // is downloaded instead.
                                                            patchFallbackCallback(CodePushArchiveFallbackReasonInvalidManifest);
                                                            return;
                                                        }

                                                        [[NSFileManager defaultManager] createDirectoryAtPath:newUpdateFolderPath
                                                                                  withIntermediateDirectories:YES
                                                                                                   attributes:nil
                                                                                                        error:&error];
                                                        [[NSFileManager defaultManager] moveItemAtPath:downloadFilePath
                                                                                                toPath:bundleFilePath
                                                                                                 error:&error];
                                                        if (error) {
                                                            failCallback(error);
                                                            return;
                                                        }
                                                    }
                                                    
                                                    NSData *updateSerializedData = [NSJSONSerialization dataWithJSONObject:mutableUpdatePackage
                                                                                                                   options:0
                                                                                                                     error:&error];
                                                    NSString *packageJsonString = [[NSString alloc] initWithData:updateSerializedData
                                                                                                        encoding:NSUTF8StringEncoding];
                                                    
                                                    [packageJsonString writeToFile:newUpdateMetadataPath
                                                                        atomically:YES
                                                                          encoding:NSUTF8StringEncoding
                                                                             error:&error];
                                                    if (error) {
                                                        failCallback(error);
                                                    } else {
                                                        doneCallback();
                                                    }
                                                }
                                                
                                                failCallback:failCallback];
    
    [downloadHandler download:downloadUrl];
}

/*
 * Removes what a patch attempt works in, whichever way the attempt ended - and whatever
 * an attempt that was killed halfway through left there.
 */
+ (void)deleteBinaryPatchFolder
{
    [[NSFileManager defaultManager] removeItemAtPath:[self getBinaryPatchFolderPath]
                                               error:nil];
}

+ (NSString *)getBinaryPatchFolderPath
{
    return [[self getCodePushPath] stringByAppendingPathComponent:BinaryPatchFolderName];
}

/*
 * Resolves a path a manifest points at, refusing anything that would reach outside the
 * folder it is relative to - an archive is untrusted input, and its manifest is no more
 * trusted than its entries.
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

+ (NSString *)getCodePushPath
{
    NSString* codePushPath = [[CodePush getApplicationSupportDirectory] stringByAppendingPathComponent:@"CodePush"];
    if ([CodePush isUsingTestConfiguration]) {
        codePushPath = [codePushPath stringByAppendingPathComponent:@"TestPackages"];
    }
    
    return codePushPath;
}

+ (NSDictionary *)getCurrentPackage:(NSError **)error
{
    NSString *packageHash = [CodePushPackage getCurrentPackageHash:error];
    if (!packageHash) {
        return nil;
    }

    return [CodePushPackage getPackage:packageHash error:error];
}

+ (NSString *)getCurrentPackageBundlePath:(NSError **)error
{
    NSString *packageFolder = [self getCurrentPackageFolderPath:error];
    
    if (!packageFolder) {
        return nil;
    }
    
    NSDictionary *currentPackage = [self getCurrentPackage:error];
    
    if (!currentPackage) {
        return nil;
    }
    
    NSString *relativeBundlePath = [currentPackage objectForKey:RelativeBundlePathKey];
    if (relativeBundlePath) {
        return [packageFolder stringByAppendingPathComponent:relativeBundlePath];
    } else {
        return [packageFolder stringByAppendingPathComponent:UpdateBundleFileName];
    }
}

+ (NSString *)getCurrentPackageHash:(NSError **)error
{
    NSDictionary *info = [self getCurrentPackageInfo:error];
    if (!info) {
        return nil;
    }
    
    return info[@"currentPackage"];
}

+ (NSString *)getCurrentPackageFolderPath:(NSError **)error
{
    NSDictionary *info = [self getCurrentPackageInfo:error];
    
    if (!info) {
        return nil;
    }
    
    NSString *packageHash = info[@"currentPackage"];
    
    if (!packageHash) {
        return nil;
    }
    
    return [self getPackageFolderPath:packageHash];
}

+ (NSMutableDictionary *)getCurrentPackageInfo:(NSError **)error
{
    NSString *statusFilePath = [self getStatusFilePath];
    if (![[NSFileManager defaultManager] fileExistsAtPath:statusFilePath]) {
        return [NSMutableDictionary dictionary];
    }
    
    NSString *content = [NSString stringWithContentsOfFile:statusFilePath
                                                  encoding:NSUTF8StringEncoding
                                                     error:error];
    if (!content) {
        return nil;
    }
    
    NSData *data = [content dataUsingEncoding:NSUTF8StringEncoding];
    NSDictionary* json = [NSJSONSerialization JSONObjectWithData:data
                                                         options:kNilOptions
                                                           error:error];
    if (!json) {
        return nil;
    }
    
    return [json mutableCopy];
}

+ (NSString *)getDownloadFilePath
{
    return [[self getCodePushPath] stringByAppendingPathComponent:DownloadFileName];
}

+ (NSDictionary *)getPackage:(NSString *)packageHash
                       error:(NSError **)error
{
    NSString *updateDirectoryPath = [self getPackageFolderPath:packageHash];
    NSString *updateMetadataFilePath = [updateDirectoryPath stringByAppendingPathComponent:UpdateMetadataFileName];
    
    if (![[NSFileManager defaultManager] fileExistsAtPath:updateMetadataFilePath]) {
        return nil;
    }
    
    NSString *updateMetadataString = [NSString stringWithContentsOfFile:updateMetadataFilePath
                                                               encoding:NSUTF8StringEncoding
                                                                  error:error];
    if (!updateMetadataString) {
        return nil;
    }
    
    NSData *updateMetadata = [updateMetadataString dataUsingEncoding:NSUTF8StringEncoding];
    return [NSJSONSerialization JSONObjectWithData:updateMetadata
                                           options:kNilOptions
                                             error:error];
}

+ (NSString *)getPackageFolderPath:(NSString *)packageHash
{
    return [[self getCodePushPath] stringByAppendingPathComponent:packageHash];
}

+ (NSDictionary *)getPreviousPackage:(NSError **)error
{
    NSString *packageHash = [self getPreviousPackageHash:error];
    if (!packageHash) {
        return nil;
    }
    
    return [CodePushPackage getPackage:packageHash error:error];
}

+ (NSString *)getPreviousPackageHash:(NSError **)error
{
    NSDictionary *info = [self getCurrentPackageInfo:error];
    if (!info) {
        return nil;
    }
    
    return info[@"previousPackage"];
}

+ (NSString *)getStatusFilePath
{
    return [[self getCodePushPath] stringByAppendingPathComponent:StatusFile];
}

+ (NSString *)getUnzippedFolderPath
{
    return [[self getCodePushPath] stringByAppendingPathComponent:UnzippedFolderName];
}

+ (BOOL)installPackage:(NSDictionary *)updatePackage
   removePendingUpdate:(BOOL)removePendingUpdate
                 error:(NSError **)error
{
    NSString *packageHash = updatePackage[@"packageHash"];
    NSMutableDictionary *info = [self getCurrentPackageInfo:error];
    
    if (!info) {
        return NO;
    }
    
    if (packageHash && [packageHash isEqualToString:info[@"currentPackage"]]) {
        // The current package is already the one being installed, so we should no-op.
        return YES;
    }

    if (removePendingUpdate) {
        NSString *currentPackageFolderPath = [self getCurrentPackageFolderPath:error];
        if (currentPackageFolderPath) {
            // Error in deleting pending package will not cause the entire operation to fail.
            NSError *deleteError;
            [[NSFileManager defaultManager] removeItemAtPath:currentPackageFolderPath
                                                       error:&deleteError];
            if (deleteError) {
                CPLog(@"Error deleting pending package: %@", deleteError);
            }
        }
    } else {
        NSString *previousPackageHash = [self getPreviousPackageHash:error];
        if (previousPackageHash && ![previousPackageHash isEqualToString:packageHash]) {
            NSString *previousPackageFolderPath = [self getPackageFolderPath:previousPackageHash];
            // Error in deleting old package will not cause the entire operation to fail.
            NSError *deleteError;
            [[NSFileManager defaultManager] removeItemAtPath:previousPackageFolderPath
                                                       error:&deleteError];
            if (deleteError) {
                CPLog(@"Error deleting old package: %@", deleteError);
            }
        }
        [info setValue:info[@"currentPackage"] forKey:@"previousPackage"];
    }
    
    [info setValue:packageHash forKey:@"currentPackage"];
    return [self updateCurrentPackageInfo:info
                                    error:error];
}

+ (void)rollbackPackage
{
    NSError *error;
    NSMutableDictionary *info = [self getCurrentPackageInfo:&error];
    if (!info) {
        CPLog(@"Error getting current package info: %@", error);
        return;
    }
    
    NSString *currentPackageFolderPath = [self getCurrentPackageFolderPath:&error];        
    if (!currentPackageFolderPath) {
        CPLog(@"Error getting current package folder path: %@", error);
        return;
    }
    
    NSError *deleteError;
    BOOL result = [[NSFileManager defaultManager] removeItemAtPath:currentPackageFolderPath
                                               error:&deleteError];
    if (!result) {
        CPLog(@"Error deleting current package contents at %@ error %@", currentPackageFolderPath, deleteError);
    }
    
    [info setValue:info[@"previousPackage"] forKey:@"currentPackage"];
    [info removeObjectForKey:@"previousPackage"];
    
    [self updateCurrentPackageInfo:info error:&error];
}

+ (BOOL)updateCurrentPackageInfo:(NSDictionary *)packageInfo
                           error:(NSError **)error
{
    NSData *packageInfoData = [NSJSONSerialization dataWithJSONObject:packageInfo
                                                              options:0
                                                                error:error];
    if (!packageInfoData) {
        return NO;
    }

    NSString *packageInfoString = [[NSString alloc] initWithData:packageInfoData
                                                        encoding:NSUTF8StringEncoding];
    BOOL result = [packageInfoString writeToFile:[self getStatusFilePath]
                        atomically:YES
                          encoding:NSUTF8StringEncoding
                             error:error];

    if (!result) {
        return NO;
    }
    return YES;
}

@end
