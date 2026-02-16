import { spawn } from "child_process";
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

function buildIos(appPath: string, simulator?: string): Promise<void> {
  const args = [
    "react-native", "build-ios",
    "--mode", "Release",
  ];
  if (simulator) {
    args.push("--simulator", simulator);
  }
  console.log(`[command] npx ${args.join(" ")} (cwd: ${appPath})`);
  return executeCommand("npx", args, appPath);
}

function buildAndroid(appPath: string): Promise<void> {
  const cwd = path.join(appPath, "android");
  const args = ["assembleRelease", "-PreactNativeArchitectures=arm64-v8a"];
  console.log(`[command] ./gradlew ${args.join(" ")} (cwd: ${cwd})`);
  return executeCommand("./gradlew", args, cwd);
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