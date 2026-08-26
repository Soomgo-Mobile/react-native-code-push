import { Command } from "commander";
import { spawn, spawnSync } from "child_process";
import path from "path";
import fs from "fs";
import { getAppPath, getAppSourceEntryPath, getMockDataDir, getMockServerPort, WORK_DIR } from "./config";
import { prepareConfig, removeLocalConfig, restoreConfig } from "./helpers/prepare-config";
import { prepareBundle, runCodePushCommand, setReleasingBundle, setReleaseMarker, clearReleaseMarker, getCodePushReleaseArgs } from "./helpers/prepare-bundle";
import { buildApp } from "./helpers/build-app";
import { startMockServer, stopMockServer } from "./mock-server/server";
import { assertArtifactStorageLayout, clearArtifactLog } from "./helpers/artifact-storage";
import { assertFullArchivesOnly, startRecordingDownloads } from "./helpers/download-order";
import { assertReleaseOffersNoPatch } from "./helpers/binary-patch-fixtures";
import { runBinaryPatchPhase } from "./helpers/binary-patch-phase";
import { runAssetDiffPhase } from "./helpers/asset-diff-phase";
import { assertExportedBundleMatchesBinary } from "./helpers/embedded-bundle-export";

type Platform = "ios" | "android";

interface CliOptions {
  app: string;
  platform: string;
  framework?: "expo";
  simulator?: string;
  maestroOnly?: boolean;
  excludeTimingSensitive?: boolean;
  retryCount: number;
  retryDelaySec: number;
}

interface OptionalUpdateScenario {
  name: string;
  releaseVersion: string;
  flowPath: string;
}

interface AlertUpdateScenario {
  name: string;
  releaseVersion: string;
  flowPath: string;
}

/** The platforms a `--platform` value asks for, or null when it names none. */
function parsePlatforms(value: string): Platform[] | null {
  if (value === "both") {
    return ["ios", "android"];
  }
  if (value === "ios" || value === "android") {
    return [value];
  }
  return null;
}

function parseRetryCountOption(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("retry-count must be an integer >= 1");
  }
  return parsed;
}

function parseRetryDelaySecOption(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("retry-delay-sec must be an integer >= 0");
  }
  return parsed;
}

const program = new Command()
  .name("e2e")
  .description("Run E2E tests for CodePush example apps")
  .requiredOption("--app <name>", "Example app name (e.g. RN0840RC5)")
  .requiredOption("--platform <type>", "Platform: ios, android, or both to run them side by side")
  .option("--framework <type>", "Framework: expo")
  .option("--simulator <name>", "iOS simulator name (default: booted)")
  .option("--maestro-only", "Skip build, only run test flows", false)
  .option(
    "--exclude-timing-sensitive",
    "Exclude timing-sensitive optional install mode scenarios (ON_NEXT_RESUME/ON_NEXT_SUSPEND)",
    false,
  )
  .option(
    "--retry-count <count>",
    "Retry attempts for each Maestro execution block",
    parseRetryCountOption,
    1,
  )
  .option(
    "--retry-delay-sec <seconds>",
    "Delay between Maestro retries in seconds",
    parseRetryDelaySecOption,
    10,
  );

