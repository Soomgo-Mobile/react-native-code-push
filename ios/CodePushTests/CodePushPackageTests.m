/*
 * Downloading an update's archive and installing what comes out of it.
 *
 * These drive the whole pipeline - download, unzip, restore, merge, folder hash, metadata -
 * against archives served from disk, with only the two seams that reach into the app binary
 * replaced. The wiring between those steps is where an archive that is not what it claims
 * has to be caught, so nothing in between stands in for the real thing.
 */

#import <XCTest/XCTest.h>
#import "CodePush.h"
#import "CodePushBinaryPatch.h"
#import "CodePushTestHelpers.h"

/*
 * The package's path guard and its root on disk are internal to the class. Objective-C
 * dispatch finds them at runtime, so declaring them here is all a test needs.
 */
@interface CodePushPackage (TestAccess)
+ (NSString *)pathInsideFolder:(NSString *)folderPath relativePath:(NSString *)relativePath;
+ (NSString *)getCodePushPath;
@end

static NSString *const ExpectedBundleFileName = @"main.jsbundle";
/* The metadata the install writes last, which is not part of the contents the hash is for. */
static NSString *const UpdateMetadataFileName = @"app.json";

static NSData *CPTestBytes(NSString *text) {
    return [text dataUsingEncoding:NSUTF8StringEncoding];
}

@interface CodePushPackageTests : XCTestCase
@property (nonatomic, copy) NSString *servingFolder;   // the archives, served over file://
@property (nonatomic, copy) NSString *binaryFolder;    // what the app binary ships with
@property (nonatomic, strong) NSMutableArray *progressEvents;
@property (nonatomic, strong) NSMutableArray<NSString *> *temporaryFolders;
@property (nonatomic) IMP originalBinaryBundleURL;
@property (nonatomic) IMP originalBundleAssetsPath;
@end

@implementation CodePushPackageTests

- (void)setUp {
    [super setUp];
    [CodePush setUsingTestConfiguration:YES];
    [CodePushPackage clearUpdates];
    self.temporaryFolders = [NSMutableArray array];
    self.servingFolder = [self makeTemporaryFolder];
    self.progressEvents = [NSMutableArray array];

    // The bundle that shipped inside the binary is the one the patch fixture was computed
    // against, and the assets beside it are what a diff with nothing installed falls back on.
    self.binaryFolder = [self makeTemporaryFolder];
    CPTestWriteFile([self.binaryFolder stringByAppendingPathComponent:ExpectedBundleFileName],
                    CPTestFixture(@"base.bundle"));
    CPTestWriteFile([self.binaryFolder stringByAppendingPathComponent:@"assets/binary.png"],
                    CPTestBytes(@"an asset that shipped inside the binary"));

    NSURL *bundleURL = [NSURL fileURLWithPath:[self.binaryFolder stringByAppendingPathComponent:ExpectedBundleFileName]];
    NSString *assetsPath = [self.binaryFolder stringByAppendingPathComponent:@"assets"];
    self.originalBinaryBundleURL = CPTestReplaceClassMethod([CodePush class], @selector(binaryBundleURL),
                                                            ^NSURL *(id self) { return bundleURL; });
    self.originalBundleAssetsPath = CPTestReplaceClassMethod([CodePush class], @selector(bundleAssetsPath),
                                                             ^NSString *(id self) { return assetsPath; });
}

- (void)tearDown {
    CPTestRestoreClassMethod([CodePush class], @selector(binaryBundleURL), self.originalBinaryBundleURL);
    CPTestRestoreClassMethod([CodePush class], @selector(bundleAssetsPath), self.originalBundleAssetsPath);
    [CodePushPackage clearUpdates];
    [CodePush setUsingTestConfiguration:NO];
    for (NSString *folder in self.temporaryFolders) {
        [[NSFileManager defaultManager] removeItemAtPath:folder error:nil];
    }
    [super tearDown];
}

#pragma mark - Running a download

/* Every folder a scenario stages, so a run leaves nothing of itself behind. */
- (NSString *)makeTemporaryFolder {
    NSString *folder = CPTestMakeTempDirectory();
    [self.temporaryFolders addObject:folder];
    return folder;
}

/* Zips a staged folder into the serving folder and returns the URL it is served from. */
- (NSString *)serveArchive:(NSString *)stagingFolder named:(NSString *)name {
    NSString *zipPath = [self.servingFolder stringByAppendingPathComponent:name];
    XCTAssertTrue(CPTestZipFolderContents(stagingFolder, zipPath), @"%@ could not be zipped", stagingFolder);
    return [[NSURL fileURLWithPath:zipPath] absoluteString];
}

/* The URL of a file served as it is, which is how an archive that is not one arrives. */
- (NSString *)serveBytes:(NSData *)body named:(NSString *)name {
    NSString *path = [self.servingFolder stringByAppendingPathComponent:name];
    CPTestWriteFile(path, body);
    return [[NSURL fileURLWithPath:path] absoluteString];
}

/* The URL of a file the serving folder does not hold, which no download can complete. */
- (NSString *)urlOfMissingFileNamed:(NSString *)name {
    return [[NSURL fileURLWithPath:[self.servingFolder stringByAppendingPathComponent:name]] absoluteString];
}

