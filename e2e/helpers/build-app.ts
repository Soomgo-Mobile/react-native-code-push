import { spawn } from "child_process";

export async function buildApp(
  appPath: string,
  platform: "ios" | "android",
): Promise<void> {
  if (platform === "ios") {
    await buildIos(appPath);
  } else {
    await buildAndroid(appPath);
  }
}

function buildIos(appPath: string): Promise<void> {
  const args = [
    "react-native", "build-ios",
    "--mode", "Release",
    "--simulator", "iPhone 16",
  ];
  console.log(`[command] npx ${args.join(" ")} (cwd: ${appPath})`);
  return executeCommand("npx", args, appPath);
}

function buildAndroid(appPath: string): Promise<void> {
  const args = [
    "react-native", "build-android",
    "--mode", "release",
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