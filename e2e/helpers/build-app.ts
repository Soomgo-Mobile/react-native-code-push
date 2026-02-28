import { execSync, spawn } from "child_process";
import fs from "fs";
import path from "path";

export async function buildApp(
  appPath: string,
  platform: "ios" | "android",
  simulator?: string,
): Promise<void> {
  if (platform === "ios") {
    await buildIos(appPath, simulator);
  } else {
    await buildAndroid(appPath);
  }
}

const DEFAULT_SIMULATOR = "iPhone 16";

type IOSSimulatorDevice = {
  udid: string;
  name: string;
  state: string;
  isAvailable?: boolean;
  availability?: string;
};

type IOSSimulator = {
  udid: string;
  name: string;
};

function getBootedSimulator(): IOSSimulator | undefined {
  try {
    const output = execSync("xcrun simctl list devices booted -j", { encoding: "utf8" });
    const data = JSON.parse(output) as {
      devices: Record<string, IOSSimulatorDevice[]>;
    };

    for (const runtime of Object.values(data.devices)) {
      const booted = runtime.find((d) => d.state === "Booted");
      if (booted) {
        return { udid: booted.udid, name: booted.name };
      }
    }
  } catch {
    // ignore
  }

  return undefined;
}

async function buildIos(appPath: string, simulator?: string): Promise<void> {
  if (isExpoApp(appPath)) {
    await buildExpoIosWithoutLaunch(appPath, simulator);
    return;
  }

  console.log(`[command] npm run setup:pods (cwd: ${appPath})`);
  await executeCommand("npm", ["run", "setup:pods"], appPath);

  const sim = simulator ?? getBootedSimulator()?.name ?? DEFAULT_SIMULATOR;
  const args = [
    "react-native", "run-ios",
    "--mode", "Release",
    "--no-packager",
    "--simulator", sim,
  ];
  console.log(`[command] npx ${args.join(" ")} (cwd: ${appPath})`);
  return executeCommand("npx", args, appPath);
}

async function buildExpoIosWithoutLaunch(appPath: string, simulator?: string): Promise<void> {
  await ensureExpoIosNativeProjectReady(appPath);

  const iosDirPath = path.join(appPath, "ios");
  const appName = getExpoAppName(appPath);
  const workspacePath = resolveExpoWorkspacePath(iosDirPath, appName);
  const scheme = resolveExpoScheme(appPath, workspacePath, appName);
  const targetSimulator = resolveSimulator(simulator);
  const derivedDataPath = path.join(iosDirPath, "build");

  const buildArgs = [
    "-workspace", workspacePath,
    "-scheme", scheme,
    "-configuration", "Release",
    "-destination", `id=${targetSimulator.udid}`,
    "-derivedDataPath", derivedDataPath,
    "-quiet",
    "build",
  ];
  console.log(`[command] xcodebuild ${buildArgs.join(" ")} (cwd: ${appPath})`);
  await executeCommandInternal("xcodebuild", buildArgs, appPath, { silent: true });

  const appBundlePath = resolveBuiltAppBundlePath(derivedDataPath, scheme);
  const installArgs = ["simctl", "install", targetSimulator.udid, appBundlePath];
  console.log(`[command] xcrun ${installArgs.join(" ")} (cwd: ${appPath})`);
  await executeCommand("xcrun", installArgs, appPath);
}

async function ensureExpoIosNativeProjectReady(appPath: string): Promise<void> {
  const iosDirPath = path.join(appPath, "ios");

  if (!hasValidExpoIosProject(iosDirPath)) {
    const prebuildArgs = ["--yes", "expo", "prebuild", "--platform", "ios", "--no-install"];
    console.log(`[command] npx ${prebuildArgs.join(" ")} (cwd: ${appPath})`);
    await executeCommand("npx", prebuildArgs, appPath);
  }

  if (!hasWorkspace(iosDirPath)) {
    const podInstallArgs = ["--yes", "pod-install"];
    console.log(`[command] npx ${podInstallArgs.join(" ")} (cwd: ${appPath})`);
    await executeCommand("npx", podInstallArgs, appPath);
  }
}

function hasValidExpoIosProject(iosDirPath: string): boolean {
  if (!fs.existsSync(iosDirPath)) {
    return false;
  }

  const podfilePath = path.join(iosDirPath, "Podfile");
  if (!fs.existsSync(podfilePath)) {
    return false;
  }

  const entries = fs.readdirSync(iosDirPath);
  return entries.some((name) => name.endsWith(".xcodeproj"));
}

function getExpoAppName(appPath: string): string {
  const appJsonPath = path.join(appPath, "app.json");
  const appJson = JSON.parse(fs.readFileSync(appJsonPath, "utf8")) as {
    expo?: {
      name?: string;
    };
  };
  const appName = appJson.expo?.name?.trim();

  if (appName && appName.length > 0) {
    return appName;
  }

  return path.basename(appPath);
}

function resolveExpoWorkspacePath(iosDirPath: string, appName: string): string {
  const workspaces = listWorkspaces(iosDirPath);

  if (workspaces.length === 0) {
    throw new Error(`No .xcworkspace found in ${iosDirPath}`);
  }

  const preferredWorkspace = `${appName}.xcworkspace`;
  const workspaceName = workspaces.includes(preferredWorkspace)
    ? preferredWorkspace
    : workspaces[0];

  return path.join("ios", workspaceName);
}

