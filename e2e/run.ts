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
  retryCount: number;
  retryDelaySec: number;
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
  .requiredOption("--platform <type>", "Platform: ios or android")
  .option("--framework <type>", "Framework: expo")
  .option("--simulator <name>", "iOS simulator name (default: booted)")
  .option("--maestro-only", "Skip build, only run test flows", false)
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

  if (!fs.existsSync(appPath)) {
    console.error(`Example app not found: ${appPath}`);
    process.exitCode = 1;
    return;
  }

  await resetWatchmanProject(repoRoot);
  await syncLocalLibraryIfAvailable(appPath, options.maestroOnly ?? false);

  const releaseIdentifier = getCodePushReleaseIdentifier(appPath);
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
    await prepareBundle(appPath, options.platform, releaseIdentifier, options.framework);

    // 4. Start mock server
    console.log("\n=== [start-mock-server] ===");
    await startMockServer();

    const appId = getAppId(appPath, options.platform);
    await resetAppStateBeforeFlows(options.platform, appId);

    // 5. Run Maestro — Phase 1: main flows
    console.log("\n=== [run-maestro: phase 1] ===");
    const flowsDir = path.resolve(__dirname, "flows");
    await withRetry("run-maestro: phase 1", options.retryCount, retryDelayMs, () =>
      runMaestro(flowsDir, options.platform, appId),
    );

    // 6. Disable release for rollback test
    console.log("\n=== [disable-release] ===");
    await runCodePushCommand(appPath, options.platform, [
      "update-history",
      "-c", "code-push.config.local.ts",
      "-b", "1.0.0",
      "-v", "1.0.1",
      "-p", options.platform,
      "-i", releaseIdentifier,
      "-e", "false",
    ]);

    // 7. Run Maestro — Phase 2: rollback to binary
    console.log("\n=== [run-maestro: phase 2 (rollback to binary)] ===");
    const rollbackDir = path.resolve(__dirname, "flows-rollback");
    await withRetry(
      "run-maestro: phase 2 (rollback to binary)",
      options.retryCount,
      retryDelayMs,
      () => runMaestro(rollbackDir, options.platform, appId),
    );

    // 8. Prepare partial rollback: release 1.0.1 + 1.0.2 with different hashes
    console.log("\n=== [prepare-bundle: partial rollback] ===");
    cleanMockData();
    setReleasingBundle(appPath, true);
    const { entryFile, frameworkArgs } = getCodePushReleaseArgs(appPath, options.framework);
    try {
      await runCodePushCommand(appPath, options.platform, [
        "create-history",
        "-c", "code-push.config.local.ts",
        "-b", "1.0.0",
        "-p", options.platform,
        "-i", releaseIdentifier,
      ]);
      setReleaseMarker(appPath, "1.0.1");
      await runCodePushCommand(appPath, options.platform, [
        "release",
        "-c", "code-push.config.local.ts",
        "-b", "1.0.0", "-v", "1.0.1",
        ...frameworkArgs,
        "-p", options.platform, "-i", releaseIdentifier,
        "-e", entryFile, "-m", "true",
      ]);
      setReleaseMarker(appPath, "1.0.2");
      await runCodePushCommand(appPath, options.platform, [
        "release",
        "-c", "code-push.config.local.ts",
        "-b", "1.0.0", "-v", "1.0.2",
        ...frameworkArgs,
        "-p", options.platform, "-i", releaseIdentifier,
        "-e", entryFile, "-m", "true",
      ]);
    } finally {
      clearReleaseMarker(appPath);
      setReleasingBundle(appPath, false);
    }

    // 9. Run Maestro — update to 1.0.2
    console.log("\n=== [run-maestro: partial rollback — update to 1.0.2] ===");
    const updateFlow = path.resolve(__dirname, "flows-partial-rollback/01-update-to-latest.yaml");
    await withRetry(
      "run-maestro: partial rollback — update to 1.0.2",
      options.retryCount,
      retryDelayMs,
      () => runMaestro(updateFlow, options.platform, appId),
    );

    // 10. Disable only 1.0.2 → rollback target is 1.0.1 (not binary)
    console.log("\n=== [disable-release: 1.0.2 only] ===");
    await runCodePushCommand(appPath, options.platform, [
      "update-history",
      "-c", "code-push.config.local.ts",
      "-b", "1.0.0", "-v", "1.0.2",
      "-p", options.platform, "-i", releaseIdentifier,
      "-e", "false",
    ]);

    // 11. Run Maestro — rollback from 1.0.2 to 1.0.1
    console.log("\n=== [run-maestro: partial rollback — rollback to 1.0.1] ===");
    const rollbackFlow = path.resolve(__dirname, "flows-partial-rollback/02-rollback-to-previous.yaml");
    await withRetry(
      "run-maestro: partial rollback — rollback to 1.0.1",
      options.retryCount,
      retryDelayMs,
      () => runMaestro(rollbackFlow, options.platform, appId),
    );

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
    await stopGradleDaemonIfNeeded(appPath, options.platform);
  }
}

function cleanMockData(): void {
  if (fs.existsSync(MOCK_DATA_DIR)) {
    fs.rmSync(MOCK_DATA_DIR, { recursive: true });
  }
  fs.mkdirSync(MOCK_DATA_DIR, { recursive: true });
}

// npx code-push release/create-history must use the same identifier that the app uses when fetching history.
function getCodePushReleaseIdentifier(appPath: string): string {
  const appTsxPath = path.join(appPath, "App.tsx");
  const content = fs.readFileSync(appTsxPath, "utf8");
  const match = content.match(/const IDENTIFIER = ['"]([^'"]+)['"]/);

  if (!match) {
    throw new Error(`Could not find CodePush IDENTIFIER in ${appTsxPath}`);
  }

  return match[1];
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
  platform: "ios" | "android",
  appId: string,
): Promise<void> {
  if (platform === "ios") {
    const args = [
      "test",
      "--platform", "ios",
      "-e", `APP_ID=${appId}`,
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
  args.push("test", "--output", reportRootDir, "--env", `APP_ID=${appId}`, flowsDir);

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
  platform: "ios" | "android",
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
  platform: "ios" | "android",
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
