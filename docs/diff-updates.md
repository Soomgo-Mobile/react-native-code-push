# Diff Updates

[한국어](./diff-updates.ko.md)

By default, the `release` command publishes a **full archive** containing the entire update. Diff updates let clients download only the differences needed for an update.

This feature is optional. Without any additional configuration, `release` publishes only the full archive. If a diff update is unavailable or cannot be applied, the app falls back to the full archive and installs the update unless the failure is a network connection error.

## What archives are published?

| Archive | Compared against | Contents | Available when |
| --- | --- | --- | --- |
| full | Nothing | Entire update | Always |
| binary patch | JS bundle embedded in the app binary | JS bundle diff and all assets | The client is running the target binary version |
| asset diff | Previous OTA update | JS bundle diff, new assets, and a list of assets to delete | The client is running the base OTA update |

### Binary patch

A binary patch is generated against the JS bundle embedded in the app binary published to the store.

Every build for the same release target (binary version) must contain the same embedded bundle. Once you archive that embedded bundle, every update targeting the same binary version can provide a binary patch.

#### Why Hermes bytecode alignment matters

When you pass `--binary-bundle-path` to `release`, the CLI uses the archived embedded bundle as the base for `hermesc -base-bytecode`. This aligns the internal layout of the new bytecode with the base bundle, reducing byte movements unrelated to source changes so that the binary patch can focus on the actual changes.

Measurements from real-world apps showed the following results:

