import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { MOCK_DATA_DIR, getMockServerHost } from "../config";

export function setReleasingBundle(appPath: string, value: boolean): void {
  const appTsxPath = path.join(appPath, "App.tsx");
  let content = fs.readFileSync(appTsxPath, "utf8");
  content = content.replace(
    value
      ? /const IS_RELEASING_BUNDLE = false/
      : /const IS_RELEASING_BUNDLE = true/,
    `const IS_RELEASING_BUNDLE = ${value}`,
  );
  fs.writeFileSync(appTsxPath, content, "utf8");
}

const RELEASE_MARKER_PATTERN = /^console\.log\("E2E_MARKER_.*"\);$/m;

/**
 * Add a unique code statement to App.tsx to ensure different bundle hashes
 * for releases with otherwise identical content.
 */
export function setReleaseMarker(appPath: string, version: string): void {
  const appTsxPath = path.join(appPath, "App.tsx");
  let content = fs.readFileSync(appTsxPath, "utf8");
  const marker = `console.log("E2E_MARKER_${version}");`;
  if (RELEASE_MARKER_PATTERN.test(content)) {
    content = content.replace(RELEASE_MARKER_PATTERN, marker);
  } else {
    content = `${marker}\n${content}`;
  }
  fs.writeFileSync(appTsxPath, content, "utf8");
}

export function clearReleaseMarker(appPath: string): void {
  const appTsxPath = path.join(appPath, "App.tsx");
  let content = fs.readFileSync(appTsxPath, "utf8");
  content = content.replace(RELEASE_MARKER_PATTERN, "").replace(/^\n+/, "");
  fs.writeFileSync(appTsxPath, content, "utf8");
}

export async function prepareBundle(
  appPath: string,
  platform: "ios" | "android",
  appName: string,
): Promise<void> {
  setReleasingBundle(appPath, true);

  try {
    await runCodePushCommand(appPath, platform, appName, [
      "code-push", "create-history",
      "-c", "code-push.config.local.ts",
      "-b", "1.0.0",
      "-p", platform,
      "-i", appName,
    ]);
    await runCodePushRelease(appPath, platform, appName);
  } finally {
    setReleasingBundle(appPath, false);
  }
}

function runCodePushRelease(
  appPath: string,
  platform: "ios" | "android",
  appName: string,
): Promise<void> {
  return runCodePushCommand(appPath, platform, appName, [
    "code-push", "release",
    "-c", "code-push.config.local.ts",
    "-b", "1.0.0",
    "-v", "1.0.1",
    "-p", platform,
    "-i", appName,
    "-e", "index.js",
    "-m", "true",
  ]);
}

export function runCodePushCommand(
  appPath: string,
  platform: "ios" | "android",
  appName: string,
  args: string[],
): Promise<void> {
  console.log(`[command] npx ${args.join(" ")} (cwd: ${appPath})`);

  return new Promise((resolve, reject) => {
    const child = spawn("npx", args, {
      cwd: appPath,
      stdio: "inherit",
      env: {
        ...process.env,
        E2E_MOCK_DATA_DIR: MOCK_DATA_DIR,
        E2E_MOCK_SERVER_HOST: getMockServerHost(platform),
      },
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`npx ${args[0]} ${args[1]} failed (exit code: ${code})`));
    });
  });
}