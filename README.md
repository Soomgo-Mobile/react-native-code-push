# @bravemobile/react-native-code-push

### Seamless Transition from AppCenter to a Fully Self-Hosted CodePush

- **No API Server Needed** – Use static hosting solutions (e.g., AWS S3) without maintaining additional API servers.
- **Familiar API** – Built on `microsoft/react-native-code-push`, ensuring compatibility and stability.
- **Flexible Deployment** – Implement your own release workflow, giving you complete control over the deployment process.

### 🚀 New Architecture support

Supports React Native 0.74 ~ 0.82.

(Tested on the React Native CLI template apps)

### ✅ Requirements

- **React Native**: 0.74 or higher
- **iOS**: 15.5 or higher
- **Android**: API level 16 or higher

## 🚗 Migration Guide

If you have been using `react-native-code-push`, replace the NPM package first.

```bash
npm remove react-native-code-push
npm install @bravemobile/react-native-code-push
```

1. Edit `android/app/build.gradle` file to remove the `apply from: "../../node_modules/..../codepush.gradle"` line.

2. The following changes are optional but recommended for cleaning up the old configuration:
   - Since the deployment key is no longer needed due to the retirement of AppCenter, it is recommended to remove it from your `Info.plist`, `strings.xml`, or JavaScript code.
   - Thanks to Auto Linking, you can remove the `react-native-code-push` module settings from `settings.gradle`.

3. Follow the installation guide starting from **'4. "CodePush-ify" your app'**.


## ⚙️ Installation

### 1. Install NPM Package
```bash
npm install @bravemobile/react-native-code-push
```

### 2. Run init command

For React Native CLI projects, you can use the automatic setup command to configure your project for CodePush.

This command will automatically edit your `AppDelegate` and `MainApplication` files to integrate CodePush.

```bash
npx code-push init
```

And run the following command to install CocoaPods dependencies for iOS:

```bash
cd ios && pod install && cd ..
```
(or `npx pod-install`, `bundle exec pod install --project-directory=./ios`, ..)

### 2-1. Manual Setup

If you prefer manual setup or if the automatic configuration fails, you can follow the manual setup instructions below.

<details><summary>Click to see the manual setup instructions.</summary>
<p>

### iOS Manual Setup

#### (1) Install CocoaPods Dependencies

Run `cd ios && pod install && cd ..`

(`npx pod-install`, `bundle exec pod install --project-directory=./ios`, ..)


#### (2) Edit `AppDelegate` Code

**If you have `AppDelegate.swift` (>= RN 0.77)**


<details><summary>If your project doesn't have bridging header, please create a file.</summary>
<p>

1. Open your project with Xcode (e.g. CodePushDemoApp.xcworkspace)
2. File → New → File from Template
3. Select 'Objective-C File' and click 'Next' and write any name as you like.
4. Then Xcode will ask you to create a bridging header file. Click 'Create'.
5. Delete the file created in step 3.

</p>
</details>


Add the following line to the bridging header file. (e.g. `CodePushDemoApp-Bridging-Header.h`)
```diff
+  #import <CodePush/CodePush.h>
```

Then, edit `AppDelegate.swift` like below.

```diff
  @main
  class AppDelegate: RCTAppDelegate {
    override func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey : Any]? = nil) -> Bool {
  
    // ...
  
    override func bundleURL() -> URL? {
  #if DEBUG
      RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
  #else
-     Bundle.main.url(forResource: "main", withExtension: "jsbundle")
+     CodePush.bundleURL()
  #endif
    }
  }
```


**Or if you have `AppDelegate.mm`**

```diff
+ #import <CodePush/CodePush.h>
  
  // ...
  
  - (NSURL *)bundleURL
  {
  #if DEBUG
    return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
  #else
-   return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
+   return [CodePush bundleURL];
  #endif
  }
  
  @end

```


### Android Manual Setup

#### Edit `MainApplication` Code

**(RN 0.82+) If you have `MainApplication.kt`**

```diff
+ import com.microsoft.codepush.react.CodePush

  class MainApplication : Application(), ReactApplication {
    override val reactHost: ReactHost by lazy {
      getDefaultReactHost(
        context = applicationContext,
        packageList =
          PackageList(this).packages.apply {
            // Packages that cannot be autolinked yet can be added manually here, for example:
            // add(MyReactNativePackage())
          },
+       jsBundleFilePath = CodePush.getJSBundleFile(),
      )
    }
  // ...
}
```

**(RN 0.73+) If you have `MainApplication.kt`**

