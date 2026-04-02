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

You need a `code-push.config.ts` (or `.js`) file at your project root. It exports an object with three functions — `bundleUploader`, `getReleaseHistory`, and `setReleaseHistory` — that tell the CLI how to talk to your storage backend.

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

```bash
# Bundle for Android with a custom entry file
npx code-push bundle -p android -e index.js
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
    "packageHash": "d4e5f6..."
  }
}
```

## Typical Workflow

```
1. npx code-push init              # One-time native setup
2. Create code-push.config.ts      # One-time config
3. npx code-push create-history    # Once per binary version
4. npx code-push release           # Each OTA update
5. npx code-push update-history    # Adjust rollout/flags as needed
6. npx code-push show-history      # Check release history as needed
```