/* Runs a download to its end and hands back what it reported about the patch attempt. */
- (NSDictionary *)downloadPackage:(NSDictionary *)updatePackage error:(NSError **)outError {
    dispatch_queue_t queue = dispatch_queue_create("codepush.test.download", DISPATCH_QUEUE_SERIAL);
    XCTestExpectation *finished = [self expectationWithDescription:@"download finished"];
    __block NSDictionary *patchResult = nil;
    __block NSError *failure = nil;
    // The callbacks all arrive on the serial queue above, so the events they record are
    // written there and only read once the wait below has returned.
    NSMutableArray *events = self.progressEvents;
    [CodePushPackage downloadPackage:updatePackage
              expectedBundleFileName:ExpectedBundleFileName
                      operationQueue:queue
                    progressCallback:^(long long expected, long long received) {
                        [events addObject:@[@(expected), @(received)]];
                    }
                        doneCallback:^(NSDictionary *updateArchiveResult) {
                            patchResult = updateArchiveResult;
                            [finished fulfill];
                        }
                        failCallback:^(NSError *error) {
                            failure = error;
                            [finished fulfill];
                        }];
    [self waitForExpectations:@[finished] timeout:60];
    if (outError != NULL) { *outError = failure; }
    return patchResult;
}

/*
 * Downloads an update in full and makes it the current package, which is what the asset
 * diff of a later release is merged into.
 */
- (NSString *)installPackageWithContents:(NSString *)stagingFolder {
    NSString *packageHash = CPTestFolderHash(stagingFolder);
    NSError *error = nil;
    [self downloadPackage:@{ @"packageHash": packageHash,
                             @"downloadUrl": [self serveArchive:stagingFolder named:@"installed.zip"] }
                    error:&error];
    XCTAssertNil(error);
    XCTAssertTrue([CodePushPackage installPackage:@{ @"packageHash": packageHash }
                              removePendingUpdate:NO
                                            error:&error]);
    XCTAssertNil(error);
    return packageHash;
}

#pragma mark - Archive staging

/* Writes the entries of an archive - or of the update they add up to - into a folder. */
- (NSString *)stageContents:(NSDictionary<NSString *, NSData *> *)contents {
    NSString *staging = [self makeTemporaryFolder];
    for (NSString *relativePath in contents) {
        CPTestWriteFile([staging stringByAppendingPathComponent:relativePath], contents[relativePath]);
    }
    return staging;
}

- (NSData *)patchManifest {
    return [NSJSONSerialization dataWithJSONObject:CPTestValidPatchManifest()
                                           options:kNilOptions
                                             error:nil];
}

/*
 * The update's full archive, which is also the contents every archive of it has to add up
 * to and so the folder the package hash is computed over.
 */
- (NSString *)stageFullArchiveContents {
    return [self stageContents:@{
        @"CodePush/main.jsbundle": CPTestFixture(@"target.bundle"),
        @"CodePush/assets/logo.png": CPTestBytes(@"an image the update ships with"),
    }];
}

/* The same update as a patch archive: the bundle replaced by a patch of it and a manifest. */
- (NSString *)stagePatchArchiveContents {
    return [self stageContents:@{
        @"CodePush/codepush-binary-patch.json": [self patchManifest],
        @"CodePush/main.jsbundle.patch": CPTestFixture(@"update.patch"),
        @"CodePush/assets/logo.png": CPTestBytes(@"an image the update ships with"),
    }];
}

/* The full archive of the release that is installed when the asset diff arrives. */
- (NSString *)stageInstalledArchiveContents {
    return [self stageContents:@{
        @"CodePush/main.jsbundle": CPTestBytes(@"the bundle of the update already installed"),
        @"CodePush/assets/logo.png": CPTestBytes(@"an image the update ships with"),
        @"CodePush/assets/legacy.png": CPTestBytes(@"an image the newer update leaves behind"),
    }];
}

/* The patch archive of the release the asset diff belongs to: every asset, no merge. */
- (NSString *)stagePatchArchiveContentsForAssetDiffTarget {
    return [self stageContents:@{
        @"CodePush/codepush-binary-patch.json": [self patchManifest],
        @"CodePush/main.jsbundle.patch": CPTestFixture(@"update.patch"),
        @"CodePush/assets/logo.png": CPTestBytes(@"an image the update ships with"),
        @"CodePush/assets/badge.png": CPTestBytes(@"an image only the newer update ships"),
    }];
}

/*
 * An asset diff archive: the patch archive carrying only the assets the update changes, plus
 * the manifest of the files to delete at the archive root, beside the contents directory the
 * manifest's paths are relative to. An asset the installed package already holds unchanged is
 * not shipped at all - the client copies it over.
 */
- (NSString *)stageAssetDiffArchiveContentsDeleting:(NSArray<NSString *> *)deletedFiles {
    return [self stageAssetDiffArchiveContentsWithManifest:
            [NSJSONSerialization dataWithJSONObject:@{ @"deletedFiles": deletedFiles }
                                            options:kNilOptions
                                              error:nil]];
}

/* The same archive carrying a manifest of its own, which is how one the CLI did not write arrives. */
- (NSString *)stageAssetDiffArchiveContentsWithManifest:(NSData *)manifest {
    return [self stageContents:@{
        @"hotcodepush.json": manifest,
        @"CodePush/codepush-binary-patch.json": [self patchManifest],
        @"CodePush/main.jsbundle.patch": CPTestFixture(@"update.patch"),
        @"CodePush/assets/badge.png": CPTestBytes(@"an image only the newer update ships"),
    }];
}

/* What an asset diff merged into the installed package has to add up to. */
- (NSString *)stageAssetDiffTargetContents {
    return [self stageContents:@{
        @"CodePush/main.jsbundle": CPTestFixture(@"target.bundle"),
        @"CodePush/assets/logo.png": CPTestBytes(@"an image the update ships with"),
        @"CodePush/assets/badge.png": CPTestBytes(@"an image only the newer update ships"),
    }];
}

