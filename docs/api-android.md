## Java API Reference (Android)

CodePush is initialized through React Native autolinking. See the [Android setup](../README.md#android-manual-setup) for the required app integration.

### Configuration

#### Server URL

To override the default server URL (`https://codepush.appcenter.ms/`), add `CodePushServerUrl` to `strings.xml`:

```xml
<string name="CodePushServerUrl">https://your-code-push-server.example.com</string>
```

### Methods

- **`static CodePush getInstance(Context context, boolean isDebugMode)`** - Returns the singleton package instance used by autolinking. Applications normally do not need to call this directly.

- **`static String getJSBundleFile()`** - Returns the latest compatible JavaScript bundle, using `index.android.bundle` as the embedded bundle name.

- **`static String getJSBundleFile(String assetsBundleFileName)`** - Returns the latest compatible JavaScript bundle using the specified embedded bundle name.

- **`String getPackageFolder()`** - Returns the current update folder, or `null` when no update is installed.

- **`static void overrideAppVersion(String appVersionOverride)`** - Overrides the binary version used for update compatibility checks. Call this before CodePush is initialized.

### Deprecated methods

- **`getBundleUrl()`** and **`getBundleUrl(String assetsBundleFileName)`** - Use the corresponding `getJSBundleFile` method instead.