```diff
+ import com.microsoft.codepush.react.CodePush

  class MainApplication : Application(), ReactApplication {
    override val reactNativeHost: ReactNativeHost =
      object : DefaultReactNativeHost(this) {

        // ...

+       override fun getJSBundleFile(): String = CodePush.getJSBundleFile()
      }
    // ...
  }
```


**Or if you have `MainApplication.java`**

```diff
  // ...
+ import com.microsoft.codepush.react.CodePush

  public class MainApplication extends Application implements ReactApplication {

    private final ReactNativeHost mReactNativeHost =
        new DefaultReactNativeHost(this) {

          // ...
  
+         @Override
+         override fun getJSBundleFile(): String {
+           return CodePush.getJSBundleFile()
+         }
        };
    // ...
  }
```

</p>
</details>


### 3. Expo Setup
For Expo projects, you can use the automated config plugin instead of manual setup.

**Add plugin to your Expo configuration:**
```js
// app.config.js
export default {
  expo: {
    plugins: ["@bravemobile/react-native-code-push"],
  },
};
```

**Run prebuild to apply changes:**
```bash
npx expo prebuild
```

> [!NOTE]
> The plugin automatically handles all native iOS and Android code modifications. No manual editing of AppDelegate, MainApplication, or gradle files is required.

**Requirements**
Expo SDK: 50.0.0 or higher


### 4. "CodePush-ify" Your App

The root component of your app should be wrapped with a higher-order component.

You should also pass configuration options, including the implementation of the `releaseHistoryFetcher` function.
This function is used to find the latest CodePush update within the `ReleaseHistoryInterface` data.

To enable this, you need to create a release history using the CLI tool and upload it to the remote.
(The following steps explain more about the CLI.)

At runtime, the library fetches this information to keep the app up to date.

```typescript
import CodePush, {
  ReleaseHistoryInterface,
  UpdateCheckRequest,
} from "@bravemobile/react-native-code-push";

// ... MyApp Component

async function releaseHistoryFetcher(
  updateRequest: UpdateCheckRequest,
): Promise<ReleaseHistoryInterface> {

  // Fetch release history for current binary app version.
  // You can implement how to fetch the release history freely. (Refer to the example app if you need a guide)

  const {data: releaseHistory} = await axios.get<ReleaseHistoryInterface>(
    `https://your.cdn.com/histories/${platform}/${identifier}/${updateRequest.app_version}.json`,
  );
  return releaseHistory;
}

export default CodePush({
  checkFrequency: CodePush.CheckFrequency.MANUAL, // or something else
  releaseHistoryFetcher: releaseHistoryFetcher,
})(MyApp);

```

> [!NOTE]
> The URL for fetching the release history should point to the resource location generated by the CLI tool.


#### 4-1. Telemetry Callbacks

Please refer to the [CodePushOptions](https://github.com/Soomgo-Mobile/react-native-code-push/blob/f0d26f7614af41c6dd4daecd9f7146e2383b2b0d/typings/react-native-code-push.d.ts#L76-L95) type for more details.
- **onUpdateSuccess:** Triggered when the update bundle is executed successfully.
- **onUpdateRollback:** Triggered when there is an issue executing the update bundle, leading to a rollback.
- **onDownloadStart:** Triggered when the bundle download begins.
- **onDownloadSuccess:** Triggered when the bundle download completes successfully.
- **onSyncError:** Triggered when an unknown error occurs during the update process. (`CodePush.SyncStatus.UNKNOWN_ERROR` status)


### 5. Configure the CLI Tool

> [!TIP]
> For a more detailed and practical example, refer to the `CodePushDemoApp` in `example` directory. ([link](https://github.com/Soomgo-Mobile/react-native-code-push/tree/master/Examples/CodePushDemoApp))

**(1) Create a `code-push.config.ts` file in the root directory of your project.**

Then, implement three functions to upload the bundle file and create/update the release history.
The CLI tool uses these functions to release CodePush updates and manage releases.
(These functions are not used at runtime by the library.)

You can copy and paste the following code and modify it as needed.

```typescript
import {
  CliConfigInterface,
  ReleaseHistoryInterface,
} from "@bravemobile/react-native-code-push";

const Config: CliConfigInterface = {
  bundleUploader: async (
    source: string,
    platform: "ios" | "android",
    identifier,
  ): Promise<{downloadUrl: string}> => {
    // ...
  },

  getReleaseHistory: async (
    targetBinaryVersion: string,
    platform: "ios" | "android",
    identifier,
  ): Promise<ReleaseHistoryInterface> => {
    // ...
  },

  setReleaseHistory: async (
    targetBinaryVersion: string,
    jsonFilePath: string,
    releaseInfo: ReleaseHistoryInterface,
    platform: "ios" | "android",
    identifier,
  ): Promise<void> => {
    // ...
  },
};