#pragma mark - Asserting the outcome

/* Every file under a folder, keyed by its path relative to that folder. */
- (NSDictionary<NSString *, NSData *> *)filesUnder:(NSString *)folder {
    NSMutableDictionary *files = [NSMutableDictionary dictionary];
    NSDirectoryEnumerator *entries = [[NSFileManager defaultManager] enumeratorAtPath:folder];
    for (NSString *relativePath in entries) {
        if ([[entries.fileAttributes fileType] isEqualToString:NSFileTypeDirectory]) {
            continue;
        }
        files[relativePath] = [NSData dataWithContentsOfFile:[folder stringByAppendingPathComponent:relativePath]];
    }

    return files;
}

/*
 * The update installed under a hash is the staged contents and nothing else, which is the
 * whole question for an update that was rebuilt from parts of two archives.
 */
- (void)assertInstalledContentsOf:(NSString *)packageHash matchStaging:(NSString *)stagingFolder {
    NSMutableDictionary *installed = [[self filesUnder:[CodePushPackage getPackageFolderPath:packageHash]] mutableCopy];
    // Written last, so its presence also says the folder hash check passed.
    XCTAssertNotNil(installed[UpdateMetadataFileName], @"the update was installed without its metadata");
    [installed removeObjectForKey:UpdateMetadataFileName];

    NSDictionary *expected = [self filesUnder:stagingFolder];
    XCTAssertEqualObjects([NSSet setWithArray:installed.allKeys], [NSSet setWithArray:expected.allKeys],
                          @"the installed files");
    // Hashed rather than compared as data, so that a mismatch reports two hashes instead of
    // two bundles.
    for (NSString *relativePath in expected) {
        XCTAssertEqualObjects(CPTestSha256Hex(installed[relativePath]), CPTestSha256Hex(expected[relativePath]),
                              @"the contents of %@", relativePath);
    }
}

/* The result of an attempt the update had to be downloaded in full after. */
- (void)assertFallbackResult:(NSDictionary *)result reason:(NSString *)expectedReason {
    XCTAssertEqualObjects(result[@"status"], @"fallback");
    XCTAssertEqualObjects(result[@"fallbackReason"], expectedReason);
    XCTAssertGreaterThanOrEqual([result[@"totalDurationMs"] doubleValue], 0, @"the whole path is timed");
    XCTAssertNil(result[@"applyDurationMs"], @"the result no longer carries a top level apply time");
}

/* Where a patch attempt does its work, which no attempt may leave behind. */
- (NSString *)binaryPatchFolder {
    return [[CodePushPackage getCodePushPath] stringByAppendingPathComponent:@"binary-patch"];
}

/*
 * What an attempt that was killed halfway through leaves in the working directory. Only the
 * download clears this on a patch URL that never reaches the applier, so planting it is what
 * gives the assertion below something of the download's own to observe.
 */
- (void)plantAbandonedBinaryPatchWorkingDirectory {
    NSString *leftover = [[self binaryPatchFolder] stringByAppendingPathComponent:@"leftover.txt"];
    CPTestWriteFile(leftover, CPTestBytes(@"half of an earlier restore"));
    XCTAssertTrue([[NSFileManager defaultManager] fileExistsAtPath:leftover],
                  @"the abandoned working directory was not planted");
}

- (void)assertBinaryPatchFolderRemoved {
    XCTAssertFalse([[NSFileManager defaultManager] fileExistsAtPath:[self binaryPatchFolder]],
                   @"the working directory outlived the patch attempt");
}

#pragma mark - Installing

- (void)testInstallsAnUpdateFromItsFullArchive {
    NSString *fullStaging = [self stageFullArchiveContents];
    NSString *packageHash = CPTestFolderHash(fullStaging);

    NSError *error = nil;
    NSDictionary *result = [self downloadPackage:@{
        @"packageHash": packageHash,
        @"downloadUrl": [self serveArchive:fullStaging named:@"full.zip"],
    } error:&error];

    XCTAssertNil(error);
    XCTAssertNil(result, @"a download that never had a patch to try reported one anyway");
    [self assertInstalledContentsOf:packageHash matchStaging:fullStaging];
}

- (void)testInstallsAnUpdateFromItsBinaryPatchArchive {
    NSString *fullStaging = [self stageFullArchiveContents];
    NSString *packageHash = CPTestFolderHash(fullStaging);

    NSError *error = nil;
    NSDictionary *result = [self downloadPackage:@{
        @"packageHash": packageHash,
        @"downloadUrl": [self serveArchive:fullStaging named:@"full.zip"],
        @"binaryPatchDownloadUrl": [self serveArchive:[self stagePatchArchiveContents] named:@"patch.zip"],
    } error:&error];

    XCTAssertNil(error);
    XCTAssertEqualObjects(result[@"status"], @"applied");
    XCTAssertNil(result[@"fallbackReason"], @"an applied patch has nothing to report a reason for");
    XCTAssertGreaterThanOrEqual([result[@"totalDurationMs"] doubleValue], 0, @"the whole path is timed");
    XCTAssertNil(result[@"applyDurationMs"], @"the result no longer carries a top level apply time");

    NSDictionary *appliedAttempt = [result[@"attempts"] lastObject];
    XCTAssertNotNil(appliedAttempt[@"applyDurationMs"], @"an applied attempt carries its apply time");
    XCTAssertGreaterThanOrEqual([appliedAttempt[@"applyDurationMs"] doubleValue], 0);
    [self assertInstalledContentsOf:packageHash matchStaging:fullStaging];
    [self assertBinaryPatchFolderRemoved];
}

