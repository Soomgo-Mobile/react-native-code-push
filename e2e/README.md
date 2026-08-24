# E2E Testing Guide

End-to-end tests for `react-native-code-push` using [Maestro](https://github.com/mobile-dev-inc/Maestro) on iOS and [maestro-runner](https://github.com/devicelab-dev/maestro-runner) on Android.

## Prerequisites

- **Node.js** (v18+)
- **Maestro CLI (iOS)** — `curl -Ls "https://get.maestro.mobile.dev" | bash`
- **maestro-runner (Android)** — `curl -fsSL https://open.devicelab.dev/install/maestro-runner | bash`
- **iOS**: Xcode with a booted iOS Simulator
- **Android**: Android SDK with a running emulator
- An example app set up under `Examples/` (e.g. `RN0840`)

## Quick Start

```bash
# Full run (build + test)
npm run e2e -- --app RN0840 --platform ios

# Skip build, run test flows only
npm run e2e -- --app RN0840 --platform ios --maestro-only
```

### Expo Example App

```bash
# Full run for Expo example app
npm run e2e -- --app Expo55 --framework expo --platform ios

# Flow-only run for Expo example app
npm run e2e -- --app Expo55Beta --framework expo --platform ios --maestro-only
```

## CLI Options

| Option | Required | Description |
|---|---|---|
| `--app <name>` | Yes | Example app directory name (e.g. `RN0840`) |
| `--platform <type>` | Yes | `ios` or `android` |
| `--framework <type>` | No | Use `expo` for Expo example apps |
| `--simulator <name>` | No | iOS simulator name (auto-detects booted simulator, defaults to "iPhone 16") |
| `--maestro-only` | No | Skip build step, only run test flows |
| `--exclude-timing-sensitive` | No | Skip timing-sensitive optional scenarios (`03`, `04`). Default: off, so local runs include them |

## What It Does

The test runner (`e2e/run.ts`) executes these phases in order:

### Phase 1 — Basic Flows (`flows/`)

1. **Prepare config** — Patches `App.tsx` to point at a local mock server, copies `code-push.config.local.ts` to the app directory.
2. **Build app** — Builds the example app in Release mode and installs it on the simulator/emulator. The export hooks run inside that build, so the bundle they wrote out is then compared with the bundle inside the built app, and the `binary-patch-base.json` record beside it is checked against the same hash and binary version. The check runs only for an app that applies the hook for the platform being built (`codepush-export.gradle` in its `android/app/build.gradle`, `export-embedded-bundle.sh` as an Xcode build phase) — `RN0840` is the one that does today, and every other app is skipped with a log line. For an app that does apply it, a missing or mismatched export fails the run. A `--maestro-only` run builds nothing of its own, so it too is skipped when it finds no export.
3. **Prepare bundle** — Creates release history and bundles v1.0.1 using `npx code-push release`.
4. **Start mock server** — Starts a local HTTP server (port 18081) that serves bundles and release history JSON.
5. **Run test flows** — Uses Maestro on iOS and maestro-runner on Android:
   - `01-app-launch` — Verifies the app launches and UI elements are present.
   - `02-restart-no-crash` — Taps Restart, confirms app doesn't crash.
   - `03-update-flow` — Clears any previous update, triggers sync, verifies update installs (shows "UPDATED!") and metadata shows `METADATA_V1.0.1`.

### Phase 2 — Rollback to Binary (`flows-rollback/`)

6. **Disable release** — Disables v1.0.1 via `npx code-push update-history -e false`.
7. **Run rollback flow** — `01-rollback`: Launches app with the update installed, triggers sync. The library detects the disabled release and automatically rolls back to the binary version.

### Phase 3 — Partial Rollback (`flows-partial-rollback/`)

8. **Prepare two releases** — Bundles v1.0.1 and v1.0.2 with different content (using release markers for unique hashes).
9. **Update to latest** — `01-update-to-latest`: Starts from binary, syncs to v1.0.2, verifies `METADATA_V1.0.2`.
10. **Disable v1.0.2 only** — Disables only v1.0.2 via `npx code-push update-history`.
11. **Rollback to previous update** — `02-rollback-to-previous`: Verifies the app rolls back from v1.0.2 to v1.0.1 (not to the binary).

### Phase 4 — Optional Install Modes (`flows-optional/`)

12. **Prepare optional release per scenario** — For each scenario, recreates history and deploys a non-mandatory release (`-m false`) using `npx code-push release`.
13. **Run optional update flows** — Verifies optional updates are applied when:
   - `01-optional-update-on-relaunch` — The app is killed and relaunched.
   - `02-optional-update-on-restart-button` — The in-app "Restart app" button is pressed.
   - `03-optional-update-on-resume-after-20s` — Verifies `ON_NEXT_RESUME` applies the update when the app returns to foreground after staying in background for at least 20 seconds. Runs unless `--exclude-timing-sensitive` is passed.
   - `04-optional-update-on-suspend-after-20s` — Verifies `ON_NEXT_SUSPEND` applies the update while the app stays in background for at least 20 seconds, so the updated bundle is visible on the next foreground. Runs unless `--exclude-timing-sensitive` is passed.

### Phase 6 — Binary Patch Updates (`flows-binary-patch/`)

14. **Extract the base bundle** — Copies the JS bundle out of the app that is installed on the device (the APK's `assets/` on Android, the `.app` on iOS). A binary patch only applies to the exact bytes that shipped in the binary, so nothing else can stand in for it.
15. **Publish and install one release per scenario** — Each scenario releases with `--binary-bundle-path`, breaks the published patch where it wants it broken, and installs the update with `01-install-update`, which verifies the app shows `UPDATED!` and `METADATA_V<version>`:
   - `1.3.1` — Patch update installs on top of the app binary.
   - `1.3.2` — Patch update carrying an image asset installs.
   - `1.3.3` — Patch computed against a stale base bundle falls back to the full update.
   - `1.3.4` — Patch whose compressed body is corrupt falls back.
   - `1.3.9` — Patch that restores a bundle its manifest does not describe falls back.
   - `1.3.5` — Patch whose header is corrupt falls back.
   - `1.3.6` — Patch archive built for the other platform falls back.
   - `1.3.7` — One pre-built bundle (`bundle` once, `release --skip-bundle` twice, with the base bundle passed to only one of the two) installs as a patch from the history that carries a patch URL, and in full from the history that does not.
   - `1.3.8` — `02-ui-responsive-during-install`: the app answers taps while the patch is being downloaded and applied. Runs unless `--exclude-timing-sensitive` is passed.

A patch install and a fallback to the full archive install the same contents, so they look identical on screen. What tells them apart is which archives the app asked the mock server for, which every scenario asserts: `[patch]` for a patch install, `[patch, full]` for a fallback, `[full]` for a release published without a patch.

### Phase 7 — Asset Diff Updates (`flows-asset-diff/`)

16. **Install the base update** — Releases a base version with a binary patch and assets, and installs it with the Phase 6 install flow. Every release in this phase ships a 64KB asset shared by all of them plus one small asset of its own, so a base and its update always share one asset, differ in one, and drop one.
17. **Publish the update and its asset diff** — The next release joins the same history. The local config provides `bundleDownloader`, so the release downloads the base's full archive and publishes an asset diff archive alongside the full and patch archives, recording it in the history as `diffPackages`. Before anything is installed, the runner asserts the diff at the artifact level: the shared asset stayed out, the new asset travels in it, and the deletion manifest (`hotcodepush.json`) names the asset the update dropped.
   - `1.4.1 → 1.4.2` — A client running the base installs the update with `01-update-from-installed`, downloading the diff archive alone. The merged contents have to reproduce the released package hash, which is what proves the deletion and the overlay actually happened on the device.
   - `1.4.2` from the binary — With the diff release still standing, a client starting over from the binary holds no installed update, so it installs through the patch archive as if the diff had never been published.
   - `1.4.3 → 1.4.4` — A diff whose shipped asset is corrupted downloads and merges, fails the package verification, and falls back to the full archive.

A diff install and its fallback also install the same contents, so every scenario again asserts the downloaded archives: `[diff]` for a diff install, `[patch]` for a client the diff cannot serve, `[diff, full]` for a fallback.

## Architecture

```
e2e/
├── run.ts                  # Main orchestration script
├── config.ts               # Paths, ports, host configuration
├── tsconfig.json
├── mock-server/
│   └── server.ts           # Express static file server (port 18081), records every request
├── templates/
│   └── code-push.config.local.ts  # Filesystem-based CodePush config
├── helpers/
│   ├── prepare-config.ts   # Patches App.tsx (host + temporary E2E buttons), copies config
│   ├── prepare-bundle.ts   # Runs code-push CLI to create bundles
│   ├── build-app.ts        # Builds iOS/Android in Release mode
│   ├── artifact-storage.ts # Asserts where the CLI stored bundles and release histories
│   ├── download-order.ts   # Turns the server's request log into the archives the app downloaded
│   ├── binary-patch-fixtures.ts  # Base bundle extraction and broken patch archives
│   ├── binary-patch-phase.ts     # Binary patch scenario matrix
│   ├── asset-diff-fixtures.ts    # Published diff archive assertions and corruption
│   ├── asset-diff-phase.ts       # Asset diff scenario matrix
│   └── embedded-bundle-export.ts # Asserts the export hooks wrote the bundle the binary ships
├── flows/                  # Phase 1: basic flows
├── flows-rollback/         # Phase 2: rollback to binary
├── flows-partial-rollback/ # Phase 3: partial rollback (v1.0.2 → v1.0.1)
├── flows-optional/         # Phase 4: optional install mode verification
├── flows-binary-patch/     # Phase 6: binary patch install and fallback
├── flows-asset-diff/       # Phase 7: asset diff install on top of an installed update
└── scripts/
    └── sleep.js            # Maestro runScript helper for deterministic waits
```

### Mock Server

Instead of a real CodePush server, tests use a local Express server that serves:
- **Bundles**: `mock-server/data/bundles/{platform}/{identifier}/full-bundle/{packageHash}` and `mock-server/data/bundles/{platform}/{identifier}/{artifactType}/{targetBinaryVersion}/`
- **Release history**: `mock-server/data/histories/{platform}/{identifier}/{version}.json`

The `code-push.config.local.ts` template routes all CLI operations (upload, history read/write) to this local filesystem, and the app's `CODEPUSH_HOST` is patched to point at the mock server. It uses the uploader's artifact metadata for the storage key, so its layout does not depend on archive filenames.

The server records every request it answers. Reading that log back is how the runner tells apart cases the screen cannot: which update archives the app downloaded, and in which order.

When the config template is given `E2E_ARTIFACT_LOG_PATH`, it also records every artifact it stores (outside the served directory), which the runner reads back to assert that bundles and release histories keep landing under their metadata-based paths.

### Release Markers

When creating multiple releases with identical source code (e.g. v1.0.1 and v1.0.2), the bundled JavaScript would produce the same hash, causing CodePush to treat them as the same update. To avoid this, the runner injects `console.log("E2E_MARKER_{version}")` into `App.tsx` before each release, which survives minification and produces unique bundle hashes.

## Troubleshooting

- **Build fails with signing error (iOS)**: The setup script sets `SUPPORTED_PLATFORMS = iphonesimulator` and disables code signing. Make sure the example app was set up with `scripts/setupExampleApp`.
- **Maestro/maestro-runner can't find the app**: Ensure the simulator/emulator is booted before running. For iOS, the script auto-detects the booted simulator.
- **Android network error**: Android emulators use `10.0.2.2` to reach the host machine's localhost. This is handled automatically by the config. A phone connected over adb has no such alias, so the runner forwards the mock server port onto the device (`adb reverse`) and points the app at its own localhost instead. Set `E2E_ANDROID_MOCK_SERVER_HOST` to override either default.
- **Update not applying**: Check that the mock server is running (port 18081) and that `mock-server/data/` contains the expected bundle and history files.
