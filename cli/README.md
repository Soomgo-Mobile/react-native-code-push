# npx code-push

CLI for [`@bravemobile/react-native-code-push`](../README.md). Bundles, releases, and manages OTA updates — no AppCenter or API server needed.

## Prerequisites

- **Node.js** >= 18
- **Hermes** engine enabled in your React Native project
- **ts-node** (optional — only needed if your config file is `.ts`)

## Quick Start

```bash
# 1. Set up native projects for CodePush
npx code-push init

# 2. Create a config file (see Configuration below)

# 3. Create a release history for your binary version
npx code-push create-history -b 1.0.0 -p ios

# 4. Bundle, upload, and release an OTA update
npx code-push release -b 1.0.0 -v 1.0.1 -p ios
```

## Configuration

You need a `code-push.config.ts` (or `.js`) file at your project root. It exports an object with three functions — `bundleUploader`, `getReleaseHistory`, and `setReleaseHistory` — that tell the CLI how to talk to your storage backend, and a fourth optional one for releases that publish asset diff archives.

| Function | Description | Required |
|----------|-------------|----------|
| `bundleUploader(source, platform, identifier?, artifact?)` | Uploads a bundle file and returns the `downloadUrl` it can be downloaded from. `artifact` identifies the full bundle, binary patch, or asset diff archive, including its target binary version and package hashes | Yes |
| `getReleaseHistory(targetBinaryVersion, platform, identifier?)` | Returns the release history of a binary version | Yes |
| `setReleaseHistory(targetBinaryVersion, jsonFilePath, releaseInfo, platform, identifier?)` | Creates or overwrites the release history of a binary version | Yes |
| `bundleDownloader(archive, platform, identifier?)` | Downloads a released archive and returns its local path as `downloadedFilePath`. `archive` contains its `downloadUrl`, target binary version, release version, and package hash, so storage keys do not need to be derived from the URL. Only used to fetch the releases that [asset diff archives](#asset-diff-archives) are built against | No |

When deriving storage keys from `artifact`, you can omit `targetBinaryVersion` for a full bundle: its `packageHash` identifies the same contents across target binary versions. Binary patches and asset diff archives must include it because their contents depend on the JS bundle embedded in that target binary.

> Implementation examples:
> - [AWS S3 + CloudFront](../Examples/CodePushDemoApp/code-push.config.ts)
> - [Supabase Storage](../Examples/CodePushDemoApp/code-push.config.example.supabase.ts)
> - [Firebase Storage](../Examples/CodePushDemoApp/code-push.config.example.firebase.ts)

## Commands

### `init`

Sets up iOS and Android native projects for CodePush.

```bash
npx code-push init
```

- Android: adds `CodePush.getJSBundleFile()` to `MainApplication.kt`
- iOS: adds `CodePush.bundleURL()` to `AppDelegate` and sets up the bridging header (Swift projects)

Run `cd ios && pod install` afterwards to finish iOS setup.

---

### `bundle`

Runs the JS bundler and compiles with Hermes to produce a CodePush bundle file.

```bash
npx code-push bundle [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-f, --framework <type>` | Framework type (`expo`) | — |
| `-p, --platform <type>` | `ios` or `android` | `ios` |
| `-o, --output-path <string>` | Output root directory | `build` |
| `-e, --entry-file <string>` | JS/TS entry file path | `index.ts` |
| `-b, --bundle-name <string>` | Bundle file name | `main.jsbundle` (iOS) / `index.android.bundle` (Android) |
| `--output-bundle-dir <string>` | Directory name for the bundle output | `bundleOutput` |
| `--output-metro-dir <string>` | Directory to copy Metro JS bundle and sourcemap before Hermes compilation | — |
| `--binary-bundle-path <string>` | JS bundle of the target binary. Aligns the Hermes compilation with it and records it as the binary patch base | — |

```bash
# Bundle for Android with a custom entry file
npx code-push bundle -p android -e index.js

# Bundle aligned with the JS bundle shipped in the binary
npx code-push bundle -p android --binary-bundle-path ./binary/index.android.bundle
```

---

### `release`

Does everything: bundles your code, uploads it, and writes the release history.

```bash
npx code-push release [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-b, --binary-version <string>` | **(Required)** Target binary app version | — |
| `-v, --app-version <string>` | **(Required)** App version to release (must be > binary version) | — |
| `-f, --framework <type>` | Framework type (`expo`) | — |
| `-p, --platform <type>` | `ios` or `android` | `ios` |
| `-i, --identifier <string>` | Identifier to distinguish releases (e.g. `staging`, `production`) | — |
| `-c, --config <path>` | Config file name | `code-push.config.ts` |
| `-o, --output-path <string>` | Output root directory | `build` |
| `-e, --entry-file <string>` | JS/TS entry file path | `index.ts` |
| `-j, --js-bundle-name <string>` | JS bundle file name | `main.jsbundle` (iOS) / `index.android.bundle` (Android) |
| `-m, --mandatory <bool>` | Make the release mandatory | `false` |
| `--enable <bool>` | Enable the release | `true` |
| `--rollout <number>` | Rollout percentage (0-100) | — |
| `--skip-bundle <bool>` | Skip bundle step (use existing bundle) | `false` |
| `--hash-calc <bool>` | Calculate hash from existing bundle (requires `--skip-bundle true`) | — |
| `--skip-cleanup <bool>` | Skip output directory cleanup | `false` |
| `--output-bundle-dir <string>` | Bundle output directory name | `bundleOutput` |
| `--output-metro-dir <string>` | Directory to copy Metro JS bundle and sourcemap before Hermes compilation | — |
| `--binary-bundle-path <string>` | JS bundle of the target binary. Releases an additional binary patch bundle against it, and aligns the Hermes compilation with it | — |
| `--on-oversized-patch <policy>` | What to do when the patch bundle is not smaller than the full bundle: `skip` releases the full bundle only, `fail` stops the release before any upload | `skip` |
| `--diff-base-count <number>` | How many of the most recent releases to build [asset diff archives](#asset-diff-archives) against (`0` disables them). Needs `bundleDownloader` in the config file and a `--binary-bundle-path` release | `3` |

With `--binary-bundle-path`, the release uploads two artifacts per platform - plus one per
[asset diff archive](#asset-diff-archives) when those are enabled: the full bundle named
after its `packageHash`, and a patch bundle named `<packageHash>-patch.zip` that carries
only the difference from the bundle inside the binary. The patch bundle
holds a `codepush-binary-patch.json` manifest describing how to rebuild the update, so
applying it yields the same `packageHash` as the full bundle. Both sizes and the saving
are printed before either artifact is uploaded. The release history entry records where
the patch bundle can be downloaded, next to the full bundle URL.

A client installs the update from the patch bundle when the release has one, and downloads
the full bundle instead whenever the patch cannot be applied, so a release is never left
uninstallable by a patch. Applying a patch is native code, which both libraries build from
the same sources: on Android that needs the NDK and CMake, both of which a React Native
project normally already has, and on iOS the pod carries the sources, so CocoaPods builds
them with nothing to add.

#### Prerequisites: building the patch generator

Producing a patch needs HDiffPatch's `hdiffz`, which is not installed as a package
dependency. Build it once per machine with [`build-patch-tools`](#build-patch-tools):

```bash
npx code-push build-patch-tools
```

Only releases that pass `--binary-bundle-path` need the tools, and one that cannot find them
fails with that command in the message before anything is uploaded.

#### Oversized patches

A patch is only worth publishing when it is smaller than the archive it replaces. The CLI
never prompts, so `--on-oversized-patch` decides in advance what happens when the patch
comes out the same size or larger: `skip` (the default) logs a warning, notes the skip in
the summary and releases the full bundle alone, while `fail` stops the release before
anything is uploaded and leaves the release history untouched.

#### Verifying the base bundle

The bundle `--binary-bundle-path` points at is the one input a release cannot verify on
its own, so the [build hooks](../docs/diff-updates.md#1-export-the-embedded-bundle) leave a
`binary-patch-base.json` record next to every bundle they export. When that record is
there, the release fails before anything is built or uploaded if the base bundle no longer
hashes to what the record describes, or if it was exported from a binary version other
than `--binary-version`. A base bundle with no record beside it releases exactly as before,
and a record that cannot be read only warns.

#### Asset diff archives

A patch bundle still carries every asset of the update, and a client that already has an
earlier update installed has most of those assets on disk. So with `bundleDownloader` in
the config file, a binary patch release publishes one more artifact per recent release:
`<packageHash>-diff-<basePackageHash>.zip`, holding the bundle patch, only the assets that
release does not already have, and a manifest of the files it has to drop. A client holding
that release copies its installed update, applies those, and ends up with the same
`packageHash` the full bundle would have produced.

`--diff-base-count` decides how many of the most recent releases the diffs are built
against (`3` by default, `0` publishes none). The CLI downloads each of those releases
through `bundleDownloader` and checks that the archive hashes to the `packageHash` the
history recorded for it: a base that cannot be downloaded or does not match is skipped with
a warning, and a diff that does not come out smaller than the patch bundle is not
published. Either way the release still goes out with its full and patch bundles, serving
fewer diff archives.

Each published diff archive is recorded in the release history entry under `diffPackages`,
keyed by the `packageHash` of the release it was built against. A client downloads the diff
archive built against the update it is running, the patch bundle when it is running the
binary or an update this release was not diffed against, and the full bundle whenever what
it downloaded cannot be applied.

```bash
# Standard iOS release
npx code-push release -b 1.0.0 -v 1.0.1 -p ios

# Mandatory Android release, rolled out to 50%
npx code-push release -b 2.0.0 -v 2.0.1 -p android -m true --rollout 50

# Expo project
npx code-push release -b 1.0.0 -v 1.0.1 -f expo -p ios

# With a staging identifier
npx code-push release -b 1.0.0 -v 1.0.1 -i staging

# Reuse an existing bundle
npx code-push release -b 1.0.0 -v 1.0.2 --skip-bundle true --hash-calc true

# Release a full bundle and a binary patch against the bundle in the binary
npx code-push release -b 1.0.0 -v 1.0.1 -p ios --binary-bundle-path ./binary/main.jsbundle

# Same, but fail the release if the patch does not come out smaller
npx code-push release -b 1.0.0 -v 1.0.1 -p ios --binary-bundle-path ./binary/main.jsbundle --on-oversized-patch fail

# Also publish asset diff archives against the 5 most recent releases (needs `bundleDownloader`)
npx code-push release -b 1.0.0 -v 1.0.1 -p ios --binary-bundle-path ./binary/main.jsbundle --diff-base-count 5
```

---

### `build-patch-tools`

Builds `hdiffz` and `hpatchz`, the HDiffPatch tools that `release --binary-bundle-path`
generates and verifies binary patches with, and installs them where `release` looks for them.

```bash
npx code-push build-patch-tools [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--tools-dir <path>` | Directory to install the tools into | `HDIFFPATCH_TOOLS_DIR` if set, else `.hdiffpatch-tools` in the working directory |
| `--force` | Rebuild even when the tools are already installed | `false` |
| `--print-hash` | Print a hash of the build script instead of building. See below | `false` |

The tools are built from pinned upstream sources rather than installed as a package
dependency, so the build needs `git`, a C/C++ toolchain (`make`, `cc`, `c++`) and network
access. It runs once per machine: the command does nothing when both tools are already in
the install directory. It does not check which version they are, so after upgrading this
package to one that pins a different HDiffPatch, rebuild with `--force`.

The default install directory is the first place `release` looks, before it walks up the
parent directories; add `.hdiffpatch-tools/` to the project's `.gitignore`. Setting
`HDIFFPATCH_TOOLS_DIR` moves both the install and the lookup to that directory, which is how
a CI image that builds the tools ahead of time, or a shared install outside the project, is
used.

A CI cache of the install directory needs a key that changes when the build would produce
different tools. `--print-hash` prints one: a SHA-256 of the build script, which pins the
sources and the build flags. It changes whenever the script changes, comments included, and
stays the same across versions of this package that ship the same script. Write it to a
file the CI's checksum can read, and combine it with the machine architecture, which the
script knows nothing about.

```bash
# Build into a shared location a CI image reuses
npx code-push build-patch-tools --tools-dir /opt/hdiffpatch-tools

# Rebuild, for a newly pinned HDiffPatch or a broken install
npx code-push build-patch-tools --force

# Key a CI cache of .hdiffpatch-tools by what the build would produce
npx code-push build-patch-tools --print-hash > .hdiffpatch-tools.hash
```

---

### `create-history`

Creates a release history entry for a binary version. Run this once per binary version you ship to the app store.

```bash
npx code-push create-history [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-b, --binary-version <string>` | **(Required)** Target binary version | — |
| `-p, --platform <type>` | `ios` or `android` | `ios` |
| `-i, --identifier <string>` | Identifier to distinguish releases | — |
| `-c, --config <path>` | Config file name | `code-push.config.ts` |

```bash
npx code-push create-history -b 1.0.0 -p ios -i production
```

---

### `update-history`

Changes an existing release — toggle enable/mandatory, adjust rollout.

```bash
npx code-push update-history [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-v, --app-version <string>` | **(Required)** App version to modify | — |
| `-b, --binary-version <string>` | **(Required)** Target binary version | — |
| `-p, --platform <type>` | `ios` or `android` | `ios` |
| `-i, --identifier <string>` | Identifier to distinguish releases | — |
| `-c, --config <path>` | Config file name | `code-push.config.ts` |
| `-m, --mandatory <bool>` | Set mandatory flag | — |
| `-e, --enable <bool>` | Enable or disable the release | — |
| `--rollout <number>` | Rollout percentage (0-100) | — |

You must pass at least one of `--mandatory`, `--enable`, or `--rollout`.

```bash
# Disable a release
npx code-push update-history -b 1.0.0 -v 1.0.1 -e false

# Roll out to everyone
npx code-push update-history -b 1.0.0 -v 1.0.1 --rollout 100
```

---

### `show-history`

Prints the release history for a binary version.

```bash
npx code-push show-history [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-b, --binary-version <string>` | **(Required)** Target binary version | — |
| `-p, --platform <type>` | `ios` or `android` | `ios` |
| `-i, --identifier <string>` | Identifier to distinguish releases | — |
| `-c, --config <path>` | Config file name | `code-push.config.ts` |

```bash
npx code-push show-history -b 1.0.0 -p ios
```

## Release History Structure

The release history is a JSON object keyed by app version. For example, the history for binary version `1.0.0`:

```json
{
  "1.0.0": {
    "enabled": true,
    "mandatory": false,
    "downloadUrl": "",
    "packageHash": ""
  },
  "1.0.1": {
    "enabled": true,
    "mandatory": false,
    "downloadUrl": "https://storage.example.com/bundles/ios/staging/a1b2c3...",
    "packageHash": "a1b2c3...",
    "rollout": 100
  },
  "1.0.2": {
    "enabled": true,
    "mandatory": true,
    "downloadUrl": "https://storage.example.com/bundles/ios/staging/d4e5f6...",
    "packageHash": "d4e5f6...",
    "binaryPatchDownloadUrl": "https://storage.example.com/bundles/ios/staging/d4e5f6...-patch.zip",
    "diffPackages": {
      "a1b2c3...": "https://storage.example.com/bundles/ios/staging/d4e5f6...-diff-a1b2c3....zip"
    }
  }
}
```

`binaryPatchDownloadUrl` is only written for a release published with
`--binary-bundle-path`. Every other release leaves the field out, and a history written
before binary patches existed stays valid as it is.

`diffPackages` is only written when a binary patch release also published
[asset diff archives](#asset-diff-archives), and holds one entry per archive: the
`packageHash` of the release the archive was diffed against, and the URL the archive can be
downloaded from. A release published without them leaves the field out the same way.

## Typical Workflow

```
1. npx code-push init              # One-time native setup
2. Create code-push.config.ts      # One-time config
3. npx code-push create-history    # Once per binary version
4. npx code-push release           # Each OTA update
5. npx code-push update-history    # Adjust rollout/flags as needed
6. npx code-push show-history      # Check release history as needed
```
