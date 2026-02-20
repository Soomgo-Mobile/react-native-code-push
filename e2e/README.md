# E2E Testing Guide

End-to-end tests for `react-native-code-push` using [maestro-runner](https://github.com/devicelab-dev/maestro-runner).

## Prerequisites

- **Node.js** (v18+)
- **maestro-runner** — `curl -fsSL https://open.devicelab.dev/install/maestro-runner | bash`
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
| `--team-id <id>` | No | Apple Team ID for iOS WDA signing (`maestro-runner`). If omitted on iOS, the runner auto-detects from env/keychain/profiles |

## What It Does

The test runner (`e2e/run.ts`) executes these phases in order:

### Phase 1 — Basic Flows (`flows/`)

1. **Prepare config** — Patches `App.tsx` to point at a local mock server, copies `code-push.config.local.ts` to the app directory.
2. **Build app** — Builds the example app in Release mode and installs it on the simulator/emulator.
3. **Prepare bundle** — Creates release history and bundles v1.0.1 using `npx code-push release`.
4. **Start mock server** — Starts a local HTTP server (port 18081) that serves bundles and release history JSON.
5. **Run test flows (via maestro-runner)** — Executes:
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

## Architecture

```
e2e/
├── run.ts                  # Main orchestration script
├── config.ts               # Paths, ports, host configuration
├── tsconfig.json
├── mock-server/
│   └── server.ts           # Express static file server (port 18081)
├── templates/
│   └── code-push.config.local.ts  # Filesystem-based CodePush config
├── helpers/
│   ├── prepare-config.ts   # Patches App.tsx, copies config
│   ├── prepare-bundle.ts   # Runs code-push CLI to create bundles
│   └── build-app.ts        # Builds iOS/Android in Release mode
├── flows/                  # Phase 1: basic flows
├── flows-rollback/         # Phase 2: rollback to binary
└── flows-partial-rollback/ # Phase 3: partial rollback (v1.0.2 → v1.0.1)
```

### Mock Server

Instead of a real CodePush server, tests use a local Express server that serves:
- **Bundles**: `mock-server/data/bundles/{platform}/{identifier}/`
- **Release history**: `mock-server/data/histories/{platform}/{identifier}/{version}.json`

The `code-push.config.local.ts` template routes all CLI operations (upload, history read/write) to this local filesystem, and the app's `CODEPUSH_HOST` is patched to point at the mock server.

### Release Markers

When creating multiple releases with identical source code (e.g. v1.0.1 and v1.0.2), the bundled JavaScript would produce the same hash, causing CodePush to treat them as the same update. To avoid this, the runner injects `console.log("E2E_MARKER_{version}")` into `App.tsx` before each release, which survives minification and produces unique bundle hashes.

## Troubleshooting

- **Build fails with signing error (iOS)**: The setup script sets `SUPPORTED_PLATFORMS = iphonesimulator` and disables code signing. Make sure the example app was set up with `scripts/setupExampleApp`.
- **maestro-runner can't find the app**: Ensure the simulator/emulator is booted before running. For iOS, the script auto-detects the booted simulator.
- **Android network error**: Android emulators use `10.0.2.2` to reach the host machine's localhost. This is handled automatically by the config.
- **Update not applying**: Check that the mock server is running (port 18081) and that `mock-server/data/` contains the expected bundle and history files.