#pragma mark - Falling back to the full archive

- (void)testFallsBackToTheFullArchiveWhenThePatchUrlDoesNotServeAnArchive {
    // A CDN that answers an error page with a 200 is the realistic way this happens.
    NSString *fullStaging = [self stageFullArchiveContents];
    NSString *packageHash = CPTestFolderHash(fullStaging);

    NSError *error = nil;
    NSDictionary *result = [self downloadPackage:@{
        @"packageHash": packageHash,
        @"downloadUrl": [self serveArchive:fullStaging named:@"full.zip"],
        @"binaryPatchDownloadUrl": [self serveBytes:CPTestBytes(@"<html><body>404 Not Found</body></html>")
                                              named:@"patch.zip"],
    } error:&error];

    XCTAssertNil(error);
    [self assertFallbackResult:result reason:CodePushArchiveFallbackReasonInvalidManifest];
    [self assertInstalledContentsOf:packageHash matchStaging:fullStaging];
}

- (void)testFallsBackToTheFullArchiveWhenThePatchArchiveCannotBeDownloaded {
    NSString *fullStaging = [self stageFullArchiveContents];
    NSString *packageHash = CPTestFolderHash(fullStaging);

    NSError *error = nil;
    NSDictionary *result = [self downloadPackage:@{
        @"packageHash": packageHash,
        @"downloadUrl": [self serveArchive:fullStaging named:@"full.zip"],
        @"binaryPatchDownloadUrl": [self urlOfMissingFileNamed:@"patch.zip"],
    } error:&error];

    XCTAssertNil(error);
    // A patch archive that never arrived is not one of the outcomes the appliers have a word
    // for, and no word is invented for it here.
    [self assertFallbackResult:result reason:nil];
    [self assertInstalledContentsOf:packageHash matchStaging:fullStaging];
}

- (void)testFallsBackToTheFullArchiveWhenApplyingThePatchFails {
    NSString *fullStaging = [self stageFullArchiveContents];
    NSString *packageHash = CPTestFolderHash(fullStaging);
    NSString *patchStaging = [self stagePatchArchiveContents];
    CPTestWriteFile([patchStaging stringByAppendingPathComponent:@"CodePush/main.jsbundle.patch"],
                    CPTestBytes(@"the difference between the two"));

    NSError *error = nil;
    NSDictionary *result = [self downloadPackage:@{
        @"packageHash": packageHash,
        @"downloadUrl": [self serveArchive:fullStaging named:@"full.zip"],
        @"binaryPatchDownloadUrl": [self serveArchive:patchStaging named:@"patch.zip"],
    } error:&error];

    XCTAssertNil(error);
    [self assertFallbackResult:result reason:CodePushArchiveFallbackReasonPatchApplyFailed];
    [self assertInstalledContentsOf:packageHash matchStaging:fullStaging];
}

- (void)testReportsAPackageVerificationFailureWhenTheRestoredUpdateIsNotTheOneTheMetadataPromises {
    // The patch archive carries an asset the release was not published with, so the bundle it
    // restores is the promised one while the update it makes is not.
    NSString *fullStaging = [self stageFullArchiveContents];
    NSString *packageHash = CPTestFolderHash(fullStaging);
    NSString *patchStaging = [self stagePatchArchiveContents];
    CPTestWriteFile([patchStaging stringByAppendingPathComponent:@"CodePush/assets/extra.png"],
                    CPTestBytes(@"an image from some other release"));

    NSError *error = nil;
    NSDictionary *result = [self downloadPackage:@{
        @"packageHash": packageHash,
        @"downloadUrl": [self serveArchive:fullStaging named:@"full.zip"],
        @"binaryPatchDownloadUrl": [self serveArchive:patchStaging named:@"patch.zip"],
    } error:&error];

    XCTAssertNil(error);
    [self assertFallbackResult:result reason:CodePushArchiveFallbackReasonPackageVerificationFailed];
    [self assertInstalledContentsOf:packageHash matchStaging:fullStaging];
}

#pragma mark - Merging an asset diff

- (void)testInstallsAnAssetDiffUpdateByMergingWithTheInstalledPackage {
    [self installPackageWithContents:[self stageInstalledArchiveContents]];
    NSString *updateStaging = [self stageAssetDiffTargetContents];
    NSString *packageHash = CPTestFolderHash(updateStaging);

    NSError *error = nil;
    NSDictionary *result = [self downloadPackage:@{
        @"packageHash": packageHash,
        @"downloadUrl": [self serveArchive:updateStaging named:@"full.zip"],
        @"binaryPatchDownloadUrl": [self serveArchive:[self stageAssetDiffArchiveContentsDeleting:@[@"CodePush/assets/legacy.png"]]
                                                named:@"diff.zip"],
    } error:&error];

    XCTAssertNil(error);
    XCTAssertEqualObjects(result[@"status"], @"applied");
    // The asset the diff leaves out is carried over from the installed package, and the one
    // its manifest names is not.
    [self assertInstalledContentsOf:packageHash matchStaging:updateStaging];
}

