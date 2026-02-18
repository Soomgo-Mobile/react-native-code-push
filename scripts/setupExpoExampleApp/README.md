# Setup Expo Example App — Automation Script

Automates creation of an Expo example app pre-configured with `@bravemobile/react-native-code-push`.

## Directory Structure

```text
scripts/setupExpoExampleApp/
├── runSetupExpoExampleApp.ts  # Main entry point (CLI)
└── README.md                  # This file
```

## Prerequisites

- Node.js (>= 18)
- npm
- Network access for `npx create-expo-app@latest` and `npm install`

## Usage

Run from the repository root:

```bash
npm run setup-expo-example-app -- --sdk <sdk-version>
```

This script reuses TypeScript settings from `scripts/setupExampleApp/tsconfig.json`.

### CLI Options

| Flag | Description | Default |
|---|---|---|
| `--sdk <version>` | Expo SDK major version (e.g. `54`, `55`) | **Required** |
| `--beta` | Adds `Beta` suffix to generated app name | `false` |
| `--project-name <name>` | Override generated app name | auto-generated |
| `-w, --working-dir <path>` | Directory where the app will be created | `./Examples` |
| `--ios-min-version <version>` | Minimum iOS deployment target | `16.0` |

### App Name Rule

- `--sdk 54` -> `Expo54`
- `--sdk 55 --beta` -> `Expo55Beta`

Generated path:
- `Examples/Expo54/`
- `Examples/Expo55Beta/`

### Examples

```bash
# Create Expo SDK 55 app
npm run setup-expo-example-app -- --sdk 55

# Create Expo SDK 55 beta app
npm run setup-expo-example-app -- --sdk 55 --beta

# Create in a custom directory
npm run setup-expo-example-app -- --sdk 54 -w /tmp/examples
```

## What the Script Configures

The script runs these steps in order:

1. Creates a new Expo app from `default@sdk-<sdk>`.
2. Updates `app.json`:
   - Adds `@bravemobile/react-native-code-push` plugin.
   - Sets iOS bundle identifier and deployment target.
   - Sets Android package and `usesCleartextTraffic`.
3. Adds local library wiring in `package.json`:
   - Adds `@bravemobile/react-native-code-push` dependency.
   - Adds `sync-local-library` and local release scripts.
   - Adds/extends `postinstall` to run `sync-local-library`.
4. Ensures required dev dependencies for local scripts.
5. Copies `code-push.config.ts` template.
6. Updates `tsconfig.json` for `ts-node`.
7. Replaces `App.tsx` with the CodePush test template.
8. Wires Expo Router home route to render `App.tsx`.
9. Runs `npm install`.
10. Runs `npx expo prebuild --platform all --clean --no-install`.
11. Raises iOS minimum deployment target in generated native project files.

## Running E2E Tests (Separate Command)

This setup script only creates/configures the example app.
Run E2E separately via `e2e/run.ts`:

```bash
npm run e2e -- --app Expo55 --framework expo --platform ios
```
