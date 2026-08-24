/*
 * Two of the scenarios the applier of the other platform is tested against have no
 * counterpart among the restore scenarios below:
 *
 *   - a missing native library. The applier is compiled into the app binary here, so
 *     there is no library that could fail to load.
 *   - a restored bundle of another size. The applier compares the size the manifest
 *     promises against the patch header before it writes a byte, so a size that does not
 *     match is refused as a failed apply long before the restored bundle is verified.
 *     testReportsAFailedApplyWhenTheManifestPromisesAnotherSize covers it in that place.
 */

#import <XCTest/XCTest.h>
#import "CodePush.h"
#import "CodePushBinaryPatch.h"
#import "CodePushTestHelpers.h"

/*
 * The resolution and guard methods are internal to their classes. Objective-C
 * dispatch finds them at runtime, so declaring them here is all a test needs.
 */
@interface CodePushBinaryPatch (TestAccess)
+ (NSString *)contentsFolderInUnzippedFolder:(NSString *)unzippedFolderPath;
+ (NSString *)pathInsideFolder:(NSString *)folderPath relativePath:(NSString *)relativePath;
@end

static NSString *const AssetDiffManifestFileName = @"hotcodepush.json";
static NSString *const BinaryPatchManifestFileName = @"codepush-binary-patch.json";
static NSString *const BinaryPatchFileName = @"main.jsbundle.patch";
static NSString *const BundleFileName = @"main.jsbundle";

@interface CodePushBinaryPatchTests : XCTestCase
@property (nonatomic, copy) NSString *root;
@end

@implementation CodePushBinaryPatchTests

- (void)setUp {
    [super setUp];
    self.root = CPTestMakeTempDirectory();
}

- (void)tearDown {
    [[NSFileManager defaultManager] removeItemAtPath:self.root error:nil];
    [super tearDown];
}

- (NSString *)makeFile:(NSString *)name {
    NSString *path = [self.root stringByAppendingPathComponent:name];
    CPTestWriteFile(path, [NSData dataWithBytes:"x" length:1]);
    return path;
}

- (NSString *)makeDirectory:(NSString *)name {
    NSString *path = [self.root stringByAppendingPathComponent:name];
    NSError *error = nil;
    XCTAssertTrue([[NSFileManager defaultManager] createDirectoryAtPath:path
                                            withIntermediateDirectories:YES
                                                             attributes:nil
                                                                  error:&error],
                  @"%@", error);
    return path;
}

/* The simulator reaches its temp folder through a symlink, so both sides standardize. */
- (NSString *)rootPath:(NSString *)relativePath {
    return [[self.root stringByAppendingPathComponent:relativePath] stringByStandardizingPath];
}

#pragma mark - Archive shape

- (void)testResolvesAnEmptyFolderAsItsOwnContentsRoot {
    XCTAssertEqualObjects([CodePushBinaryPatch contentsFolderInUnzippedFolder:self.root], self.root);
}

- (void)testResolvesAFolderOfOneFileAsItsOwnContentsRoot {
    [self makeFile:@"main.jsbundle"];
    XCTAssertEqualObjects([CodePushBinaryPatch contentsFolderInUnzippedFolder:self.root], self.root);
}

- (void)testUnwrapsTheSingleDirectoryInsideTheFolder {
    NSString *wrapper = [self makeDirectory:@"CodePush"];
    XCTAssertEqualObjects([CodePushBinaryPatch contentsFolderInUnzippedFolder:self.root], wrapper);
}

- (void)testResolvesAFolderOfTwoDirectoriesAsItsOwnContentsRoot {
    [self makeDirectory:@"CodePush"];
    [self makeDirectory:@"assets"];
    XCTAssertEqualObjects([CodePushBinaryPatch contentsFolderInUnzippedFolder:self.root], self.root);
}

- (void)testResolvesAFolderOfADirectoryAndAFileAsItsOwnContentsRoot {
    [self makeDirectory:@"assets"];
    [self makeFile:@"main.jsbundle"];
    XCTAssertEqualObjects([CodePushBinaryPatch contentsFolderInUnzippedFolder:self.root], self.root);
}

- (void)testResolvesAFolderOfOnlyTheAssetDiffManifestAsItsOwnContentsRoot {
    [self makeFile:AssetDiffManifestFileName];
    XCTAssertEqualObjects([CodePushBinaryPatch contentsFolderInUnzippedFolder:self.root], self.root);
}