async function main() {
  const options = program.parse(process.argv).opts<CliOptions>();
  const appPath = getAppPath(options.app);
  const repoRoot = path.resolve(__dirname, "..");
  const retryDelayMs = options.retryDelaySec * 1000;
  const maestroOnly = options.maestroOnly ?? false;

  if (!fs.existsSync(appPath)) {
    console.error(`Example app not found: ${appPath}`);
    process.exitCode = 1;
    return;
  }

  const platforms = parsePlatforms(options.platform);
  if (!platforms) {
    console.error(`Invalid --platform: ${options.platform} (expected: ios, android or both)`);
    process.exitCode = 1;
    return;
  }

  // One checkout, one watchman watch and one copy of the library inside the app: the work
  // that is not per-platform is done once, before any platform's scenarios start.
  await resetWatchmanProject(repoRoot);
  await syncLocalLibraryIfAvailable(appPath, maestroOnly);

  const releaseIdentifier = getCodePushReleaseIdentifier(appPath);
  try {
    // 1. Prepare config
    console.log("\n=== [prepare] ===");
    for (const platform of platforms) {
      if (platform === "android" && !maestroOnly) {
        invalidateAndroidAutolinkingArtifacts(appPath);
      }
      prepareAndroidMockServerAccess(platform);
      prepareConfig(appPath, platform);
    }

    // 2. Build (unless --maestro-only)
    //
    // Builds stay sequential when both platforms run. They share the app directory and
    // its node_modules, and one machine gains little from compiling both at once.
    const runs: PlatformRunContext[] = [];
    for (const platform of platforms) {
      if (!maestroOnly) {
        console.log(`\n=== [${platform}][build] ===`);
        await buildApp(appPath, platform, options.simulator);
      }

      const appId = getAppId(appPath, platform);

      // The export hooks run inside the build that was just made, so what they wrote is
      // checked against that build's binary before the run goes on to release anything.
      console.log(`\n=== [${platform}][assert-embedded-bundle-export] ===`);
      assertExportedBundleMatchesBinary({
        appPath,
        platform,
        appId,
        binaryVersion: "1.0.0",
        buildSkipped: maestroOnly,
      });

      runs.push({
        appPath,
        platform,
        framework: options.framework,
        appId,
        releaseIdentifier,
        retryCount: options.retryCount,
        retryDelayMs,
        excludeTimingSensitive: options.excludeTimingSensitive ?? false,
      });
    }

    // 3. Run the scenarios of every platform, side by side when there is more than one.
    // Settled rather than raced: one platform failing must not cut the other one short,
    // and both verdicts are worth reporting.
    const outcomes = await Promise.allSettled(runs.map((run) => runPlatformScenarios(run)));

    let failed = false;
    outcomes.forEach((outcome, index) => {
      const platform = runs[index].platform;
      if (outcome.status === "fulfilled") {
        console.log(`\n=== E2E tests passed: ${platform} ===`);
        return;
      }

      failed = true;
      const reason: unknown = outcome.reason;
      const message = reason instanceof Error ? reason.message : String(reason);
      console.error(`\nE2E test failed (${platform}): ${message}`);
    });

    if (failed) {
      process.exitCode = 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nE2E test failed: ${message}`);
    process.exitCode = 1;
  } finally {
    // Cleanup
    console.log("\n=== [cleanup] ===");
    for (const platform of platforms) {
      await stopMockServer(platform);
      restoreConfig(appPath, platform);
      await stopGradleDaemonIfNeeded(appPath, platform);
    }
    removeLocalConfig(appPath);
  }
}

/** Everything one platform's scenarios need, once its app is built and installed. */
interface PlatformRunContext {
  appPath: string;
  platform: Platform;
  framework?: "expo";
  /** Android package name or iOS bundle identifier of the installed app. */
  appId: string;
  /** Identifier the app reads its release history under. */
  releaseIdentifier: string;
  retryCount: number;
  retryDelayMs: number;
  excludeTimingSensitive: boolean;
}

/**
 * Runs every scenario of one platform, from its first release to the asset diff phase.
 *
 * A run covering both platforms runs two of these side by side. Nothing here is shared
 * between them: each platform serves its own data on its own port, patches its own app
 * entry and releases through its own CLI output root.
 */
async function runPlatformScenarios(context: PlatformRunContext): Promise<void> {
  const {
    appPath,
    platform,
    framework,
    appId,
    releaseIdentifier,
    retryCount,
    retryDelayMs,
    excludeTimingSensitive,
  } = context;

  // 3. Prepare update bundle
  console.log(`\n=== [${platform}][prepare-bundle] ===`);
  cleanMockData(platform);
  await prepareBundle(appPath, platform, releaseIdentifier, framework);

  // 4. Start mock server
  console.log(`\n=== [${platform}][start-mock-server] ===`);
  await startMockServer(platform);
  await resetAppStateBeforeFlows(platform, appId);

  // A release published without a base bundle says nothing about a binary patch, and
  // has to keep being downloaded in full exactly as it was before patches existed.
  const fullOnlyRelease = "release without a binary patch";
  assertArtifactStorageLayout(fullOnlyRelease, platform);
  assertReleaseOffersNoPatch(fullOnlyRelease, platform, releaseIdentifier, "1.0.0", "1.0.1");

  // 5. Run Maestro — Phase 1: main flows
  console.log(`\n=== [${platform}][run-maestro: phase 1] ===`);
  const flowsDir = path.resolve(__dirname, "flows");
  await withRetry("run-maestro: phase 1", retryCount, retryDelayMs, async () => {
    startRecordingDownloads(platform);
    await runMaestro(flowsDir, platform, appId);
    assertFullArchivesOnly(fullOnlyRelease, platform);
  });

  // 6. Disable release for rollback test
  console.log(`\n=== [${platform}][disable-release] ===`);
  await runCodePushCommand(appPath, platform, [
    "update-history",
    "-c", "code-push.config.local.ts",
    "-b", "1.0.0",
    "-v", "1.0.1",
    "-p", platform,
    "-i", releaseIdentifier,
    "-e", "false",
  ]);

  // 7. Run Maestro — Phase 2: rollback to binary
  console.log(`\n=== [${platform}][run-maestro: phase 2 (rollback to binary)] ===`);
  const rollbackDir = path.resolve(__dirname, "flows-rollback");
  await withRetry(
    "run-maestro: phase 2 (rollback to binary)",
    retryCount,
    retryDelayMs,
    () => runMaestro(rollbackDir, platform, appId),
  );

  // 8. Prepare partial rollback: release 1.0.1 + 1.0.2 with different hashes
  console.log(`\n=== [${platform}][prepare-bundle: partial rollback] ===`);
  cleanMockData(platform);
  setReleasingBundle(appPath, platform, true);
  const { entryFile, frameworkArgs } = getCodePushReleaseArgs(appPath, framework);
  try {
    await runCodePushCommand(appPath, platform, [
      "create-history",
      "-c", "code-push.config.local.ts",
      "-b", "1.0.0",
      "-p", platform,
      "-i", releaseIdentifier,
    ]);
    setReleaseMarker(appPath, platform, "1.0.1");
    await runCodePushCommand(appPath, platform, [
      "release",
      "-c", "code-push.config.local.ts",
      "-b", "1.0.0", "-v", "1.0.1",
      ...frameworkArgs,
      "-p", platform, "-i", releaseIdentifier,
      "-e", entryFile, "-m", "true",
    ]);
    setReleaseMarker(appPath, platform, "1.0.2");
    await runCodePushCommand(appPath, platform, [
      "release",
      "-c", "code-push.config.local.ts",
      "-b", "1.0.0", "-v", "1.0.2",
      ...frameworkArgs,
      "-p", platform, "-i", releaseIdentifier,
      "-e", entryFile, "-m", "true",
    ]);
  } finally {
    clearReleaseMarker(appPath, platform);
    setReleasingBundle(appPath, platform, false);
  }

  // 9. Run Maestro — update to 1.0.2
  console.log(`\n=== [${platform}][run-maestro: partial rollback — update to 1.0.2] ===`);
  const updateFlow = path.resolve(__dirname, "flows-partial-rollback/01-update-to-latest.yaml");
  await withRetry(
    "run-maestro: partial rollback — update to 1.0.2",
    retryCount,
    retryDelayMs,
    () => runMaestro(updateFlow, platform, appId),
  );

  // 10. Run Maestro — rollback from 1.0.2 to 1.0.1
  console.log(`\n=== [${platform}][run-maestro: partial rollback — rollback to 1.0.1] ===`);
  const rollbackFlow = path.resolve(__dirname, "flows-partial-rollback/02-rollback-to-previous.yaml");
  await withRetry(
    "run-maestro: partial rollback — rollback to 1.0.1",
    retryCount,
    retryDelayMs,
    async () => {
      // Rebuild preconditions on every attempt so retry starts from the same state.
      await runCodePushCommand(appPath, platform, [
        "update-history",
        "-c", "code-push.config.local.ts",
        "-b", "1.0.0", "-v", "1.0.2",
        "-p", platform, "-i", releaseIdentifier,
        "-e", "true",
      ]);

      await runMaestro(updateFlow, platform, appId);

      await runCodePushCommand(appPath, platform, [
        "update-history",
        "-c", "code-push.config.local.ts",
        "-b", "1.0.0", "-v", "1.0.2",
        "-p", platform, "-i", releaseIdentifier,
        "-e", "false",
      ]);

      await runMaestro(rollbackFlow, platform, appId);
    },
  );

  // 11. Run Maestro — Phase 4: optional update install modes
  console.log(`\n=== [${platform}][run-maestro: phase 4 (optional install modes)] ===`);
  const optionalUpdateScenarios: OptionalUpdateScenario[] = [
    {
      name: "apply on app relaunch",
      releaseVersion: "1.1.1",
      flowPath: path.resolve(__dirname, "flows-optional/01-optional-update-on-relaunch.yaml"),
    },
    {
      name: "apply on restart button",
      releaseVersion: "1.1.2",
      flowPath: path.resolve(__dirname, "flows-optional/02-optional-update-on-restart-button.yaml"),
    },
  ];

  if (!excludeTimingSensitive) {
    optionalUpdateScenarios.push(
      {
        name: "apply on resume after 20 seconds",
        releaseVersion: "1.1.3",
        flowPath: path.resolve(__dirname, "flows-optional/03-optional-update-on-resume-after-20s.yaml"),
      },
      {
        name: "apply on suspend after 20 seconds",
        releaseVersion: "1.1.4",
        flowPath: path.resolve(__dirname, "flows-optional/04-optional-update-on-suspend-after-20s.yaml"),
      },
    );
  }

  if (excludeTimingSensitive) {
    console.log(`\n=== [${platform}][phase 4] skipping timing-sensitive scenarios (omit --exclude-timing-sensitive to include them) ===`);
  }

  for (const scenario of optionalUpdateScenarios) {
    console.log(`\n=== [${platform}][prepare-bundle: optional ${scenario.releaseVersion} (${scenario.name})] ===`);
    cleanMockData(platform);
    await prepareBundle(
      appPath,
      platform,
      releaseIdentifier,
      framework,
      {
        releaseVersion: scenario.releaseVersion,
        mandatory: false,
        releaseMarkerVersion: scenario.releaseVersion,
      },
    );

    await withRetry(
      `run-maestro: optional update (${scenario.name})`,
      retryCount,
      retryDelayMs,
      () => runMaestro(scenario.flowPath, platform, appId),
    );
  }

  // 12. Run Maestro — Phase 5: updateDialog alert flows
  console.log(`\n=== [${platform}][run-maestro: phase 5 (updateDialog alert flows)] ===`);
  const alertUpdateScenarios: AlertUpdateScenario[] = [
    {
      name: "ignore optional update from alert",
      releaseVersion: "1.2.1",
      flowPath: path.resolve(__dirname, "flows-alert/01-update-dialog-ignore.yaml"),
    },
    {
      name: "install optional update from alert",
      releaseVersion: "1.2.2",
      flowPath: path.resolve(__dirname, "flows-alert/02-update-dialog-install.yaml"),
    },
  ];

  for (const scenario of alertUpdateScenarios) {
    console.log(`\n=== [${platform}][prepare-bundle: alert ${scenario.releaseVersion} (${scenario.name})] ===`);
    cleanMockData(platform);
    await prepareBundle(
      appPath,
      platform,
      releaseIdentifier,
      framework,
      {
        releaseVersion: scenario.releaseVersion,
        mandatory: false,
        releaseMarkerVersion: scenario.releaseVersion,
      },
    );

    await withRetry(
      `run-maestro: updateDialog alert (${scenario.name})`,
      retryCount,
      retryDelayMs,
      () => runMaestro(scenario.flowPath, platform, appId),
    );
  }

  // 13. Run Maestro — Phase 6: binary patch updates
  console.log(`\n=== [${platform}][run-maestro: phase 6 (binary patch updates)] ===`);
  await runBinaryPatchPhase({
    appPath,
    platform,
    framework,
    releaseIdentifier,
    appId,
    excludeTimingSensitive,
    cleanMockData: () => cleanMockData(platform),
    runMaestro: (flowPath, flowEnv) => runMaestro(flowPath, platform, appId, flowEnv),
    withRetry: (label, action) => withRetry(label, retryCount, retryDelayMs, action),
  });

  // 14. Run Maestro — Phase 7: asset diff updates
  console.log(`\n=== [${platform}][run-maestro: phase 7 (asset diff updates)] ===`);
  await runAssetDiffPhase({
    appPath,
    platform,
    framework,
    releaseIdentifier,
    appId,
    cleanMockData: () => cleanMockData(platform),
    runMaestro: (flowPath, flowEnv) => runMaestro(flowPath, platform, appId, flowEnv),
    withRetry: (label, action) => withRetry(label, retryCount, retryDelayMs, action),
  });
}

function cleanMockData(platform: Platform): void {
  const dataDir = getMockDataDir(platform);
  if (fs.existsSync(dataDir)) {
    fs.rmSync(dataDir, { recursive: true });
  }
  fs.mkdirSync(dataDir, { recursive: true });
  // The record of what was stored describes the data that was just thrown away, so it is
  // cleared with it and every assertion over it is scoped to one scenario.
  clearArtifactLog(platform);
  fs.mkdirSync(WORK_DIR, { recursive: true });
}

/**
 * Points an Android device at the mock server.
 *
 * An emulator reaches the host through a loopback alias, which is what the mock server
 * host defaults to. A phone connected over adb has no such alias, so the server port is
 * forwarded onto the device and the app is pointed at the device's own localhost.
 */
function prepareAndroidMockServerAccess(platform: Platform): void {
  if (platform !== "android" || process.env.E2E_ANDROID_MOCK_SERVER_HOST) {
    return;
  }

  const listed = spawnSync("adb", ["devices"], { encoding: "utf8" });
  if (listed.status !== 0) {
    return;
  }

  const serials = listed.stdout
    .split("\n")
    .slice(1)
    .map((line) => line.split("\t"))
    .filter((columns) => columns.length === 2 && columns[1].trim() === "device")
    .map((columns) => columns[0].trim());

  if (serials.length === 0 || serials.some((serial) => serial.startsWith("emulator-"))) {
    return;
  }

  const port = String(getMockServerPort("android"));
  console.log(`[command] adb reverse tcp:${port} tcp:${port}`);
  const forwarded = spawnSync("adb", ["reverse", `tcp:${port}`, `tcp:${port}`], { stdio: "inherit" });
  if (forwarded.status !== 0) {
    throw new Error(`adb reverse tcp:${port} failed; the device cannot reach the mock server`);
  }

  process.env.E2E_ANDROID_MOCK_SERVER_HOST = "localhost";
  console.log(`[android] physical device detected (${serials.join(", ")}); mock server forwarded to its localhost`);
}

// npx code-push release/create-history must use the same identifier that the app uses when fetching history.
function getCodePushReleaseIdentifier(appPath: string): string {
  const appTsxPath = getAppSourceEntryPath(appPath);
  const content = fs.readFileSync(appTsxPath, "utf8");
  const match = content.match(/const IDENTIFIER = ['"]([^'"]+)['"]/);

  if (!match) {
    throw new Error(`Could not find CodePush IDENTIFIER in ${appTsxPath}`);
  }

  return match[1];
}

function getAppId(appPath: string, platform: Platform): string {
  const appJsonPath = path.join(appPath, "app.json");
  const appJson = JSON.parse(fs.readFileSync(appJsonPath, "utf8")) as {
    name?: string;
    expo?: {
      ios?: {
        bundleIdentifier?: string;
      };
      android?: {
        package?: string;
      };
    };
  };

  if (platform === "ios") {
    const expoBundleIdentifier = appJson.expo?.ios?.bundleIdentifier;
    if (typeof expoBundleIdentifier === "string" && expoBundleIdentifier.length > 0) {
      return expoBundleIdentifier;
    }

    if (typeof appJson.name !== "string" || appJson.name.length === 0) {
      throw new Error("Could not find iOS app identifier in app.json");
    }

    return buildCodePushBundleIdentifier(appJson.name);
  }

  const expoAndroidPackage = appJson.expo?.android?.package;
  if (typeof expoAndroidPackage === "string" && expoAndroidPackage.length > 0) {
    return expoAndroidPackage;
  }

  // Android: fallback to build.gradle
  const buildGradlePath = path.join(appPath, "android", "app", "build.gradle");
  const content = fs.readFileSync(buildGradlePath, "utf8");
  const applicationIdMatch = content.match(/applicationId\s+["']([^"']+)["']/);
  if (applicationIdMatch) {
    return applicationIdMatch[1];
  }

  const namespaceMatch = content.match(/namespace\s+["']([^"']+)["']/);
  if (namespaceMatch) {
    return namespaceMatch[1];
  }

  throw new Error(`Could not find Android app identifier in ${buildGradlePath}`);
}

function buildCodePushBundleIdentifier(appName: string): string {
  const normalized = appName.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (normalized.length === 0) {
    throw new Error(`Invalid app name for bundle identifier: ${appName}`);
  }
  return `com.${normalized}`;
}

async function withRetry(
  label: string,
  retryCount: number,
  retryDelayMs: number,
  action: () => Promise<void>,
): Promise<void> {
  for (let attempt = 1; attempt <= retryCount; attempt += 1) {
    if (retryCount > 1) {
      console.log(`[retry] ${label} attempt ${attempt}/${retryCount}`);
    }

    try {
      await action();
      if (attempt > 1) {
        console.log(`[retry] ${label} succeeded on attempt ${attempt}/${retryCount}`);
      }
      return;
    } catch (error) {
      if (attempt === retryCount) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[retry] ${label} failed on attempt ${attempt}/${retryCount}: ${message}`);

      if (retryDelayMs > 0) {
        console.log(`[retry] waiting ${retryDelayMs / 1000}s before retry`);
        await sleep(retryDelayMs);
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function runMaestro(
  flowsDir: string,
  platform: Platform,
  appId: string,
  flowEnv: Record<string, string> = {},
): Promise<void> {
  // Scenarios that differ only in what the installed update should say reuse one flow and
  // are told the difference through the flow environment. maestro-runner refuses a mix of
  // the long and the short flag, so each runner is passed the form it is already given.
  const flowEnvArgs = (flag: string) =>
    Object.entries(flowEnv).flatMap(([name, value]) => [flag, `${name}=${value}`]);

  if (platform === "ios") {
    const args = [
      "test",
      "--platform", "ios",
      "-e", `APP_ID=${appId}`,
      ...flowEnvArgs("-e"),
      flowsDir,
    ];
    console.log(`[command] maestro ${args.join(" ")}`);

    return new Promise((resolve, reject) => {
      const child = spawn("maestro", args, { stdio: "inherit" });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`maestro tests failed (exit code: ${code})`));
      });
    });
  }

  // Root directory for maestro-runner report outputs.
  const reportRootDir = path.resolve(__dirname, "reports");
  fs.mkdirSync(reportRootDir, { recursive: true });
  const args = ["--platform", "android"];
  args.push("test", "--output", reportRootDir, "--env", `APP_ID=${appId}`, ...flowEnvArgs("--env"), flowsDir);

  console.log(`[command] maestro-runner ${args.join(" ")}`);

  return new Promise((resolve, reject) => {
    const child = spawn("maestro-runner", args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`maestro-runner tests failed (exit code: ${code})`));
    });
  });
}

