## Objective-C API Reference (iOS)

Import `CodePush.h` and use the `CodePush` class when configuring the React Native bundle URL. See the [iOS setup](../README.md#2-edit-appdelegate-code) for the standard integration.

### Bundle resolution

The following methods return the latest compatible CodePush update when one is installed, or the bundle embedded in the app otherwise:

- **`+ (NSURL *)bundleURL`** - Uses `main.jsbundle` as the embedded bundle.

- **`+ (NSURL *)bundleURLForResource:(NSString *)resourceName`** - Uses the specified embedded bundle name and the `jsbundle` extension.

- **`+ (NSURL *)bundleURLForResource:(NSString *)resourceName withExtension:(NSString *)resourceExtension`** - Uses the specified embedded bundle name and extension.

- **`+ (NSURL *)bundleURLForResource:(NSString *)resourceName withExtension:(NSString *)resourceExtension subdirectory:(NSString *)resourceSubdirectory`** - Also looks for the embedded bundle in the specified subdirectory.

- **`+ (NSURL *)bundleURLForResource:(NSString *)resourceName withExtension:(NSString *)resourceExtension subdirectory:(NSString *)resourceSubdirectory bundle:(NSBundle *)resourceBundle`** - Also looks for the embedded bundle in the specified resource bundle.

### Configuration

- **`+ (void)overrideAppVersion:(NSString *)appVersion`** - Overrides the binary version used for update compatibility checks. Call this before resolving the bundle URL.