- (void)testUnwrapsTheSingleDirectoryBesideTheAssetDiffManifest {
    CPTestWriteFile([self.root stringByAppendingPathComponent:AssetDiffManifestFileName],
                    [@"{\"deletedFiles\":[]}" dataUsingEncoding:NSUTF8StringEncoding]);
    NSString *wrapper = [self makeDirectory:@"CodePush"];
    XCTAssertEqualObjects([CodePushBinaryPatch contentsFolderInUnzippedFolder:self.root], wrapper);
}

- (void)testResolvesAFolderOfTheAssetDiffManifestAndAFileAsItsOwnContentsRoot {
    [self makeFile:AssetDiffManifestFileName];
    [self makeFile:@"main.jsbundle"];
    XCTAssertEqualObjects([CodePushBinaryPatch contentsFolderInUnzippedFolder:self.root], self.root);
}

#pragma mark - Path guard

- (void)testRefusesAManifestPathThatLeavesTheFolder {
    XCTAssertNil([CodePushBinaryPatch pathInsideFolder:self.root relativePath:@"../outside.txt"]);
    XCTAssertNil([CodePushBinaryPatch pathInsideFolder:self.root relativePath:@"a/../../outside.txt"]);
    XCTAssertNil([CodePushBinaryPatch pathInsideFolder:self.root relativePath:@"/etc/passwd"]);
    XCTAssertNil([CodePushBinaryPatch pathInsideFolder:self.root relativePath:@""]);
}

- (void)testRefusesAMissingManifestPath {
    XCTAssertNil([CodePushBinaryPatch pathInsideFolder:self.root relativePath:nil]);
}

- (void)testResolvesAManifestPathAgainstTheFolder {
    NSString *bundle = [CodePushBinaryPatch pathInsideFolder:self.root relativePath:@"main.jsbundle"];
    XCTAssertEqualObjects([bundle stringByStandardizingPath], [self rootPath:@"main.jsbundle"]);

    NSString *asset = [CodePushBinaryPatch pathInsideFolder:self.root relativePath:@"assets/img/logo.png"];
    XCTAssertEqualObjects([asset stringByStandardizingPath], [self rootPath:@"assets/img/logo.png"]);
}

- (void)testResolvesAManifestPathThatWalksBackInsideTheFolder {
    NSString *bundle = [CodePushBinaryPatch pathInsideFolder:self.root relativePath:@"assets/../main.jsbundle"];
    XCTAssertEqualObjects([bundle stringByStandardizingPath], [self rootPath:@"main.jsbundle"]);
}

@end

/*
 * The restore itself, against the patch the CLI produced from the two bundle fixtures.
 * Nothing here stands in for the applier: every scenario runs the real one.
 *
 * These own their temp root rather than sharing the one above, because the shape tests
 * read the whole of theirs and an archive laid out beside them would change what they see.
 */
@interface CodePushBinaryPatchRestoreTests : XCTestCase
@property (nonatomic, copy) NSString *root;
@property (nonatomic, copy) NSString *contentsFolder;
@property (nonatomic, copy) NSString *workingFolder;
@property (nonatomic, copy) NSString *baseBundlePath;
@property (nonatomic, strong) NSMutableDictionary *manifest;
@end

@implementation CodePushBinaryPatchRestoreTests

/* A patch archive as it arrives, beside the bundle the patch was computed against. Each
 * scenario below changes one thing about that. */
- (void)setUp {
    [super setUp];
    self.root = CPTestMakeTempDirectory();
    self.contentsFolder = [self.root stringByAppendingPathComponent:@"contents"];
    self.workingFolder = [self.root stringByAppendingPathComponent:@"working"];
    self.baseBundlePath = [self.root stringByAppendingPathComponent:@"base.bundle"];
    CPTestWriteFile(self.baseBundlePath, CPTestFixture(@"base.bundle"));
    CPTestWriteFile([self contentsPath:BinaryPatchFileName], CPTestFixture(@"update.patch"));
    self.manifest = CPTestValidPatchManifest();
    [self writePatchManifest:self.manifest];
}

- (void)tearDown {
    [[NSFileManager defaultManager] removeItemAtPath:self.root error:nil];
    [super tearDown];
}