function hasWorkspace(iosDirPath: string): boolean {
  return listWorkspaces(iosDirPath).length > 0;
}

function listWorkspaces(iosDirPath: string): string[] {
  if (!fs.existsSync(iosDirPath)) {
    return [];
  }

  return fs.readdirSync(iosDirPath)
    .filter((name) => name.endsWith(".xcworkspace"));
}

function resolveExpoScheme(appPath: string, workspacePath: string, appName: string): string {
  try {
    const output = execSync(
      `xcodebuild -list -json -workspace "${workspacePath}"`,
      { cwd: appPath, encoding: "utf8" },
    );
    const parsed = JSON.parse(output) as {
      workspace?: {
        schemes?: string[];
      };
      project?: {
        schemes?: string[];
      };
    };
    const schemes = parsed.workspace?.schemes ?? parsed.project?.schemes ?? [];

    if (schemes.length === 0) {
      return appName;
    }

    const matched = schemes.find((scheme) => scheme === appName);
    return matched ?? schemes[0];
  } catch {
    return appName;
  }
}

function resolveSimulator(simulator?: string): IOSSimulator {
  const booted = getBootedSimulator();
  if (simulator == null || simulator.length === 0) {
    if (!booted) {
      throw new Error("No booted iOS simulator found. Boot a simulator before running E2E.");
    }
    return booted;
  }

  const listed = listSimulators();
  const byUdid = listed.find((device) => device.udid === simulator);
  if (byUdid) {
    return { udid: byUdid.udid, name: byUdid.name };
  }

  if (booted && booted.name === simulator) {
    return booted;
  }

  const byName = listed.find((device) => device.name === simulator);
  if (byName) {
    if (byName.state !== "Booted") {
      throw new Error(
        `Simulator "${simulator}" is not booted. Boot it first, then run E2E again.`,
      );
    }
    return { udid: byName.udid, name: byName.name };
  }

  throw new Error(`Simulator "${simulator}" not found.`);
}

function listSimulators(): IOSSimulatorDevice[] {
  try {
    const output = execSync("xcrun simctl list devices available -j", { encoding: "utf8" });
    const data = JSON.parse(output) as {
      devices: Record<string, IOSSimulatorDevice[]>;
    };
    const flat = Object.values(data.devices).flat();
    return flat.filter((device) => device.isAvailable !== false);
  } catch {
    return [];
  }
}

function resolveBuiltAppBundlePath(derivedDataPath: string, scheme: string): string {
  const productDir = path.join(
    derivedDataPath,
    "Build",
    "Products",
    "Release-iphonesimulator",
  );
  const expected = path.join(productDir, `${scheme}.app`);
  if (fs.existsSync(expected)) {
    return expected;
  }

  if (!fs.existsSync(productDir)) {
    throw new Error(`Build output directory not found: ${productDir}`);
  }

  const appBundles = fs.readdirSync(productDir).filter((name) => name.endsWith(".app"));
  if (appBundles.length === 1) {
    return path.join(productDir, appBundles[0]);
  }

  throw new Error(
    `Could not resolve built app bundle for scheme "${scheme}" in ${productDir}`,
  );
}

function buildAndroid(appPath: string): Promise<void> {
  if (isExpoApp(appPath)) {
    const args = ["expo", "run:android", "--variant", "release", "--no-bundler"];
    console.log(`[command] npx ${args.join(" ")} (cwd: ${appPath})`);
    return executeCommand("npx", args, appPath);
  }

  const args = [
    "react-native", "run-android",
    "--mode", "release",
    "--active-arch-only",
    "--no-packager",
  ];
  console.log(`[command] npx ${args.join(" ")} (cwd: ${appPath})`);
  return executeCommand("npx", args, appPath);
}

function isExpoApp(appPath: string): boolean {
  const packageJsonPath = path.join(appPath, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return false;
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  return Boolean(
    packageJson.dependencies?.expo
    || packageJson.devDependencies?.expo
  );
}

function executeCommand(command: string, args: string[], cwd: string): Promise<void> {
  return executeCommandInternal(command, args, cwd, { silent: false });
}

function executeCommandInternal(
  command: string,
  args: string[],
  cwd: string,
  options: { silent: boolean },
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!options.silent) {
      const child = spawn(command, args, { cwd, stdio: "inherit" });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`${command} ${args[0]} failed (exit code: ${code})`));
      });
      return;
    }

    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      const diagnostic = formatSilentCommandError(command, stdout, stderr);
      if (diagnostic.length > 0) {
        console.error(diagnostic);
      }
      reject(new Error(`${command} ${args[0]} failed (exit code: ${code})`));
    });
  });
}

function formatSilentCommandError(command: string, stdout: string, stderr: string): string {
  if (command !== "xcodebuild") {
    return stderr.trim();
  }

  const combined = `${stdout}\n${stderr}`;
  const errorLines = combined
    .split(/\r?\n/)
    .filter((line) => /(^|\s)(error:|❌)/i.test(line))
    .slice(-200);

  if (errorLines.length > 0) {
    return errorLines.join("\n");
  }

  return stderr.trim();
}
