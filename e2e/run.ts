import { Command } from "commander";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { getAppPath, MOCK_DATA_DIR } from "./config";
import { prepareConfig, restoreConfig } from "./helpers/prepare-config";
import { prepareBundle, runCodePushCommand, setReleasingBundle, setReleaseMarker, clearReleaseMarker, getCodePushReleaseArgs } from "./helpers/prepare-bundle";
import { buildApp } from "./helpers/build-app";
import { startMockServer, stopMockServer } from "./mock-server/server";

interface CliOptions {
  app: string;
  platform: "ios" | "android";
  framework?: "expo";
  simulator?: string;
  maestroOnly?: boolean;
}

const program = new Command()
  .name("e2e")
  .description("Run E2E tests with Maestro for CodePush example apps")
  .requiredOption("--app <name>", "Example app name (e.g. RN0840RC5)")
  .requiredOption("--platform <type>", "Platform: ios or android")
  .option("--framework <type>", "Framework: expo")
  .option("--simulator <name>", "iOS simulator name (default: booted)")
  .option("--maestro-only", "Skip build, only run Maestro flows", false);

async function main() {
  const options = program.parse(process.argv).opts<CliOptions>();
  const appPath = getAppPath(options.app);

  if (!fs.existsSync(appPath)) {
    console.error(`Example app not found: ${appPath}`);
    process.exitCode = 1;
    return;
  }

  try {
    // 1. Prepare config
    console.log("\n=== [prepare] ===");
    prepareConfig(appPath, options.platform);

    // 2. Build (unless --maestro-only)
    if (!options.maestroOnly) {
      console.log("\n=== [build] ===");
      await buildApp(appPath, options.platform, options.simulator);
    }

    // 3. Prepare update bundle
    console.log("\n=== [prepare-bundle] ===");
    cleanMockData();
    await prepareBundle(appPath, options.platform, options.app, options.framework);

    // 4. Start mock server
    console.log("\n=== [start-mock-server] ===");
    await startMockServer();

    // 5. Run Maestro — Phase 1: main flows
    console.log("\n=== [run-maestro: phase 1] ===");
    const appId = getAppId(appPath, options.platform);
    const flowsDir = path.resolve(__dirname, "flows");
    await runMaestro(flowsDir, options.platform, appId);

    // 6. Disable release for rollback test
    console.log("\n=== [disable-release] ===");
    await runCodePushCommand(appPath, options.platform, options.app, [
      "code-push", "update-history",
      "-c", "code-push.config.local.ts",
      "-b", "1.0.0",
      "-v", "1.0.1",
      "-p", options.platform,
      "-i", options.app,
      "-e", "false",
    ]);

    // 7. Run Maestro — Phase 2: rollback to binary
    console.log("\n=== [run-maestro: phase 2 (rollback to binary)] ===");
    const rollbackDir = path.resolve(__dirname, "flows-rollback");
    await runMaestro(rollbackDir, options.platform, appId);

    // 8. Prepare partial rollback: release 1.0.1 + 1.0.2 with different hashes
    console.log("\n=== [prepare-bundle: partial rollback] ===");
    cleanMockData();
    setReleasingBundle(appPath, true);
    const { entryFile, frameworkArgs } = getCodePushReleaseArgs(appPath, options.framework);
    try {
      await runCodePushCommand(appPath, options.platform, options.app, [
        "code-push", "create-history",
        "-c", "code-push.config.local.ts",
        "-b", "1.0.0",
        "-p", options.platform,
        "-i", options.app,
      ]);
      setReleaseMarker(appPath, "1.0.1");
      await runCodePushCommand(appPath, options.platform, options.app, [
        "code-push", "release",
        "-c", "code-push.config.local.ts",
        "-b", "1.0.0", "-v", "1.0.1",
        ...frameworkArgs,
        "-p", options.platform, "-i", options.app,
        "-e", entryFile, "-m", "true",
      ]);
      setReleaseMarker(appPath, "1.0.2");
      await runCodePushCommand(appPath, options.platform, options.app, [
        "code-push", "release",
        "-c", "code-push.config.local.ts",
        "-b", "1.0.0", "-v", "1.0.2",
        ...frameworkArgs,
        "-p", options.platform, "-i", options.app,
        "-e", entryFile, "-m", "true",
      ]);
    } finally {
      clearReleaseMarker(appPath);
      setReleasingBundle(appPath, false);
    }

    // 9. Run Maestro — update to 1.0.2
    console.log("\n=== [run-maestro: partial rollback — update to 1.0.2] ===");
    const updateFlow = path.resolve(__dirname, "flows-partial-rollback/01-update-to-latest.yaml");
    await runMaestro(updateFlow, options.platform, appId);

    // 10. Disable only 1.0.2 → rollback target is 1.0.1 (not binary)
    console.log("\n=== [disable-release: 1.0.2 only] ===");
    await runCodePushCommand(appPath, options.platform, options.app, [
      "code-push", "update-history",
      "-c", "code-push.config.local.ts",
      "-b", "1.0.0", "-v", "1.0.2",
      "-p", options.platform, "-i", options.app,
      "-e", "false",
    ]);

    // 11. Run Maestro — rollback from 1.0.2 to 1.0.1
    console.log("\n=== [run-maestro: partial rollback — rollback to 1.0.1] ===");
    const rollbackFlow = path.resolve(__dirname, "flows-partial-rollback/02-rollback-to-previous.yaml");
    await runMaestro(rollbackFlow, options.platform, appId);

    console.log("\n=== E2E tests passed ===");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nE2E test failed: ${message}`);
    process.exitCode = 1;
  } finally {
    // 8. Cleanup
    console.log("\n=== [cleanup] ===");
    await stopMockServer();
    restoreConfig(appPath);
  }
}

function cleanMockData(): void {
  if (fs.existsSync(MOCK_DATA_DIR)) {
    fs.rmSync(MOCK_DATA_DIR, { recursive: true });
  }
  fs.mkdirSync(MOCK_DATA_DIR, { recursive: true });
}

function getAppId(appPath: string, platform: "ios" | "android"): string {
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
  return `com.codepush.${normalized}`;
}

function runMaestro(flowsDir: string, platform: "ios" | "android", appId: string): Promise<void> {
  const args = ["test", flowsDir, "--env", `APP_ID=${appId}`];

  if (platform === "android") {
    args.push("--platform", "android");
  } else {
    args.push("--platform", "ios");
  }

  console.log(`[command] maestro ${args.join(" ")}`);

  return new Promise((resolve, reject) => {
    const child = spawn("maestro", args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Maestro tests failed (exit code: ${code})`));
    });
  });
}

void main();
