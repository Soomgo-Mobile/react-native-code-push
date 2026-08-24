#import <Foundation/Foundation.h>

NSString *CPTestSha256Hex(NSData *data);
NSString *CPTestFolderHash(NSString *folderPath);
NSString *CPTestMakeTempDirectory(void);
void CPTestWriteFile(NSString *path, NSData *contents);
NSData *CPTestFixture(NSString *name);
BOOL CPTestZipFolderContents(NSString *folderPath, NSString *zipFilePath);
NSMutableDictionary *CPTestValidPatchManifest(void);
IMP CPTestReplaceClassMethod(Class cls, SEL selector, id block);
void CPTestRestoreClassMethod(Class cls, SEL selector, IMP original);
