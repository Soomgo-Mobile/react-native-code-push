#import <XCTest/XCTest.h>
#import "CodePush.h"
#import "CodePushBinaryPatch.h"

/*
 * The resolution and guard methods are internal to their classes. Objective-C
 * dispatch finds them at runtime, so declaring them here is all a test needs.
 */
@interface CodePushBinaryPatch (TestAccess)
+ (NSString *)contentsFolderInUnzippedFolder:(NSString *)unzippedFolderPath;
+ (NSString *)pathInsideFolder:(NSString *)folderPath relativePath:(NSString *)relativePath;
@end

@interface CodePushBinaryPatchTests : XCTestCase
@end

@implementation CodePushBinaryPatchTests

- (void)testResolvesAnEmptyFolderAsItsOwnContentsRoot {
    NSString *folder = [NSTemporaryDirectory() stringByAppendingPathComponent:[[NSUUID UUID] UUIDString]];
    NSError *error = nil;
    XCTAssertTrue([[NSFileManager defaultManager] createDirectoryAtPath:folder
                                            withIntermediateDirectories:YES
                                                             attributes:nil
                                                                  error:&error]);
    XCTAssertEqualObjects([CodePushBinaryPatch contentsFolderInUnzippedFolder:folder], folder);
    [[NSFileManager defaultManager] removeItemAtPath:folder error:nil];
}

@end
