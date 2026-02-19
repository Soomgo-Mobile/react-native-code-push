# E2E Matrix Runner Scripts

This directory contains wrapper scripts to run E2E tests across multiple app variants.

## Scripts

- `scripts/e2e/run-rn-cli-matrix.sh`
- `scripts/e2e/run-expo-matrix.sh`

---

## 1) `run-rn-cli-matrix.sh`

Runs E2E tests for React Native CLI example apps (`RN0747` ~ `RN0840`) as a version matrix.

### What it does

1. Creates apps with `npm run setup-example-app` (unless `--skip-setup` is used).
2. Runs E2E for each configured RN version.
3. Continues even if some targets fail.
4. Prints a final summary with passed/failed counts and failed targets.

### Usage

```bash
bash scripts/e2e/run-rn-cli-matrix.sh [options]
```

### Options

| Option | Description | Default |
|---|---|---|
| `--force-recreate` | Recreate app directories even if they already exist | `false` |
| `--skip-setup` | Skip app setup and run E2E only | `false` |
| `--only android\|ios` | Run only one platform | both |
| `--legacy-arch-max-version <minor(2 digits)>` | Use legacy architecture setup for RN versions whose **minor** is less than or equal to this value | `76` |

### `--legacy-arch-max-version` format

- Exactly 2 digits only.
- `76` means `0.76.x` and below use legacy architecture setup.
- `81` means `0.81.x` and below use legacy architecture setup.
- Patch version is ignored by design.

Examples:

```bash
# Default threshold (76): legacy for 0.76.x and below
bash scripts/e2e/run-rn-cli-matrix.sh

# Run android only
bash scripts/e2e/run-rn-cli-matrix.sh --only android

# Use legacy setup up to 0.81.x
bash scripts/e2e/run-rn-cli-matrix.sh --legacy-arch-max-version 81

# Skip setup and run iOS only
bash scripts/e2e/run-rn-cli-matrix.sh --skip-setup --only ios
```

### Exit code

- `0`: all targets passed
- `1`: one or more targets failed

---

## 2) `run-expo-matrix.sh`

Runs E2E tests for Expo example apps (`Expo54`, `Expo55Beta`) as a matrix.

### What it does

1. Creates Expo apps with `npm run setup-expo-example-app` (unless `--skip-setup` is used).
2. Runs E2E for each Expo app and platform.
3. Continues even if some targets fail.
4. Prints a final summary with passed/failed counts and failed targets.

### Usage

```bash
bash scripts/e2e/run-expo-matrix.sh [options]
```

### Options

| Option | Description | Default |
|---|---|---|
| `--force-recreate` | Recreate app directories even if they already exist | `false` |
| `--skip-setup` | Skip app setup and run E2E only | `false` |
| `--only android\|ios` | Run only one platform | both |

Examples:

```bash
# Full Expo matrix (setup + android + ios)
bash scripts/e2e/run-expo-matrix.sh

# Android only
bash scripts/e2e/run-expo-matrix.sh --only android

# Recreate apps and run iOS only
bash scripts/e2e/run-expo-matrix.sh --force-recreate --only ios
```

### Exit code

- `0`: all targets passed
- `1`: one or more targets failed

---

## Notes

- Run from repository root for predictable paths.
- Both scripts intentionally continue after per-target failures and report all failures at the end.