void main();

async function resetWatchmanProject(repoRoot: string): Promise<void> {
  console.log("\n=== [watchman] ===");

  const watchDel = await runWatchmanCommand(["watch-del", repoRoot]);
  if (!watchDel.ok && !watchDel.message.includes("not watched")) {
    console.warn(`[warn] watchman watch-del failed: ${watchDel.message}`);
  }

  const watchProject = await runWatchmanCommand(["watch-project", repoRoot]);
  if (!watchProject.ok) {
    console.warn(`[warn] watchman watch-project failed: ${watchProject.message}`);
    return;
  }

  console.log("[watchman] watch reset done");
}

function runWatchmanCommand(args: string[]): Promise<{ ok: boolean; message: string }> {
  console.log(`[command] watchman ${args.join(" ")}`);

  return new Promise((resolve) => {
    const child = spawn("watchman", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout?.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", (error) => {
      resolve({ ok: false, message: error.message });
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true, message: output.trim() });
      } else {
        resolve({ ok: false, message: output.trim() });
      }
    });
  });
}

function resetAppStateBeforeFlows(
  platform: Platform,
  appId: string,
): Promise<void> {
  if (platform !== "android") {
    return Promise.resolve();
  }

  const args = ["shell", "pm", "clear", appId];
  console.log(`[command] adb ${args.join(" ")}`);
  return new Promise((resolve, reject) => {
    const child = spawn("adb", args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`adb pm clear failed (exit code: ${code})`));
      }
    });
  });
}

