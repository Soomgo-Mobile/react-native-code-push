/**
 * Checks the export hooks against the binary the same build produced.
 *
 * `android/codepush-export.gradle` and `scripts/export-embedded-bundle.sh` copy the JS
 * bundle a build embeds, so a later release can compute a patch against the bytes the
 * store binary ships. Nothing about that copy is self-verifying: an export taken from the
 * wrong build directory, or from before the bundle was written, is still a plausible file
 * with a plausible record, and the first sign of it would be a patch that no device can
 * apply.
 *
 * So the export is compared against the bundle taken out of the installed app, which is
 * the same ground truth the patch scenarios build their base bundle from.
 */

import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { extractBinaryBundle, getJsBundleName, sha256OfFile, type Platform } from "./binary-patch-fixtures";
import { isExpoApp } from "./build-app";

/** Record both export hooks write next to the bundle they copied. */
const EXPORT_RECORD_NAME = "binary-patch-base.json";

/** Scenario name every log line and failure of this check is written under. */
const SCENARIO = "embedded bundle export";

/** The build the E2E run makes, and so the only one that embeds a bundle to export. */
const ANDROID_VARIANT = "release";
const IOS_CONFIGURATION = "Release";

interface ExportRecord {
  baseBundleHash?: string;
  binaryVersion?: string;
  buildNumber?: string;
  gitSha?: string;
}

export interface EmbeddedBundleExportContext {
  appPath: string;
  platform: Platform;
  /** Android package name or iOS bundle identifier of the installed app. */
  appId: string;
  /** Binary version every release of this run targets. */
  binaryVersion: string;
  /** A run that built nothing has no build products of its own to check. */
  buildSkipped: boolean;
}

/**
 * Asserts that the exported bundle is byte for byte the one inside the built app, and that
 * the record beside it describes that same bundle and this binary version.
 */
