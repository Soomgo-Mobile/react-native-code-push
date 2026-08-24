#import <XCTest/XCTest.h>
#import "CodePushTestHelpers.h"

@interface CodePushTestHelpersTests : XCTestCase
@end

@implementation CodePushTestHelpersTests

/* The known vector: this independent implementation has to agree with the production hash. */
- (void)testFolderHashMatchesTheKnownVector {
    NSString *folder = CPTestMakeTempDirectory();
    CPTestWriteFile([folder stringByAppendingPathComponent:@"CodePush/a.txt"],
                    [@"hello" dataUsingEncoding:NSUTF8StringEncoding]);
    XCTAssertEqualObjects(CPTestFolderHash(folder),
                          @"3551a1493543d3843bf9b93802cf1449c81b66e40d318809f769e619da252c3f");
}

- (void)testFolderHashSkipsFilesTheProductionHashSkips {
    NSString *folder = CPTestMakeTempDirectory();
    CPTestWriteFile([folder stringByAppendingPathComponent:@"CodePush/a.txt"],
                    [@"hello" dataUsingEncoding:NSUTF8StringEncoding]);
    CPTestWriteFile([folder stringByAppendingPathComponent:@".DS_Store"], [NSData data]);
    CPTestWriteFile([folder stringByAppendingPathComponent:@"CodePush/.DS_Store"], [NSData data]);
    CPTestWriteFile([folder stringByAppendingPathComponent:@"__MACOSX/junk"], [NSData data]);
    XCTAssertEqualObjects(CPTestFolderHash(folder),
                          @"3551a1493543d3843bf9b93802cf1449c81b66e40d318809f769e619da252c3f");
}

- (void)testLoadsTheCommittedFixtures {
    XCTAssertEqualObjects(CPTestSha256Hex(CPTestFixture(@"base.bundle")),
                          CPTestValidPatchManifest()[@"baseBundleHash"]);
    XCTAssertEqual([CPTestFixture(@"target.bundle") length],
                   [CPTestValidPatchManifest()[@"targetBundleSize"] longLongValue]);
    XCTAssertTrue([CPTestFixture(@"update.patch") length] > 0);
}

- (void)testZipsAFolderIntoItsContents {
    NSString *staging = CPTestMakeTempDirectory();
    CPTestWriteFile([staging stringByAppendingPathComponent:@"hotcodepush.json"],
                    [@"{}" dataUsingEncoding:NSUTF8StringEncoding]);
    CPTestWriteFile([staging stringByAppendingPathComponent:@"CodePush/main.jsbundle"],
                    [@"bundle" dataUsingEncoding:NSUTF8StringEncoding]);
    NSString *zipPath = [CPTestMakeTempDirectory() stringByAppendingPathComponent:@"a.zip"];
    XCTAssertTrue(CPTestZipFolderContents(staging, zipPath));

    NSData *header = [[NSFileHandle fileHandleForReadingAtPath:zipPath] readDataOfLength:4];
    const char pk[4] = {'P', 'K', 3, 4};
    XCTAssertEqualObjects(header, [NSData dataWithBytes:pk length:4]);
}

@end