- (void)testFallsBackToTheFullArchiveWhenTheAssetDiffMergeYieldsTheWrongContents {
    // A manifest that deletes an asset the update keeps: the merge ends up missing a file the
    // release was published with, and the update is not the one the hash is for.
    [self installPackageWithContents:[self stageInstalledArchiveContents]];
    NSString *updateStaging = [self stageAssetDiffTargetContents];
    NSString *packageHash = CPTestFolderHash(updateStaging);

    NSError *error = nil;
    NSDictionary *result = [self downloadPackage:@{
        @"packageHash": packageHash,
        @"downloadUrl": [self serveArchive:updateStaging named:@"full.zip"],
        @"binaryPatchDownloadUrl": [self serveArchive:[self stageAssetDiffArchiveContentsDeleting:@[@"CodePush/assets/logo.png"]]
                                                named:@"diff.zip"],
    } error:&error];

    XCTAssertNil(error);
    [self assertFallbackResult:result reason:CodePushArchiveFallbackReasonPackageVerificationFailed];
    [self assertInstalledContentsOf:packageHash matchStaging:updateStaging];
}

#pragma mark - The archive ladder of a diff served next to its patch

- (void)testInstallsAnAssetDiffUpdateFromItsOwnUrlNextToThePatchUrl {
    [self installPackageWithContents:[self stageInstalledArchiveContents]];
    NSString *updateStaging = [self stageAssetDiffTargetContents];
    NSString *packageHash = CPTestFolderHash(updateStaging);

    NSError *error = nil;
    NSDictionary *result = [self downloadPackage:@{
        @"packageHash": packageHash,
        @"downloadUrl": [self serveArchive:updateStaging named:@"full.zip"],
        @"binaryPatchDownloadUrl": [self serveArchive:[self stagePatchArchiveContentsForAssetDiffTarget]
                                                named:@"patch.zip"],
        @"assetDiffDownloadUrl": [self serveArchive:[self stageAssetDiffArchiveContentsDeleting:@[@"CodePush/assets/legacy.png"]]
                                              named:@"diff.zip"],
    } error:&error];

    XCTAssertNil(error);
    XCTAssertEqualObjects(result[@"status"], @"applied");
    XCTAssertEqualObjects(result[@"archive"], @"asset-diff");
    XCTAssertEqual([result[@"attempts"] count], (NSUInteger)1, @"the patch archive was never needed");
    [self assertInstalledContentsOf:packageHash matchStaging:updateStaging];
}

- (void)testFallsBackToThePatchArchiveWhenTheAssetDiffFailsAfterItsBundleWasRestored {
    // A manifest that deletes an asset the update keeps: the merge completes into contents
    // that are not the released package. That is a failure on the asset side of the diff,
    // which the patch archive does not share, so the patch is the next rung.
    [self installPackageWithContents:[self stageInstalledArchiveContents]];
    NSString *updateStaging = [self stageAssetDiffTargetContents];
    NSString *packageHash = CPTestFolderHash(updateStaging);

    NSError *error = nil;
    NSDictionary *result = [self downloadPackage:@{
        @"packageHash": packageHash,
        @"downloadUrl": [self serveArchive:updateStaging named:@"full.zip"],
        @"binaryPatchDownloadUrl": [self serveArchive:[self stagePatchArchiveContentsForAssetDiffTarget]
                                                named:@"patch.zip"],
        @"assetDiffDownloadUrl": [self serveArchive:[self stageAssetDiffArchiveContentsDeleting:@[@"CodePush/assets/logo.png"]]
                                              named:@"diff.zip"],
    } error:&error];

    XCTAssertNil(error);
    XCTAssertEqualObjects(result[@"status"], @"applied");
    XCTAssertEqualObjects(result[@"archive"], @"binary-patch");
    NSArray *attempts = result[@"attempts"];
    XCTAssertEqual(attempts.count, (NSUInteger)2);
    XCTAssertEqualObjects(attempts[0][@"archive"], @"asset-diff");
    XCTAssertEqualObjects(attempts[0][@"fallbackReason"], CodePushArchiveFallbackReasonPackageVerificationFailed);
    XCTAssertEqualObjects(attempts[1][@"archive"], @"binary-patch");
    XCTAssertNil(attempts[1][@"fallbackReason"], @"the attempt the update was installed from has no reason");

    // The path runs to the end, not to the moment the diff was given up on. The three times
    // are rounded independently, so the sum is compared with a couple of milliseconds of slack.
    double totalDurationMs = [result[@"totalDurationMs"] doubleValue];
    XCTAssertGreaterThanOrEqual(totalDurationMs, [attempts[1][@"durationMs"] doubleValue],
                                @"the total covers the attempt that installed");
    XCTAssertGreaterThanOrEqual(totalDurationMs,
                                [attempts[0][@"durationMs"] doubleValue] + [attempts[1][@"durationMs"] doubleValue] - 2,
                                @"the total covers both attempts");
    [self assertInstalledContentsOf:packageHash matchStaging:updateStaging];
}