#pragma mark - Helpers

- (NSString *)contentsPath:(NSString *)relativePath {
    return [self.contentsFolder stringByAppendingPathComponent:relativePath];
}

- (BOOL)fileExists:(NSString *)path {
    return [[NSFileManager defaultManager] fileExistsAtPath:path];
}

- (void)writePatchManifest:(NSDictionary *)manifest {
    NSData *json = [NSJSONSerialization dataWithJSONObject:manifest options:kNilOptions error:nil];
    CPTestWriteFile([self contentsPath:BinaryPatchManifestFileName], json);
}

/** Rewrites the manifest with one of its values replaced. */
- (void)writePatchManifestWithValue:(id)value forKey:(NSString *)key {
    self.manifest[key] = value;
    [self writePatchManifest:self.manifest];
}

/** Moves the archive's files into a wrapper directory, as an archive carrying one arrives. */
- (NSString *)wrapArchiveContentsInDirectory:(NSString *)name {
    NSFileManager *fileManager = [NSFileManager defaultManager];
    NSString *wrapper = [self contentsPath:name];
    NSError *error = nil;
    XCTAssertTrue([fileManager createDirectoryAtPath:wrapper
                         withIntermediateDirectories:YES
                                          attributes:nil
                                               error:&error], @"%@", error);
    for (NSString *file in @[BinaryPatchFileName, BinaryPatchManifestFileName]) {
        XCTAssertTrue([fileManager moveItemAtPath:[self contentsPath:file]
                                           toPath:[wrapper stringByAppendingPathComponent:file]
                                            error:&error], @"%@", error);
    }
    return wrapper;
}

- (void)removeFileAtPath:(NSString *)path {
    NSError *error = nil;
    XCTAssertTrue([[NSFileManager defaultManager] removeItemAtPath:path error:&error], @"%@", error);
}

- (BOOL)restoreBundleWithFailureReason:(NSString **)failureReason {
    return [CodePushBinaryPatch restoreBundleInUnzippedFolder:self.contentsFolder
                                                workingFolder:self.workingFolder
                                                baseBundleURL:[NSURL fileURLWithPath:self.baseBundlePath]
                                                failureReason:failureReason];
}

- (void)assertRestoreSucceeds {
    NSString *reason = nil;
    XCTAssertTrue([self restoreBundleWithFailureReason:&reason], @"the restore failed with %@", reason);
    XCTAssertFalse([self fileExists:self.workingFolder],
                   @"the working directory outlived the patch attempt");
}

- (void)assertFailureReason:(NSString *)expected {
    NSString *reason = nil;
    XCTAssertFalse([self restoreBundleWithFailureReason:&reason]);
    XCTAssertEqualObjects(reason, expected);
    XCTAssertFalse([self fileExists:self.workingFolder],
                   @"the working directory outlived the patch attempt");
}

/* Hashed rather than compared as data, so that a mismatch reports two hashes instead of
 * two bundles. */
- (void)assertTargetBundleAtPath:(NSString *)path {
    NSData *restored = [NSData dataWithContentsOfFile:path];
    XCTAssertNotNil(restored, @"no bundle was restored at %@", path);
    XCTAssertEqualObjects(CPTestSha256Hex(restored), CPTestSha256Hex(CPTestFixture(@"target.bundle")),
                          @"the restored bundle is not the target bundle");
}

#pragma mark - Restoring

- (void)testAppliesAPatchAndLeavesTheContentsOfAFullArchiveBehind {
    [self assertRestoreSucceeds];
    [self assertTargetBundleAtPath:[self contentsPath:BundleFileName]];
    XCTAssertFalse([self fileExists:[self contentsPath:BinaryPatchFileName]],
                   @"the patch is still among the update contents");
    XCTAssertFalse([self fileExists:[self contentsPath:BinaryPatchManifestFileName]],
                   @"the patch manifest is still among the update contents");
}

- (void)testAppliesAPatchThatSitsInTheArchivesOwnRootDirectory {
    NSString *wrapper = [self wrapArchiveContentsInDirectory:@"CodePush"];
    [self assertRestoreSucceeds];
    [self assertTargetBundleAtPath:[wrapper stringByAppendingPathComponent:BundleFileName]];
}