// Android builds can leave Gradle daemon (java) processes running; stop them best-effort between E2E runs.
function stopGradleDaemonIfNeeded(
  appPath: string,
  platform: Platform,
): Promise<void> {
  if (platform !== "android") {
    return Promise.resolve();
  }

  const androidPath = path.join(appPath, "android");
  console.log(`[command] ./gradlew --stop (cwd: ${androidPath})`);

  return new Promise((resolve) => {
    const child = spawn("./gradlew", ["--stop"], { cwd: androidPath, stdio: "inherit" });
    child.once("error", (error) => {
      console.warn(`[warn] gradle daemon stop failed: ${error.message}`);
      resolve();
    });
    child.once("close", () => {
      resolve();
    });
  });
}

function syncLocalLibraryIfAvailable(appPath: string, maestroOnly: boolean): Promise<void> {
  const packageJsonPath = path.join(appPath, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return Promise.resolve();
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
    scripts?: Record<string, string>;
  };
  const hasSyncScript = Boolean(packageJson.scripts?.["sync-local-library"]);

  if (!hasSyncScript) {
    return Promise.resolve();
  }

  if (maestroOnly) {
    console.log(
      "[warn] --maestro-only mode: native library changes require rebuilding the app binary.",
    );
  }

  const args = ["run", "sync-local-library"];
  console.log(`[command] npm ${args.join(" ")} (cwd: ${appPath})`);

  const verbose = process.env.E2E_VERBOSE_SYNC === "1";
  if (verbose) {
    return new Promise((resolve, reject) => {
      const child = spawn("npm", args, { cwd: appPath, stdio: "inherit" });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`npm run sync-local-library failed (exit code: ${code})`));
        }
      });
    });
  }

  return new Promise((resolve, reject) => {
    const child = spawn("npm", args, {
      cwd: appPath,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        npm_config_loglevel: "error",
      },
    });
    let output = "";
    child.stdout?.on("data", (chunk) => {
      output += chunk.toString();
      if (output.length > 12000) {
        output = output.slice(output.length - 12000);
      }
    });
    child.stderr?.on("data", (chunk) => {
      output += chunk.toString();
      if (output.length > 12000) {
        output = output.slice(output.length - 12000);
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        console.log("[sync-local-library] done");
        resolve();
      } else {
        if (output.trim().length > 0) {
          console.error("[sync-local-library] output:\n" + output.trim());
        }
        reject(new Error(`npm run sync-local-library failed (exit code: ${code})`));
      }
    });
  });
}

function invalidateAndroidAutolinkingArtifacts(appPath: string): void {
  const androidPath = path.join(appPath, "android");
  const generatedPaths = [
    path.join(androidPath, "build", "generated", "autolinking"),
    path.join(androidPath, "app", "build", "generated", "autolinking"),
  ];

  let removedAny = false;
  for (const generatedPath of generatedPaths) {
    if (!fs.existsSync(generatedPath)) {
      continue;
    }

    fs.rmSync(generatedPath, { recursive: true, force: true });
    removedAny = true;
  }

  if (removedAny) {
    console.log("[android-autolinking] cleared generated autolinking artifacts");
  }
}