module.exports = Config;

```

**`bundleUploader`**
- Implements a function to upload the bundle file.
- The `downloadUrl` returned by this function is recorded in `ReleaseHistoryInterface` data
  and is used by the library runtime to download the bundle file from this URL.
- Used in the following cases:
  - Creating a new CodePush update with the `release` command.


**`getReleaseHistory`**
- Retrieves the release history of a specific binary app by fetching a JSON file or calling an API.
- Used in the following cases:
  - Printing the release history with the `show-history` command.
  - Loading existing release history during the `release` command.
  - Fetching release history to modify information in the `update-history` command.

(Similar to the `releaseHistoryFetcher` function in the library runtime options.)


**`setReleaseHistory`**
- Uploads a JSON file located at `jsonFilePath` or calls an API using `releaseInfo` metadata.
- If using a JSON file, **modifying the existing file should be allowed.**
  (Overwriting the file is recommended.)
- Used in the following cases:
  - Creating a new release record for a new binary build with the `create-history` command.
  - Appending a new record to an existing release history with the `release` command.
  - Modifying an existing release history with the `update-history` command.


**(2) For `code-push.config.ts` (TypeScript) to work properly, you may need to update your `tsconfig.json`.**

```diff
  {
    "extends": "@react-native/typescript-config/tsconfig.json",
    // ...
    "include": [
      // ...
+     "code-push.config.ts"
    ],
+   "ts-node": {
+     "compilerOptions": {
+       "module": "CommonJS",
+       "types": ["node"]
+     }
+   }
  }

```


## 🚀 CLI Tool Usage

> [!TIP]
> You can use `--help` command to see the available commands and options.

(interactive mode not supported yet)

### Commands


#### `create-history`

Create a new release history for a specific binary app version.
- Use this command whenever you release a new binary app to the app store.
  This ensures that the library runtime recognizes the binary app as the latest version and determines that no CodePush update is available for it.

**Example:**
- Create a new release history for the binary app version `1.0.0`.

```bash
npx code-push create-history --binary-version 1.0.0 --platform ios --identifier staging
```

#### `show-history`

Display the release history for a specific binary app version.


**Example:**
- Show the release history for the binary app version `1.0.0`.

```bash
npx code-push show-history --binary-version 1.0.0 --platform ios --identifier staging
```

#### `release`

Release a CodePush update for a specific binary app version.
- This command creates a CodePush bundle file, uploads it, and updates the release history with the new release information.

**Example:**
- Release a CodePush update `1.0.1` targeting the binary app version `1.0.0`.

```bash
npx code-push release --binary-version 1.0.0 --app-version 1.0.1 \
                      --platform ios --identifier staging --entry-file index.js \
                      --mandatory true

# Expo project
npx code-push release --framework expo --binary-version 1.0.0 --app-version 1.0.1 --platform ios
```
- `--framework`(`-f`) : Framework type (expo)
- `--binary-version`: The version of the binary app that the CodePush update is targeting.
- `--app-version`: The version of the CodePush update itself.

> [!IMPORTANT]
> `--app-version` should be greater than `--binary-version` (SemVer comparison).

- `--rollout`: The rollout percentage for the update. (0~100, inclusive)

#### `update-history`

Update the release history for a specific CodePush update.
- Use the `--enable` option to disable a specific release for rollback. (or enable it)
- Use the `--mandatory` option to make the update as mandatory or optional.
- Use the `--rollout` option to change the rollout percentage of the update. (0~100, inclusive)
  - If the rollout percentage is reduced, users who fall outside the new target will have their rollout canceled and rollback to the previous latest version.

**Example:**
- Rollback the CodePush update `1.0.1` (targeting the binary app version `1.0.0`).

```bash
npx code-push update-history --binary-version 1.0.0 --app-version 1.0.1 \
                             --platform ios --identifier staging \
                             --enable false
```

#### `bundle`

Create a CodePush bundle file.

**Example:**
```bash
npx code-push bundle --platform android --entry-file index.js

# Expo project
npx code-push bundle --framework expo --platform android --entry-file index.js
```
- `--framework`(`-f`): Framework type (expo)

By default, the bundle file is created in the `/build/bundleOutput` directory.

> [!NOTE]
> For Expo projects, the CLI uses `expo export:embed` command for bundling instead of React Native's bundle command.

(The file name represents a hash value of the bundle content.)