- (void)testRestoresTheBundleWhenTheDiffManifestSitsBesideTheContentsDirectory {
    NSString *wrapper = [self wrapArchiveContentsInDirectory:@"CodePush"];
    NSString *assetPath = [wrapper stringByAppendingPathComponent:@"assets/logo.png"];
    CPTestWriteFile(assetPath, [@"an asset the archive carries" dataUsingEncoding:NSUTF8StringEncoding]);
    NSString *diffManifestPath = [self contentsPath:AssetDiffManifestFileName];
    CPTestWriteFile(diffManifestPath, [@"{\"deletedFiles\":[]}" dataUsingEncoding:NSUTF8StringEncoding]);

    [self assertRestoreSucceeds];
    [self assertTargetBundleAtPath:[wrapper stringByAppendingPathComponent:BundleFileName]];
    XCTAssertTrue([self fileExists:diffManifestPath], @"the asset diff manifest went with the patch");
    XCTAssertTrue([self fileExists:assetPath], @"an asset of the archive went with the patch");
}

- (void)testKeepsARootHoldingLooseFilesBesidesTheDiffManifestAsItsOwnContentsRoot {
    CPTestWriteFile([self contentsPath:AssetDiffManifestFileName],
                    [@"{\"deletedFiles\":[]}" dataUsingEncoding:NSUTF8StringEncoding]);
    [self assertRestoreSucceeds];
    [self assertTargetBundleAtPath:[self contentsPath:BundleFileName]];
}

- (void)testRemovesWhatAnInterruptedAttemptLeftInTheWorkingDirectory {
    CPTestWriteFile([self.workingFolder stringByAppendingPathComponent:@"target.bundle"],
                    [@"half of an earlier restore" dataUsingEncoding:NSUTF8StringEncoding]);
    [self assertRestoreSucceeds];
    [self assertTargetBundleAtPath:[self contentsPath:BundleFileName]];
}

#pragma mark - Refusing the manifest

- (void)testReportsAnInvalidManifestWhenThereIsNone {
    [self removeFileAtPath:[self contentsPath:BinaryPatchManifestFileName]];
    [self assertFailureReason:CodePushBinaryPatchReasonInvalidManifest];
}

- (void)testReportsAnInvalidManifestWhenItIsNotJson {
    CPTestWriteFile([self contentsPath:BinaryPatchManifestFileName],
                    [@"not json at all" dataUsingEncoding:NSUTF8StringEncoding]);
    [self assertFailureReason:CodePushBinaryPatchReasonInvalidManifest];
}

- (void)testReportsAnUnsupportedFormatForAnotherFormatVersion {
    [self writePatchManifestWithValue:@2 forKey:@"formatVersion"];
    [self assertFailureReason:CodePushBinaryPatchReasonUnsupportedFormat];
}

- (void)testReportsAnUnsupportedFormatForAnotherAlgorithm {
    [self writePatchManifestWithValue:@"bsdiff-bz2" forKey:@"algorithm"];
    [self assertFailureReason:CodePushBinaryPatchReasonUnsupportedFormat];
}

- (void)testReportsAnInvalidManifestWhenTheBundlePathLeavesTheArchive {
    [self writePatchManifestWithValue:@"../main.jsbundle" forKey:@"bundlePath"];
    [self assertFailureReason:CodePushBinaryPatchReasonInvalidManifest];
    XCTAssertFalse([self fileExists:[self.root stringByAppendingPathComponent:BundleFileName]],
                   @"a bundle was restored outside the archive");
}

- (void)testReportsAnInvalidManifestWhenThePatchPathLeavesTheArchive {
    CPTestWriteFile([self.root stringByAppendingPathComponent:BinaryPatchFileName],
                    CPTestFixture(@"update.patch"));
    [self writePatchManifestWithValue:@"../main.jsbundle.patch" forKey:@"patchFile"];
    [self assertFailureReason:CodePushBinaryPatchReasonInvalidManifest];
}

- (void)testReportsAnInvalidManifestWhenTheBundlePathIsAbsolute {
    [self writePatchManifestWithValue:[self contentsPath:BundleFileName] forKey:@"bundlePath"];
    [self assertFailureReason:CodePushBinaryPatchReasonInvalidManifest];
}

