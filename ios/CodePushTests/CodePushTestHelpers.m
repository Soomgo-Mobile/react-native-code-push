#import "CodePushTestHelpers.h"
#import <CommonCrypto/CommonDigest.h>
#import <SSZipArchive/SSZipArchive.h>
#import <objc/runtime.h>

NSString *CPTestSha256Hex(NSData *data) {
    uint8_t digest[CC_SHA256_DIGEST_LENGTH];
    CC_SHA256(data.bytes, (CC_LONG)data.length, digest);
    NSMutableString *hex = [NSMutableString stringWithCapacity:CC_SHA256_DIGEST_LENGTH * 2];
    for (int i = 0; i < CC_SHA256_DIGEST_LENGTH; i++) {
        [hex appendFormat:@"%02x", digest[i]];
    }
    return hex;
}

static void CPTestAddEntries(NSString *root, NSString *prefix, NSMutableArray *entries) {
    NSFileManager *fileManager = [NSFileManager defaultManager];
    for (NSString *name in [fileManager contentsOfDirectoryAtPath:root error:nil]) {
        NSString *relative = prefix.length ? [prefix stringByAppendingPathComponent:name] : name;
        if ([relative hasPrefix:@"__MACOSX"] || [relative isEqualToString:@".DS_Store"]
            || [relative hasSuffix:@"/.DS_Store"]) {
            continue;
        }
        NSString *full = [root stringByAppendingPathComponent:name];
        BOOL isDirectory = NO;
        [fileManager fileExistsAtPath:full isDirectory:&isDirectory];
        if (isDirectory) {
            CPTestAddEntries(full, relative, entries);
        } else {
            NSData *contents = [NSData dataWithContentsOfFile:full];
            [entries addObject:[NSString stringWithFormat:@"%@:%@", relative, CPTestSha256Hex(contents)]];
        }
    }
}

NSString *CPTestFolderHash(NSString *folderPath) {
    NSMutableArray *entries = [NSMutableArray array];
    CPTestAddEntries(folderPath, @"", entries);
    NSArray *sorted = [entries sortedArrayUsingSelector:@selector(compare:)];
    NSData *json = [NSJSONSerialization dataWithJSONObject:sorted options:kNilOptions error:nil];
    NSString *text = [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
    text = [text stringByReplacingOccurrencesOfString:@"\\/" withString:@"/"];
    return CPTestSha256Hex([text dataUsingEncoding:NSUTF8StringEncoding]);
}

NSString *CPTestMakeTempDirectory(void) {
    NSString *path = [NSTemporaryDirectory() stringByAppendingPathComponent:[[NSUUID UUID] UUIDString]];
    NSError *error = nil;
    BOOL created = [[NSFileManager defaultManager] createDirectoryAtPath:path
                                             withIntermediateDirectories:YES
                                                              attributes:nil
                                                                   error:&error];
    NSCAssert(created, @"%@", error);
    return path;
}

void CPTestWriteFile(NSString *path, NSData *contents) {
    NSError *error = nil;
    BOOL created = [[NSFileManager defaultManager] createDirectoryAtPath:[path stringByDeletingLastPathComponent]
                                             withIntermediateDirectories:YES
                                                              attributes:nil
                                                                   error:&error];
    NSCAssert(created, @"%@", error);
    BOOL written = [contents writeToFile:path options:NSDataWritingAtomic error:&error];
    NSCAssert(written, @"%@", error);
}

NSData *CPTestFixture(NSString *name) {
    NSBundle *bundle = [NSBundle bundleForClass:NSClassFromString(@"CodePushTestHelpersTests")];
    NSString *path = [bundle pathForResource:[name stringByDeletingPathExtension]
                                      ofType:[name pathExtension]];
    NSData *data = [NSData dataWithContentsOfFile:path];
    NSCAssert(data != nil, @"fixture %@ is missing from the test bundle", name);
    return data;
}

NSMutableDictionary *CPTestValidPatchManifest(void) {
    NSData *base = CPTestFixture(@"base.bundle");
    NSData *target = CPTestFixture(@"target.bundle");
    return [NSMutableDictionary dictionaryWithDictionary:@{
        @"formatVersion": @1,
        @"algorithm": @"hdiffpatch-m-zstd",
        @"bundlePath": @"main.jsbundle",
        @"patchFile": @"main.jsbundle.patch",
        @"baseBundleHash": CPTestSha256Hex(base),
        @"targetBundleHash": CPTestSha256Hex(target),
        @"targetBundleSize": @(target.length),
    }];
}

BOOL CPTestZipFolderContents(NSString *folderPath, NSString *zipFilePath) {
    return [SSZipArchive createZipFileAtPath:zipFilePath
                     withContentsOfDirectory:folderPath
                         keepParentDirectory:NO];
}

IMP CPTestReplaceClassMethod(Class cls, SEL selector, id block) {
    Method method = class_getClassMethod(cls, selector);
    NSCAssert(method != NULL, @"no class method %@ on %@", NSStringFromSelector(selector), cls);
    return method_setImplementation(method, imp_implementationWithBlock(block));
}

void CPTestRestoreClassMethod(Class cls, SEL selector, IMP original) {
    method_setImplementation(class_getClassMethod(cls, selector), original);
}
