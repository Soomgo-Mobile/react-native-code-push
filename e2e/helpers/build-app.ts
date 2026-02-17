import { execSync, spawn } from "child_process";
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

async function buildIos(appPath: string, simulator?: string): Promise<void> {
  console.log(`[command] npm run setup:pods (cwd: ${appPath})`);
  await executeCommand("npm", ["run", "setup:pods"], appPath);

  const appName = path.basename(appPath);
  const destination = simulator
    ? `platform=iOS Simulator,name=${simulator}`
    : `platform=iOS Simulator,id=${getBootedSimulatorId()}`;

  const args = [
    "-workspace", `ios/${appName}.xcworkspace`,
    "-scheme", appName,
    "-configuration", "Release",
    "-sdk", "iphonesimulator",
    "-destination", destination,
    "-derivedDataPath", "ios/build",
    "CODE_SIGN_IDENTITY=-",
    "CODE_SIGNING_REQUIRED=NO",
    "CODE_SIGNING_ALLOWED=NO",
  ];

  console.log(`[command] xcodebuild ${args.join(" ")} (cwd: ${appPath})`);
  await executeCommand("xcodebuild", args, appPath);

  // Install on simulator
  const appBundlePath = `ios/build/Build/Products/Release-iphonesimulator/${appName}.app`;
  const simId = simulator
    ? getSimulatorId(simulator)
    : getBootedSimulatorId();

  console.log(`[command] xcrun simctl install ${simId} ${appBundlePath}`);
  await executeCommand("xcrun", ["simctl", "install", simId, appBundlePath], appPath);

  console.log(`[command] xcrun simctl launch ${simId} org.reactjs.native.example.${appName}`);
  await executeCommand("xcrun", ["simctl", "launch", simId, `org.reactjs.native.example.${appName}`], appPath);
}

function getBootedSimulatorId(): string {
  const output = execSync("xcrun simctl list devices booted -j", { encoding: "utf8" });
  const data = JSON.parse(output);
  for (const runtime of Object.values(data.devices) as any[]) {
    for (const device of runtime) {
      if (device.state === "Booted") {
        return device.udid;
      }
    }
  }
  throw new Error("No booted iOS simulator found");
}

function getSimulatorId(name: string): string {
  const output = execSync("xcrun simctl list devices available -j", { encoding: "utf8" });
  const data = JSON.parse(output);
  for (const runtime of Object.values(data.devices) as any[]) {
    for (const device of runtime) {
      if (device.name === name) {
        return device.udid;
      }
    }
  }
  throw new Error(`Simulator "${name}" not found`);
}

function buildAndroid(appPath: string): Promise<void> {
  const args = [
    "react-native", "run-android",
    "--mode", "release",
    "--active-arch-only",
    "--no-packager",
  ];
  console.log(`[command] npx ${args.join(" ")} (cwd: ${appPath})`);
  return executeCommand("npx", args, appPath);
}

function executeCommand(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args[0]} failed (exit code: ${code})`));
    });
  });
}