- (void)testReportsAnInvalidManifestWhenTheArchiveHasNoPatchFile {
    [self removeFileAtPath:[self contentsPath:BinaryPatchFileName]];
    [self assertFailureReason:CodePushBinaryPatchReasonInvalidManifest];
}

- (void)testReportsAnInvalidManifestWhenTheTargetSizeIsEmpty {
    [self writePatchManifestWithValue:@0 forKey:@"targetBundleSize"];
    [self assertFailureReason:CodePushBinaryPatchReasonInvalidManifest];
}

- (void)testReportsAnInvalidManifestWhenTheTargetSizeIsBeyondTheLimit {
    [self writePatchManifestWithValue:@(128LL * 1024 * 1024 + 1) forKey:@"targetBundleSize"];
    [self assertFailureReason:CodePushBinaryPatchReasonInvalidManifest];
}

#pragma mark - Refusing the base bundle

- (void)testReportsAnUnavailableBaseBundleWhenTheBinaryBundleCannotBeRead {
    self.baseBundlePath = [self.root stringByAppendingPathComponent:@"no-such.bundle"];
    [self assertFailureReason:CodePushBinaryPatchReasonBaseBundleUnavailable];
}

- (void)testReportsABaseHashMismatchWhenTheBinaryHoldsAnotherBundle {
    CPTestWriteFile(self.baseBundlePath, [@"another bundle entirely" dataUsingEncoding:NSUTF8StringEncoding]);
    [self assertFailureReason:CodePushBinaryPatchReasonBaseHashMismatch];
    XCTAssertFalse([self fileExists:[self contentsPath:BundleFileName]],
                   @"a bundle was restored from a base bundle that was never checked");
}

#pragma mark - Refusing the patch

- (void)testReportsAnUnsupportedFormatWhenThePatchUsesAnotherCodec {
    NSMutableData *patch = [CPTestFixture(@"update.patch") mutableCopy];
    // The header reads "HDIFF13&zstd\0...". A codec name of the same length keeps the
    // header readable, so all that is left to refuse is the codec itself.
    [patch replaceBytesInRange:NSMakeRange(8, 4) withBytes:"lzma" length:4];
    CPTestWriteFile([self contentsPath:BinaryPatchFileName], patch);
    [self assertFailureReason:CodePushBinaryPatchReasonUnsupportedFormat];
}

- (void)testReportsAFailedApplyWhenThePatchHeaderIsCorrupt {
    CPTestWriteFile([self contentsPath:BinaryPatchFileName],
                    [@"the difference between the two" dataUsingEncoding:NSUTF8StringEncoding]);
    [self assertFailureReason:CodePushBinaryPatchReasonPatchApplyFailed];
    XCTAssertFalse([self fileExists:[self contentsPath:BundleFileName]],
                   @"a bundle was restored from a patch that could not be read");
}

- (void)testReportsAFailedApplyWhenTheManifestPromisesAnotherSize {
    long long targetBundleSize = [self.manifest[@"targetBundleSize"] longLongValue];
    [self writePatchManifestWithValue:@(targetBundleSize - 1) forKey:@"targetBundleSize"];
    [self assertFailureReason:CodePushBinaryPatchReasonPatchApplyFailed];
}

#pragma mark - Refusing the restored bundle

- (void)testReportsAFailedVerificationWhenTheRestoredBundleHasAnotherContent {
    NSString *targetBundleHash = self.manifest[@"targetBundleHash"];
    NSString *firstCharacter = [targetBundleHash substringToIndex:1];
    [self writePatchManifestWithValue:[targetBundleHash stringByReplacingCharactersInRange:NSMakeRange(0, 1)
                                                                               withString:[firstCharacter isEqualToString:@"a"] ? @"b" : @"a"]
                               forKey:@"targetBundleHash"];

    [self assertFailureReason:CodePushBinaryPatchReasonTargetVerificationFailed];
    XCTAssertFalse([self fileExists:[self contentsPath:BundleFileName]],
                   @"a bundle that failed verification was put among the update contents");
    XCTAssertTrue([self fileExists:[self contentsPath:BinaryPatchFileName]],
                  @"the patch was taken away from contents that were never restored");
    XCTAssertTrue([self fileExists:[self contentsPath:BinaryPatchManifestFileName]],
                  @"the patch manifest was taken away from contents that were never restored");
}

@end