export function assertExportedBundleMatchesBinary(context: EmbeddedBundleExportContext): void {
  const { platform, appId, binaryVersion, buildSkipped } = context;

  const exportDir = resolveExportDir(context.appPath, platform);
  if (exportDir == null) {
    reportMissing(buildSkipped, "the export directory of this build could not be resolved");
    return;
  }

  const exportedBundlePath = path.join(exportDir, getJsBundleName(platform));
  const recordPath = path.join(exportDir, EXPORT_RECORD_NAME);
  if (!fs.existsSync(exportedBundlePath) || !fs.existsSync(recordPath)) {
    reportMissing(buildSkipped, `no export was found in ${exportDir}`);
    return;
  }

  let embeddedBundlePath: string;
  try {
    embeddedBundlePath = extractBinaryBundle(platform, appId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    reportMissing(buildSkipped, `the bundle inside the installed app could not be read (${message})`);
    return;
  }

  const embeddedHash = sha256OfFile(embeddedBundlePath);
  const exportedHash = sha256OfFile(exportedBundlePath);
  if (exportedHash !== embeddedHash) {
    throw new Error(
      `${SCENARIO}: the export is not the bundle the binary ships. `
      + `Exported ${exportedBundlePath} hashes ${exportedHash}, `
      + `while the bundle inside the installed app hashes ${embeddedHash}`,
    );
  }
  console.log(`[assert] ${SCENARIO}: ${exportedBundlePath} is the bundle inside the binary (${exportedHash})`);

  const record = JSON.parse(fs.readFileSync(recordPath, "utf8")) as ExportRecord;
  if (record.baseBundleHash !== embeddedHash) {
    throw new Error(
      `${SCENARIO}: ${recordPath} records baseBundleHash ${String(record.baseBundleHash)}, `
      + `while the bundle inside the installed app hashes ${embeddedHash}`,
    );
  }
  console.log(`[assert] ${SCENARIO}: ${EXPORT_RECORD_NAME} records that hash as the base bundle hash`);

  if (record.binaryVersion !== binaryVersion) {
    throw new Error(
      `${SCENARIO}: ${recordPath} records binaryVersion ${String(record.binaryVersion)}, `
      + `while this run releases against ${binaryVersion}`,
    );
  }
  console.log(`[assert] ${SCENARIO}: ${EXPORT_RECORD_NAME} records binaryVersion ${binaryVersion}`);
}

/**
 * A flows-only run inherits whatever an earlier run left behind, so an export it cannot
 * find is a missing build product rather than a broken hook. A run that built the app has
 * no such excuse.
 */
function reportMissing(buildSkipped: boolean, reason: string): void {
  if (!buildSkipped) {
    throw new Error(`${SCENARIO}: ${reason}`);
  }

  console.log(`[assert] ${SCENARIO}: skipped, this run built nothing and ${reason}`);
}

function resolveExportDir(appPath: string, platform: Platform): string | undefined {
  return platform === "android" ? resolveAndroidExportDir(appPath) : resolveIosExportDir(appPath);
}

/**
 * `codepush-export.gradle` exports under the app module's build directory, and appends the
 * variant name to whatever root `codePushExportDir` overrides it with.
 */
function resolveAndroidExportDir(appPath: string): string {
  const moduleDir = path.join(appPath, "android", "app");
  const configuredRoot = readGradleProperty(appPath, "codePushExportDir");
  const exportRoot = configuredRoot == null
    ? path.join(moduleDir, "build", "codepush", "embedded-bundle")
    : path.resolve(moduleDir, configuredRoot);

  return path.join(exportRoot, ANDROID_VARIANT);
}

function readGradleProperty(appPath: string, name: string): string | undefined {
  const propertiesPath = path.join(appPath, "android", "gradle.properties");
  if (!fs.existsSync(propertiesPath)) {
    return undefined;
  }

  const line = fs.readFileSync(propertiesPath, "utf8")
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${name}=`));

  return line?.slice(name.length + 1).trim() || undefined;
}

/**
 * `export-embedded-bundle.sh` exports under `$BUILD_DIR`, into a directory named after the
 * configuration and the platform. Where Xcode puts `$BUILD_DIR` depends on how the build
 * was invoked, so it is read back out of the build settings rather than guessed.
 */
function resolveIosExportDir(appPath: string): string | undefined {
  const settings = readIosBuildSettings(appPath);
  if (settings == null) {
    return undefined;
  }

  const { BUILD_DIR, CONFIGURATION, PLATFORM_NAME, CODEPUSH_EXPORT_DIR } = settings;
  if (!BUILD_DIR || !CONFIGURATION || !PLATFORM_NAME) {
    return undefined;
  }

  const exportRoot = CODEPUSH_EXPORT_DIR || path.join(BUILD_DIR, "codepush", "embedded-bundle");
  return path.join(exportRoot, `${CONFIGURATION}-${PLATFORM_NAME}`);
}

function readIosBuildSettings(appPath: string): Record<string, string> | undefined {
  const iosDir = path.join(appPath, "ios");
  if (!fs.existsSync(iosDir)) {
    return undefined;
  }

  const workspaceName = fs.readdirSync(iosDir).find((name) => name.endsWith(".xcworkspace"));
  if (workspaceName == null) {
    return undefined;
  }

  const args = [
    "-workspace", path.join(iosDir, workspaceName),
    "-scheme", path.basename(workspaceName, ".xcworkspace"),
    "-configuration", IOS_CONFIGURATION,
    "-sdk", "iphonesimulator",
    "-showBuildSettings",
    "-json",
  ];

  // An Expo app is built into the project's own derived data rather than the shared one,
  // and its build settings only say so when the build is described the same way. Which of
  // the two a build uses is decided by the same question `buildApp` asks - a leftover
  // `ios/build` from some earlier build answers nothing.
  if (isExpoApp(appPath)) {
    args.push("-derivedDataPath", path.join(iosDir, "build"));
  }

  try {
    // Asking for build settings without naming a device makes xcodebuild list every
    // simulator it could have meant, which says nothing here and buries the run's log.
    const output = execFileSync("xcodebuild", args, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const entries = JSON.parse(output) as { buildSettings?: Record<string, string> }[];
    return entries.find((entry) => entry.buildSettings != null)?.buildSettings;
  } catch {
    return undefined;
  }
}