- (void)testReportsAnAssetMergeFailureWhenTheInstalledPackageIsGoneFromDisk {
    // The metadata still names the installed update, but its files are gone: the merge has
    // nothing to read, which is a failure of the merge itself rather than of its result.
    NSString *installedHash = [self installPackageWithContents:[self stageInstalledArchiveContents]];
    [[NSFileManager defaultManager] removeItemAtPath:[CodePushPackage getPackageFolderPath:installedHash]
                                               error:nil];

    NSString *updateStaging = [self stageAssetDiffTargetContents];
    NSString *packageHash = CPTestFolderHash(updateStaging);

    NSError *error = nil;
    NSDictionary *result = [self downloadPackage:@{
        @"packageHash": packageHash,
        @"downloadUrl": [self serveArchive:updateStaging named:@"full.zip"],
        @"binaryPatchDownloadUrl": [self serveArchive:[self stagePatchArchiveContentsForAssetDiffTarget]
                                                named:@"patch.zip"],
        @"assetDiffDownloadUrl": [self serveArchive:[self stageAssetDiffArchiveContentsDeleting:@[@"CodePush/assets/legacy.png"]]
                                              named:@"diff.zip"],
    } error:&error];

    XCTAssertNil(error);
    XCTAssertEqualObjects(result[@"status"], @"applied");
    XCTAssertEqualObjects(result[@"archive"], @"binary-patch");
    XCTAssertEqualObjects(result[@"attempts"][0][@"fallbackReason"], CodePushArchiveFallbackReasonAssetMergeFailed);
    [self assertInstalledContentsOf:packageHash matchStaging:updateStaging];
}

- (void)testReportsAnAssetMergeFailureWhenTheAssetDiffManifestCannotBeParsed {
    // Bytes that are not JSON leave nothing to read the deletions out of, so the merge has
    // no way to know what it was supposed to delete - a failure of the merge itself.
    [self installPackageWithContents:[self stageInstalledArchiveContents]];
    NSString *updateStaging = [self stageAssetDiffTargetContents];
    NSString *packageHash = CPTestFolderHash(updateStaging);
    NSString *diffStaging = [self stageAssetDiffArchiveContentsWithManifest:CPTestBytes(@"{\"deletedFiles\":")];

    NSError *error = nil;
    NSDictionary *result = [self downloadPackage:@{
        @"packageHash": packageHash,
        @"downloadUrl": [self serveArchive:updateStaging named:@"full.zip"],
        @"binaryPatchDownloadUrl": [self serveArchive:[self stagePatchArchiveContentsForAssetDiffTarget]
                                                named:@"patch.zip"],
        @"assetDiffDownloadUrl": [self serveArchive:diffStaging named:@"diff.zip"],
    } error:&error];

    XCTAssertNil(error);
    XCTAssertEqualObjects(result[@"status"], @"applied");
    XCTAssertEqualObjects(result[@"archive"], @"binary-patch");
    XCTAssertEqualObjects(result[@"attempts"][0][@"fallbackReason"], CodePushArchiveFallbackReasonAssetMergeFailed);
    [self assertInstalledContentsOf:packageHash matchStaging:updateStaging];
}

- (void)testReportsAnAssetMergeFailureWhenTheAssetDiffManifestDoesNotNameTheFilesToDelete {
    // A manifest without the key is not a manifest with nothing to delete: the CLI always
    // writes it, an empty list included, so its absence says the manifest is not the one the
    // release published - and merging past it would leave behind files the update dropped.
    [self installPackageWithContents:[self stageInstalledArchiveContents]];
    NSString *updateStaging = [self stageAssetDiffTargetContents];
    NSString *packageHash = CPTestFolderHash(updateStaging);
    NSString *diffStaging = [self stageAssetDiffArchiveContentsWithManifest:CPTestBytes(@"{}")];

    NSError *error = nil;
    NSDictionary *result = [self downloadPackage:@{
        @"packageHash": packageHash,
        @"downloadUrl": [self serveArchive:updateStaging named:@"full.zip"],
        @"binaryPatchDownloadUrl": [self serveArchive:[self stagePatchArchiveContentsForAssetDiffTarget]
                                                named:@"patch.zip"],
        @"assetDiffDownloadUrl": [self serveArchive:diffStaging named:@"diff.zip"],
    } error:&error];

    XCTAssertNil(error);
    XCTAssertEqualObjects(result[@"status"], @"applied");
    XCTAssertEqualObjects(result[@"archive"], @"binary-patch");
    XCTAssertEqualObjects(result[@"attempts"][0][@"fallbackReason"], CodePushArchiveFallbackReasonAssetMergeFailed);
    [self assertInstalledContentsOf:packageHash matchStaging:updateStaging];
}

- (void)testMergesAnAssetDiffWhoseManifestDeletesNothing {
    // The shape a release that drops no file is published with, and the one the guard above
    // must let through: the merge keeps everything the installed package had.
    [self installPackageWithContents:[self stageInstalledArchiveContents]];
    NSString *updateStaging = [self stageContents:@{
        @"CodePush/main.jsbundle": CPTestFixture(@"target.bundle"),
        @"CodePush/assets/logo.png": CPTestBytes(@"an image the update ships with"),
        @"CodePush/assets/legacy.png": CPTestBytes(@"an image the newer update leaves behind"),
        @"CodePush/assets/badge.png": CPTestBytes(@"an image only the newer update ships"),
    }];
    NSString *packageHash = CPTestFolderHash(updateStaging);

    NSError *error = nil;
    NSDictionary *result = [self downloadPackage:@{
        @"packageHash": packageHash,
        @"downloadUrl": [self serveArchive:updateStaging named:@"full.zip"],
        @"binaryPatchDownloadUrl": [self serveArchive:[self stagePatchArchiveContentsForAssetDiffTarget]
                                                named:@"patch.zip"],
        @"assetDiffDownloadUrl": [self serveArchive:[self stageAssetDiffArchiveContentsDeleting:@[]]
                                              named:@"diff.zip"],
    } error:&error];

    XCTAssertNil(error);
    XCTAssertEqualObjects(result[@"status"], @"applied");
    XCTAssertEqualObjects(result[@"archive"], @"asset-diff");
    [self assertInstalledContentsOf:packageHash matchStaging:updateStaging];
}

