import { spawn } from "child_process";

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

function buildIos(appPath: string, simulator?: string): Promise<void> {
  const args = [
    "react-native", "run-ios",
    "--mode", "Release",
  ];
  if (simulator) {
    args.push("--simulator", simulator);
  }
  console.log(`[command] npx ${args.join(" ")} (cwd: ${appPath})`);
  return executeCommand("npx", args, appPath);
}

function buildAndroid(appPath: string): Promise<void> {
  const args = [
    "react-native", "run-android",
    "--mode", "release",
    "--active-arch-only",
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