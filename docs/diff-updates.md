# Diff Updates

[한국어](diff-updates.ko.md)

A release can offer the client the difference between the update and a bundle the client
already holds, in place of the whole thing. There are two kinds of difference, and an asset
diff is only published on a release that carries a binary patch:

- a **binary patch**, computed against the JS bundle inside the app binary. Every client on
  that binary version holds that bundle, so every one of them can use it.
- an **asset diff**, computed against a recently released update. Only a client running that
  update can use it, and it carries only the assets that update does not already have, where
  the binary patch carries every asset.

A client that can use neither downloads the full archive, so a release installs either way.
All of this is optional: with none of it set up, `release` publishes the full archive alone.

Publishing patches takes two things. Binary patches need the embedded bundle of every binary
version you release against, which is what
[Exporting the embedded bundle](#exporting-the-embedded-bundle) sets up. Asset diffs need
that plus a `bundleDownloader` in `code-push.config.ts`, covered under
[Asset diff archives](#asset-diff-archives). The patch generator itself has to be built
once before the first patch release - see
[Prerequisites: building the patch generator](../cli/README.md#prerequisites-building-the-patch-generator).

## Exporting the embedded bundle

A binary patch is the difference between the update and the JS bundle that is already
inside the installed app, so releasing one means holding on to that bundle: the exact
bytes the build you shipped to the store embedded.

The library ships a hook for each platform that copies the freshly compiled bundle out of
the build, together with a `binary-patch-base.json` record describing it.

**Android** - apply the Gradle script in your app module's `android/app/build.gradle`:

```groovy
apply plugin: "com.android.application"
apply plugin: "com.facebook.react"

react {
    // ...
}

apply from: "../../node_modules/@bravemobile/react-native-code-push/android/codepush-export.gradle"
```

The line can go anywhere in the file (if you use `ext.codePushExportDir`, set it before the
`apply from:` line). Every variant that bundles JS then exports to
`android/app/build/codepush/embedded-bundle/<variant>/` after it is bundled. Pass
`-PcodePushExportDir=<path>` (or set `ext.codePushExportDir`) to export somewhere else; the
`<variant>` directory is appended either way.

**iOS** - call the export script at the end of the **"Bundle React Native code and images"**
build phase. In Xcode, open that phase
in your app target's **Build Phases** tab and append the last line below to its script:

```bash
/bin/sh -c "\"$WITH_ENVIRONMENT\" \"$REACT_NATIVE_XCODE\""

"$SRCROOT/../node_modules/@bravemobile/react-native-code-push/scripts/export-embedded-bundle.sh"
```

The export lands in `$BUILD_DIR/codepush/embedded-bundle/$CONFIGURATION-$PLATFORM_NAME/`.
Set the `CODEPUSH_EXPORT_DIR` environment variable to export somewhere else; the
`$CONFIGURATION-$PLATFORM_NAME` directory is appended either way.

> [!NOTE]
> Applying these hooks automatically through the Expo config plugin (`app.plugin.js`) is
> not implemented yet.

### Archiving the export per binary release

Whatever pipeline builds your store binary should keep that build's export somewhere
durable, organized by binary version, so a later release can fetch the bundle that matches
the binary it targets:

```bash
# Android, after ./gradlew :app:assembleRelease
aws s3 cp --recursive \
  android/app/build/codepush/embedded-bundle/release \
  "s3://your-bucket/binaries/android/$BINARY_VERSION/"

# iOS - point the export at a path the pipeline knows, since $BUILD_DIR only exists inside the build
export CODEPUSH_EXPORT_DIR="$PWD/codepush-export"
xcodebuild -workspace ios/YourApp.xcworkspace -scheme YourApp -configuration Release archive # ...
aws s3 cp --recursive \
  "$CODEPUSH_EXPORT_DIR/Release-iphoneos" \
  "s3://your-bucket/binaries/ios/$BINARY_VERSION/"
```

To release a patch later, download the export and pass the bundle's path to
`--binary-bundle-path`:

```bash
aws s3 cp --recursive "s3://your-bucket/binaries/android/1.0.0/" ./binary/
npx code-push release -b 1.0.0 -v 1.0.1 -p android \
                      --binary-bundle-path ./binary/index.android.bundle
```

`release` also uses the record to verify the base bundle it was handed - see
[Verifying the base bundle](../cli/README.md#verifying-the-base-bundle) for details.

## Asset diff archives

A release published with a binary patch can carry **asset diff archives** as well - one per
recently released version. A diff archive holds the patch of the JS bundle, only the assets
that version does not already have, and a manifest of the files it has to drop. The client
copies the update it already has installed, applies those, and ends up holding exactly the
contents of the full archive.

A client tries the archives in this order and stops at the first one it can install:

| Order | Archive | Available when |
|---|---|---|
| 1 | Asset diff | the release was diffed against the update the client is running. |
| 2 | Binary patch | always. It is built against the bundle in the app binary, which every client has. |
| 3 | Full | always. It needs nothing installed. |

There are two exceptions to this order.

**Not every client tries all three.** One with no asset diff to use - it is running the
bundle in the app binary, or an update this release was not diffed against - starts at the
binary patch.

**A failed asset diff does not always reach the binary patch.** It moves on to that archive
only when the diff failed on its asset side: the merge with the installed update failing
(`asset_merge_failed`), or the merged contents failing the package hash
(`package_verification_failed`). Anything else the diff fails on lives in the bundle patch
both archives carry, so the binary patch would fail there the same way and the client goes
straight to the full archive.

`onUpdateArchiveResult` reports every archive that was tried - see
[Telemetry callbacks](telemetry-callbacks.md#what-onupdatearchiveresult-reports).

### Enabling them

Diff archives are published only when all three of these hold:

- the release is a binary patch release (`release --binary-bundle-path`),
- `code-push.config.ts` implements `bundleDownloader`, so the CLI can fetch the earlier releases to diff against,
- `--diff-base-count` is greater than `0` (it defaults to `3`).

```ts
bundleDownloader: async (archive, platform, identifier = 'staging') => {
    const downloadedFilePath = path.join(os.tmpdir(), archive.packageHash);
    const storageKey = `bundles/${platform}/${identifier}/full-bundle/${archive.packageHash}`;
    // fetch storageKey from your storage (S3, Supabase, ...) to downloadedFilePath
    return { downloadedFilePath };
},
```

See [Asset diff archives](../cli/README.md#asset-diff-archives) for what the release
publishes.
