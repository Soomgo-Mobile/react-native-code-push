/**
 * Standalone reproduction for the reload-during-download race.
 *
 * It runs one scenario and nothing else: release one optional update, serve its archive
 * slowly, and reload the app in the middle of the download. The full runner's other
 * phases say nothing about this race, so none of them are run here.
 *
 * The app must already be built and installed, or --build has to be passed: native
 * changes only reach the device through a build.
 *
 *   npx tsx e2e/repro-reload-race.ts --app RN0840 --platform ios
 */
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { Command } from "commander";
import { getAppPath, getMockDataDir } from "./config";
import { buildApp } from "./helpers/build-app";
import { prepareConfig } from "./helpers/prepare-config";
import { prepareBundle } from "./helpers/prepare-bundle";
import { startMockServer, stopMockServer } from "./mock-server/server";

type Platform = "ios" | "android";

const FLOW_DIR = path.resolve(__dirname, "flows-reload-race");
const DEFAULT_SLOW_DOWNLOAD_MS = 12000;

const program = new Command()
  .requiredOption("--app <name>", "example app directory name")
  .requiredOption("--platform <type>", "ios or android")
  .option("--slow-download-ms <ms>", "how long one archive takes to arrive", String(DEFAULT_SLOW_DOWNLOAD_MS))
  .option("--skip-release", "reuse the update already in the mock data directory")
  .option("--build", "rebuild and install the app first, for a native change");

async function main(): Promise<void> {
  const options = program.parse(process.argv).opts<{
    app: string;
    platform: string;
    slowDownloadMs: string;
    skipRelease?: boolean;
    build?: boolean;
  }>();

  const platform = options.platform as Platform;
  if (platform !== "ios" && platform !== "android") {
    throw new Error(`Invalid --platform: ${options.platform}`);
  }

  const appPath = getAppPath(options.app);
  if (!fs.existsSync(appPath)) {
    throw new Error(`Example app not found: ${appPath}`);
  }

  process.env.E2E_SLOW_DOWNLOAD_MS = options.slowDownloadMs;

  const appId = readAppId(appPath, platform);
  const releaseIdentifier = readReleaseIdentifier(appPath);
  const startedAt = Date.now();

  prepareConfig(appPath, platform);

  if (options.build || !options.skipRelease) {
    // The copy of the library inside the app is what a build compiles and what releases
    // the update, so it has to be the one this checkout holds.
    console.log("\n=== [sync-local-library] ===");
    await run("npm", ["run", "sync-local-library", "--prefix", appPath]);
  }

  if (options.build) {
    console.log("\n=== [build] ===");
    await buildApp(appPath, platform);
  }

  if (!options.skipRelease) {
    console.log("\n=== [prepare-bundle] ===");
    const dataDir = getMockDataDir(platform);
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    // Optional, so the update waits for a restart instead of restarting by itself: the
    // reload this scenario races has to be the one the flow taps.
    await prepareBundle(appPath, platform, releaseIdentifier, undefined, { mandatory: false });
  }

  console.log(`\n=== [start-mock-server] (archives spread over ${options.slowDownloadMs}ms) ===`);
  await startMockServer(platform);

  if (platform === "android") {
    await run("adb", ["reverse", "tcp:18082", "tcp:18082"]).catch(() => undefined);
    await run("adb", ["logcat", "-c"]);
  }

  try {
    console.log("\n=== [run-maestro: restart during download] ===");
    await runMaestro(FLOW_DIR, platform, appId);
    console.log("\n=== flow passed: the app survived the reload ===");
  } catch (error) {
    console.error(`\n=== flow failed: ${(error as Error).message} ===`);
    process.exitCode = 1;
  } finally {
    await stopMockServer(platform);
    await reportCrashEvidence(platform, options.app, appId, startedAt);
  }
}

/**
 * What the device recorded while the flow ran.
 *
 * A failing assertion says the app went away but not why, and the app can also survive the
 * race while logging the very error this is looking for - so the evidence is printed
 * whether the flow passed or failed.
 */