| Conditions | Result |
| --- | --- |
| An approximately 25MB Hermes bundle with 153 files changed over five days | The aligned HDiffPatch was 355–382KB. Without alignment, patches from every codec tested were 3–5 times larger. ([PR #150](https://github.com/Soomgo-Mobile/react-native-code-push/pull/150)) |
| An approximately 18MB Android bundle with 23 lines of source changes | Even with `-base-bytecode`, mismatched `--minify` settings between the binary and update made the patch about 12.5 times as large. ([PR #165](https://github.com/Soomgo-Mobile/react-native-code-push/pull/165)) |

As the second result shows, passing `-base-bytecode` alone is not sufficient. The update must also be generated with `--minify false` to match the embedded binary bundle, and the CLI applies this option by default. Actual results vary by app and change set.

### Asset diff

An asset diff is generated against a previously published OTA update. Therefore, only an app running that base OTA update can use it.

Unlike a binary patch, which contains every asset, an asset diff contains only assets absent from the base update. The smaller the asset difference between the base update and the new release, the smaller the asset diff will be.

## What to prepare before you start

Publishing diff updates requires the following:

1. **Export embedded bundles for binary patches**

   For every binary version you support, archive the exact JS bundle embedded in the binary published to the store.

2. **Configure previous archive downloads for asset diffs**

   To publish asset diffs as well, implement `bundleDownloader` in `code-push.config.ts`.

You must also build the patch generator once before generating patches. See [**Prerequisites: building the patch generator**](../cli/README.md#prerequisites-building-the-patch-generator) for details.

## 1. Export the embedded bundle

A binary patch is the difference between a new update and the JS bundle already embedded in the app. You must therefore preserve the exact JS bundle bytecode embedded in the build published to the store.

The library provides an export hook for each platform. After the bundle build finishes, the hook exports:

- The Hermes-compiled JS bundle (bytecode)
- A `binary-patch-base.json` file containing bundle metadata and verification values

### Android

Apply the Gradle script in your app module's `android/app/build.gradle`:

```gradle
apply plugin: "com.android.application"
apply plugin: "com.facebook.react"

react {
    // ...
}

apply from: "../../node_modules/@bravemobile/react-native-code-push/android/codepush-export.gradle"
```

The `apply from` line can go anywhere in the file.

After the JS bundle is built, it is exported to:

```text
android/app/build/codepush/embedded-bundle/<variant>/
```

To use a different export path, choose one of the following:

- Pass `-PcodePushExportDir=<path>` to Gradle
- Set `ext.codePushExportDir`

If you set `ext.codePushExportDir`, place it before the `apply from` line. In either case, the `<variant>` directory is appended to the path.

### iOS

In Xcode, open the app target's **Build Phases** tab and find the **Bundle React Native code and images** phase. Add the final line below to the end of the existing script:

```sh
/bin/sh -c "\"$WITH_ENVIRONMENT\" \"$REACT_NATIVE_XCODE\""

# Add this line
"$SRCROOT/../node_modules/@bravemobile/react-native-code-push/scripts/export-embedded-bundle.sh"
```

The default export path is:

```text
$BUILD_DIR/codepush/embedded-bundle/$CONFIGURATION-$PLATFORM_NAME/
```

To use a different export path, set the `CODEPUSH_EXPORT_DIR` environment variable. The `$CONFIGURATION-$PLATFORM_NAME` directory is still appended to the path.

> **Note:** The Expo config plugin (`app.plugin.js`) does not currently apply this hook automatically.

## 2. Archive exports per binary release

The CI pipeline that builds your store binary must archive the exported JS bundle by binary version.

When publishing a later OTA release, download the JS bundle for the target binary version and use it as the binary patch base bundle.

The following examples are only a reference. Archive the bundles in whatever way fits your deployment pipeline.

### Android example

Upload the export after `./gradlew :app:assembleRelease` finishes:

```sh
aws s3 cp --recursive \
  android/app/build/codepush/embedded-bundle/release \
  "s3://your-bucket/binaries/android/$BINARY_VERSION/"
```

### iOS example

Because `$BUILD_DIR` exists only during the build, set the export directory to a path known to your CI pipeline:

```sh
export CODEPUSH_EXPORT_DIR="$PWD/codepush-export"

xcodebuild \
  -workspace ios/YourApp.xcworkspace \
  -scheme YourApp \
  -configuration Release \
  archive # ...

aws s3 cp --recursive \
  "$CODEPUSH_EXPORT_DIR/Release-iphoneos" \
  "s3://your-bucket/binaries/ios/$BINARY_VERSION/"
```

## 3. Publish a binary patch release

Download the JS bundle for the target binary version from your archive and pass its path to `--binary-bundle-path`:

```sh
aws s3 cp --recursive \
  "s3://your-bucket/binaries/android/1.0.0/" \
  ./binary/

npx code-push release \
  -b 1.0.0 \
  -v 1.0.1 \
  -p android \
  --binary-bundle-path ./binary/index.android.bundle
```

The `release` command reads the `binary-patch-base.json` file archived with the JS bundle and verifies that the supplied base bundle is correct. See [**Verifying the base bundle**](../cli/README.md#verifying-the-base-bundle) for details.

## 4. Publish asset diff archives

When publishing a binary patch, you can also publish asset diff archives against previous OTA updates. An asset diff archive is generated for each of the N most recent updates. It is not published if its size is greater than or equal to the binary patch archive.

An asset diff contains only:

- The JS bundle binary patch
- New asset files absent from the base update
- A manifest listing asset files to delete

After downloading the update, the app copies the base OTA update, patches the JS bundle, and deletes unnecessary asset files. The resulting contents are identical to the full archive update.

### Publishing conditions

An asset diff is published only when all of the following conditions are met:

1. The release is a binary patch release created with `release --binary-bundle-path`.
2. `bundleDownloader` is implemented in `code-push.config.ts`.
3. `--diff-base-count` is greater than `0`. The default is `3`.

The CLI uses `bundleDownloader` to download previous updates that serve as asset diff bases.

```ts
bundleDownloader: async (archive, platform, identifier = 'staging') => {
  const downloadedFilePath = path.join(os.tmpdir(), archive.packageHash);
  const storageKey =
    `bundles/${platform}/${identifier}/full-bundle/${archive.packageHash}`;

  // Download the archive at storageKey from S3, Supabase, or another
  // storage provider to downloadedFilePath.

  // Return the downloadedFilePath.
  return { downloadedFilePath };
},
```

See [**Asset diff archives**](../cli/README.md#asset-diff-archives) for details about which asset diff archives are generated and published.

## Update download and fallback order

When downloading an update, the app tries the smallest archive first.

| Order | Archive | Selected when |
| --- | --- | --- |
| 1 | asset diff | A diff exists against the OTA update currently running |
| 2 | binary patch | The asset diff is unavailable or applying the asset differences fails |
| 3 | full | The binary patch is unavailable or applying the patch fails |

### When asset diff is skipped

The app starts with the binary patch when no asset diff is available, including when:

- The app is running the bundle embedded in the app binary (the first OTA update)
- No asset diff was generated against the current OTA update

### Choosing the next archive after an asset diff failure

The fallback path depends on the failure:

| Failure | Next action | Reason |
| --- | --- | --- |
| `asset_merge_failed` | Try the binary patch | The asset differences could not be applied to the installed update. Replacing all assets may still succeed |
| `package_verification_failed` | Try the binary patch | The final hash of the contents merged from the asset diff does not match. Replacing all assets may still succeed |
| The asset diff download URL returns HTTP `400` or higher | Try the binary patch | The asset diff and binary patch use separate download URLs, so failure to download one does not mean the other is unavailable |
| Applying the bundle patch fails | Download the full archive | The asset diff and binary patch apply the same JS bundle patch, so falling back to the binary patch is likely to fail as well |
| Network connection error | Report the error without falling back | The next option uses the same network, and the full archive is larger, so another attempt would likely fail more slowly |

Connection errors and server response errors are handled differently. For example, a `404` response from the asset diff download URL means the server was reached, so there is no reason to skip the next option—the binary patch or full archive.

## Observing results

The `onUpdateArchiveResult` callback reports the result of every update the app tried. To collect which archive was selected and why fallback occurred, see [**Telemetry callbacks**](./telemetry-callbacks.md#what-onupdatearchiveresult-reports).
