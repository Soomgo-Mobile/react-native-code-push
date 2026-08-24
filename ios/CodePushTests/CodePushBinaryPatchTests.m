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