async function reportCrashEvidence(
  platform: Platform,
  appName: string,
  appId: string,
  startedAt: number,
): Promise<void> {
  console.log("\n=== [device evidence] ===");

  if (platform === "android") {
    const logcat = await capture("adb", ["logcat", "-d", "-t", "4000"]);
    const lines = logcat
      .split("\n")
      .filter((line) => /FATAL EXCEPTION|AndroidRuntime|IllegalStateException|CodePush/.test(line));
    console.log(lines.length ? lines.slice(-60).join("\n") : "logcat has nothing about a crash or CodePush");
    return;
  }

  const reportDir = path.join(os.homedir(), "Library/Logs/DiagnosticReports");
  if (!fs.existsSync(reportDir)) {
    console.log(`no crash report directory at ${reportDir}`);
    return;
  }

  const reports = fs
    .readdirSync(reportDir)
    .filter((name) => name.includes(appName) || name.includes(appId))
    .map((name) => path.join(reportDir, name))
    .filter((file) => fs.statSync(file).mtimeMs >= startedAt);

  if (!reports.length) {
    console.log("no crash report was written while the flow ran");
    return;
  }

  // A crash report is mostly threads that were idle. What is worth printing is the kind of
  // crash and the frames that name this library, which is what says the finishing download
  // is what reached into the runtime that had gone.
  for (const report of reports) {
    console.log(`\n--- ${report} ---`);
    const content = fs.readFileSync(report, "utf8");
    const exception = content.match(/"exception"\s*:\s*\{[^}]*\}/)?.[0];
    if (exception) {
      console.log(exception);
    }
    const frames = [...content.matchAll(/"symbol"\s*:\s*"([^"]*(?:CodePush|RNCodePushSpec)[^"]*)"/g)]
      .map((match) => match[1]);
    console.log(frames.length ? [...new Set(frames)].join("\n") : "no frame names this library");
  }
}

function runMaestro(flowsDir: string, platform: Platform, appId: string): Promise<void> {
  if (platform === "ios") {
    return run("maestro", ["test", "--platform", "ios", "-e", `APP_ID=${appId}`, flowsDir]);
  }
  return run("maestro-runner", [
    "--platform", "android",
    "test",
    "--output", path.resolve(__dirname, "reports"),
    "--env", `APP_ID=${appId}`,
    flowsDir,
  ]);
}

function run(command: string, args: string[]): Promise<void> {
  console.log(`[command] ${command} ${args.join(" ")}`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code}`));
    });
  });
}

function capture(command: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(command, args);
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.on("error", () => resolve(""));
    child.on("close", () => resolve(output));
  });
}

function readAppId(appPath: string, platform: Platform): string {
  const appJson = JSON.parse(fs.readFileSync(path.join(appPath, "app.json"), "utf8")) as {
    name?: string;
    expo?: { ios?: { bundleIdentifier?: string }; android?: { package?: string } };
  };

  if (platform === "ios") {
    const expoId = appJson.expo?.ios?.bundleIdentifier;
    if (expoId) return expoId;
    if (!appJson.name) throw new Error("Could not find iOS app identifier in app.json");
    return `com.${appJson.name.toLowerCase().replace(/[^a-z0-9]+/g, "")}`;
  }

  const expoPackage = appJson.expo?.android?.package;
  if (expoPackage) return expoPackage;

  const gradle = fs.readFileSync(path.join(appPath, "android/app/build.gradle"), "utf8");
  const match = gradle.match(/applicationId\s+["']([^"']+)["']/) ?? gradle.match(/namespace\s+["']([^"']+)["']/);
  if (!match) throw new Error("Could not find Android app identifier");
  return match[1];
}

function readReleaseIdentifier(appPath: string): string {
  const content = fs.readFileSync(path.join(appPath, "App.tsx"), "utf8");
  const match = content.match(/const IDENTIFIER = ['"]([^'"]+)['"]/);
  if (!match) throw new Error("Could not find CodePush IDENTIFIER in App.tsx");
  return match[1];
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
