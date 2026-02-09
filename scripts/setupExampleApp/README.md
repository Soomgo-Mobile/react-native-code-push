# Setup Example App — Automation Script

Automates the creation of a React Native example app pre-configured with `@bravemobile/react-native-code-push`.

## Directory Structure

```
scripts/setupExampleApp/
├── runSetupExampleApp.ts      # Main entry point (CLI)
├── syncLocalLibrary.ts        # Syncs the local code-push build into node_modules
├── templates/
│   └── App.tsx.txt            # App.tsx template with CodePush test UI
├── tsconfig.json              # TypeScript config for this script directory
└── README.md                  # This file
```

## Prerequisites

- Node.js (>= 18)
- npm
- Ruby + Bundler (for iOS pod install)
- Xcode (for iOS)

## Usage

Run from the repository root:

```bash
npm run setup-example-app -- -v <react-native-version>
```

### CLI Options

| Flag | Description | Default |
|---|---|---|
| `-v, --rn-version <version>` | React Native version (e.g. `0.83.1`, `0.84.0-rc.5`) | **Required** |
| `-w, --working-dir <path>` | Directory where the app will be created | `./Examples` |
| `--skip-pod-install` | Skip `bundle install` and `pod install` | `false` |

### Example

```bash
# Create an example app for RN 0.83.1
npm run setup-example-app -- -v 0.83.1

# Create without pod install (useful on non-macOS or CI)
npm run setup-example-app -- -v 0.84.0-rc.5 --skip-pod-install
```

The generated project will be placed at `Examples/RN<version>/` (e.g. `Examples/RN0831/`).

## Pipeline Steps

The script runs the following steps **sequentially**. If any step fails, the remaining steps are skipped.

### 1. create-react-native-template

Runs `npx @react-native-community/cli init` to scaffold a blank React Native app at the target version. Dependency installation and pod install are deferred to later steps (`--skip-install`, `--install-pods false`).

### 2. configure-ios-versioning

Edits `ios/<ProjectName>.xcodeproj/project.pbxproj` and `ios/Podfile`:
- Sets `MARKETING_VERSION` to `1.0.0` across all build configurations.
- Sets `IPHONEOS_DEPLOYMENT_TARGET` to `16.0`.
- Sets the Podfile `platform :ios` to `'16.0'`.

### 3. configure-android-versioning

Edits `android/app/build.gradle`:
- Sets `versionName` to `"1.0.0"`.
- Enables ProGuard for release builds (`enableProguardInReleaseBuilds = true`).

### 4. configure-local-code-link

Modifies `package.json` to wire up the local library:
- Adds `@bravemobile/react-native-code-push` as a dependency.
- Adds an npm `sync-local-library` script pointing to `syncLocalLibrary.ts`.
- Adds a `setup:pods` convenience script (`bundle install && cd ios && bundle exec pod install`).
- Registers `sync-local-library` as a `postinstall` hook so the local build is synced on every `npm install`.
- Installs required dev dependencies if missing: `ts-node`, `axios`, `@types/node`, `@supabase/supabase-js`.

### 5. create-code-push-config

Copies the config template from `Examples/CodePushDemoApp/code-push.config.example.supabase.ts` into the project root as `code-push.config.ts`.

### 6. configure-ts-node

Updates `tsconfig.json`:
- Ensures `include` covers `**/*.ts`, `**/*.tsx`, and `code-push.config.ts`.
- Adds a `ts-node` section with `module: "CommonJS"` and `types: ["node"]` so that npm scripts can execute TypeScript files directly via ts-node.

### 7. apply-app-template

Reads `templates/App.tsx.txt`, replaces the `__IDENTIFIER__` placeholder with the project name (e.g. `RN0831`), and writes the result as `App.tsx` in the project root. The template includes a CodePush test UI with sync, metadata, and restart controls.

### 8. install-dependencies

Runs `npm install` inside the generated project. Because a `postinstall` hook was configured in step 4, this also triggers `sync-local-library`, which packs and copies the local code-push library into `node_modules`.

### 9. install-ios-pods

Runs `bundle install` followed by `bundle exec pod install` inside the `ios/` directory. Skipped entirely when `--skip-pod-install` is specified.

### 10. initialize-code-push

Runs `npx code-push init` inside the project to inject CodePush configuration into the iOS and Android native projects.

## Helper Script: syncLocalLibrary.ts

This script is registered as the `sync-local-library` npm script in the generated app. It is invoked automatically on `npm install` (via `postinstall`) and can also be run manually:

```bash
npm run sync-local-library
```

**What it does:**
1. Runs `npm pack` at the repository root to produce a `.tgz` tarball of the local library.
2. Extracts the tarball into a temp directory.
3. Replaces the contents of `node_modules/@bravemobile/react-native-code-push` with the extracted package.
4. Cleans up all temp files and the local npm cache.