- (void)testSkipsThePatchArchiveWhenTheAssetDiffCannotBeDownloaded {
    // A diff that never arrived left no verdict at all: nothing says the patch archive is
    // any better off, and the full download is the one that cannot fail - so a client is
    // never walked through two doomed downloads on its way there.
    [self installPackageWithContents:[self stageInstalledArchiveContents]];
    NSString *updateStaging = [self stageAssetDiffTargetContents];
    NSString *packageHash = CPTestFolderHash(updateStaging);

    NSError *error = nil;
    NSDictionary *result = [self downloadPackage:@{
        @"packageHash": packageHash,
        @"downloadUrl": [self serveArchive:updateStaging named:@"full.zip"],
        @"binaryPatchDownloadUrl": [self serveArchive:[self stagePatchArchiveContentsForAssetDiffTarget]
                                                named:@"patch.zip"],
        @"assetDiffDownloadUrl": [self urlOfMissingFileNamed:@"diff.zip"],
    } error:&error];

    XCTAssertNil(error);
    [self assertFallbackResult:result reason:nil];
    XCTAssertEqualObjects(result[@"archive"], @"asset-diff");
    XCTAssertEqual([result[@"attempts"] count], (NSUInteger)1, @"the patch archive was passed over");
    [self assertInstalledContentsOf:packageHash matchStaging:updateStaging];
}

- (void)testSkipsThePatchArchiveWhenTheAssetDiffFailsInTheBundlePatchBothArchivesCarry {
    [self installPackageWithContents:[self stageInstalledArchiveContents]];
    NSString *updateStaging = [self stageAssetDiffTargetContents];
    NSString *packageHash = CPTestFolderHash(updateStaging);
    NSString *diffStaging = [self stageAssetDiffArchiveContentsDeleting:@[@"CodePush/assets/legacy.png"]];
    CPTestWriteFile([diffStaging stringByAppendingPathComponent:@"CodePush/main.jsbundle.patch"],
                    CPTestBytes(@"the difference between the two"));

    NSError *error = nil;
    NSDictionary *result = [self downloadPackage:@{
        @"packageHash": packageHash,
        @"downloadUrl": [self serveArchive:updateStaging named:@"full.zip"],
        @"binaryPatchDownloadUrl": [self serveArchive:[self stagePatchArchiveContentsForAssetDiffTarget]
                                                named:@"patch.zip"],
        @"assetDiffDownloadUrl": [self serveArchive:diffStaging named:@"diff.zip"],
    } error:&error];

    XCTAssertNil(error);
    // Both archives carry the same bundle patch, so the patch archive could only fail the
    // same way and is passed over for the full one.
    [self assertFallbackResult:result reason:CodePushArchiveFallbackReasonPatchApplyFailed];
    XCTAssertEqualObjects(result[@"archive"], @"asset-diff");
    XCTAssertEqual([result[@"attempts"] count], (NSUInteger)1, @"the patch archive was passed over");
    XCTAssertNil(result[@"attempts"][0][@"applyDurationMs"],
                 @"an attempt that never restored the bundle has no apply to report");
    [self assertInstalledContentsOf:packageHash matchStaging:updateStaging];
}

- (void)testCopiesTheBundledResourcesWhenAnAssetDiffArrivesWithNoInstalledPackage {
    // The platforms part here. With nothing installed there is no package to merge into, so
    // this one copies the bundle and the assets out of the app binary and merges the diff
    // into those - the update installs. The other platform has no such copy to make: its
    // merge leaves the update short of the files the diff counts on, the folder hash refuses
    // it, and the full archive is downloaded instead.
    NSString *updateStaging = [self stageContents:@{
        @"CodePush/main.jsbundle": CPTestFixture(@"target.bundle"),
        @"CodePush/assets/binary.png": CPTestBytes(@"an asset that shipped inside the binary"),
        @"CodePush/assets/badge.png": CPTestBytes(@"an image only the newer update ships"),
    }];
    NSString *packageHash = CPTestFolderHash(updateStaging);

    NSError *error = nil;
    NSDictionary *result = [self downloadPackage:@{
        @"packageHash": packageHash,
        @"downloadUrl": [self serveArchive:updateStaging named:@"full.zip"],
        @"binaryPatchDownloadUrl": [self serveArchive:[self stageAssetDiffArchiveContentsDeleting:@[]]
                                                named:@"diff.zip"],
    } error:&error];

    XCTAssertNil(error);
    XCTAssertEqualObjects(result[@"status"], @"applied");
    [self assertInstalledContentsOf:packageHash matchStaging:updateStaging];
}

- (void)testLeavesAFileOutsideThePackageFolderAloneWhenTheAssetDiffManifestNamesOne {
    // A manifest entry that climbs out of the package folder: the client is not the one that
    // wrote it, so it must not act on it.
    [self installPackageWithContents:[self stageInstalledArchiveContents]];
    NSString *sentinelPath = [[[CodePushPackage getCodePushPath] stringByDeletingLastPathComponent]
                              stringByAppendingPathComponent:@"sentinel.txt"];
    CPTestWriteFile(sentinelPath, CPTestBytes(@"a file the update has no business deleting"));
    // Nothing is deleted from the package, so the merge keeps everything the installed one had.
    NSString *updateStaging = [self stageContents:@{
        @"CodePush/main.jsbundle": CPTestFixture(@"target.bundle"),
        @"CodePush/assets/logo.png": CPTestBytes(@"an image the update ships with"),
        @"CodePush/assets/legacy.png": CPTestBytes(@"an image the newer update leaves behind"),
        @"CodePush/assets/badge.png": CPTestBytes(@"an image only the newer update ships"),
    }];
    NSString *packageHash = CPTestFolderHash(updateStaging);

    NSError *error = nil;
    NSDictionary *result = [self downloadPackage:@{
        @"packageHash": packageHash,
        @"downloadUrl": [self serveArchive:updateStaging named:@"full.zip"],
        @"binaryPatchDownloadUrl": [self serveArchive:[self stageAssetDiffArchiveContentsDeleting:@[@"../../sentinel.txt"]]
                                                named:@"diff.zip"],
    } error:&error];

    XCTAssertNil(error);
    XCTAssertTrue([[NSFileManager defaultManager] fileExistsAtPath:sentinelPath],
                  @"a manifest entry reaching outside the package folder deleted %@", sentinelPath);
    // Skipping it costs the update nothing, so the diff still installs.
    XCTAssertEqualObjects(result[@"status"], @"applied");
    [self assertInstalledContentsOf:packageHash matchStaging:updateStaging];

    // The sentinel sits beside the test packages rather than inside them, so clearing the
    // updates does not take it away.
    [[NSFileManager defaultManager] removeItemAtPath:sentinelPath error:nil];
}

#pragma mark - Reporting the download

- (void)testAnnouncesEachDownloadOfAFallbackAsItsOwnProgressStream {
    NSString *fullStaging = [self stageFullArchiveContents];

    NSError *error = nil;
    [self downloadPackage:@{
        @"packageHash": CPTestFolderHash(fullStaging),
        @"downloadUrl": [self serveArchive:fullStaging named:@"full.zip"],
        @"binaryPatchDownloadUrl": [self serveBytes:CPTestBytes(@"<html><body>404 Not Found</body></html>")
                                              named:@"patch.zip"],
    } error:&error];

    XCTAssertNil(error);
    NSMutableArray *completedTotals = [NSMutableArray array];
    for (NSArray *event in self.progressEvents) {
        if ([event[0] longLongValue] > 0 && [event[0] isEqualToNumber:event[1]]) {
            [completedTotals addObject:event[0]];
        }
    }

    XCTAssertGreaterThanOrEqual(completedTotals.count, (NSUInteger)2,
                                @"each of the two downloads announces the byte it completed on");
    XCTAssertEqual([NSSet setWithArray:completedTotals].count, (NSUInteger)2,
                   @"the two downloads were announced as one stream of a single total: %@", completedTotals);
}

- (void)testRemovesTheBinaryPatchWorkingDirectoryWhateverTheOutcomeIs {
    NSString *fullStaging = [self stageFullArchiveContents];
    NSString *packageHash = CPTestFolderHash(fullStaging);
    NSString *fullUrl = [self serveArchive:fullStaging named:@"full.zip"];

    NSError *error = nil;
    [self downloadPackage:@{
        @"packageHash": packageHash,
        @"downloadUrl": fullUrl,
        @"binaryPatchDownloadUrl": [self serveArchive:[self stagePatchArchiveContents] named:@"patch.zip"],
    } error:&error];
    XCTAssertNil(error);
    // A patch that installed leaves nothing of its attempt behind. The applier empties its own
    // working directory on the way out, so what this pins is the outcome and not who reached it.
    [self assertBinaryPatchFolderRemoved];

    // A patch URL that never serves an archive is refused before the applier is ever called, so
    // whatever an earlier attempt abandoned there is the download's alone to clear up.
    [self plantAbandonedBinaryPatchWorkingDirectory];
    [self downloadPackage:@{
        @"packageHash": packageHash,
        @"downloadUrl": fullUrl,
        @"binaryPatchDownloadUrl": [self serveBytes:CPTestBytes(@"<html><body>404 Not Found</body></html>")
                                              named:@"not-an-archive.zip"],
    } error:&error];
    XCTAssertNil(error);
    [self assertBinaryPatchFolderRemoved];
}

#pragma mark - Path guard

/*
 * The same input table the applier's guard is held to. The two are twins that must not
 * drift apart, so each is pinned where it lives.
 */
- (void)testRefusesAManifestPathThatLeavesTheFolderInThePackageGuard {
    NSString *folder = [self makeTemporaryFolder];

    XCTAssertNil([CodePushPackage pathInsideFolder:folder relativePath:@"../outside.txt"]);
    XCTAssertNil([CodePushPackage pathInsideFolder:folder relativePath:@"a/../../outside.txt"]);
    XCTAssertNil([CodePushPackage pathInsideFolder:folder relativePath:@"/etc/passwd"]);
    XCTAssertNil([CodePushPackage pathInsideFolder:folder relativePath:@""]);
    XCTAssertNil([CodePushPackage pathInsideFolder:folder relativePath:nil]);

    // The simulator reaches its temp folder through a symlink, so both sides standardize.
    XCTAssertEqualObjects([[CodePushPackage pathInsideFolder:folder relativePath:@"CodePush/assets/logo.png"] stringByStandardizingPath],
                          [[folder stringByAppendingPathComponent:@"CodePush/assets/logo.png"] stringByStandardizingPath]);
    XCTAssertEqualObjects([[CodePushPackage pathInsideFolder:folder relativePath:@"CodePush/../main.jsbundle"] stringByStandardizingPath],
                          [[folder stringByAppendingPathComponent:@"main.jsbundle"] stringByStandardizingPath]);
}

@end
