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
  framework?: "expo",
): Promise<void> {
  setReleasingBundle(appPath, true);

  try {
    await runCodePushCommand(appPath, platform, [
      "create-history",
      "-c", "code-push.config.local.ts",
      "-b", "1.0.0",
      "-p", platform,
      "-i", appName,
    ]);
    await runCodePushRelease(appPath, platform, appName, framework);
  } finally {
    setReleasingBundle(appPath, false);
  }
}

function runCodePushRelease(
  appPath: string,
  platform: "ios" | "android",
  appName: string,
  framework?: "expo",
): Promise<void> {
  const { frameworkArgs, entryFile } = getCodePushReleaseArgs(appPath, framework);
  return runCodePushCommand(appPath, platform, [
    "release",
    "-c", "code-push.config.local.ts",
    "-b", "1.0.0",
    "-v", "1.0.1",
    ...frameworkArgs,
    "-p", platform,
    "-i", appName,
    "-e", entryFile,
    "-m", "true",
  ]);
}

export function getCodePushReleaseArgs(appPath: string, framework?: "expo"): {
  frameworkArgs: string[];
  entryFile: string;
} {
  if (framework === "expo") {
    // Expo example app setup currently assumes an Expo Router template.
    // In that template, CodePush release should bundle from expo-router entry.
    return {
      frameworkArgs: ["-f", "expo"],
      entryFile: "node_modules/expo-router/entry.js",
    };
  }

  return {
    frameworkArgs: [],
    entryFile: resolveReactNativeEntryFile(appPath),
  };
}

function resolveReactNativeEntryFile(appPath: string): string {
  const indexJsPath = path.join(appPath, "index.js");
  if (fs.existsSync(indexJsPath)) {
    return "index.js";
  }

  const indexTsPath = path.join(appPath, "index.ts");
  if (fs.existsSync(indexTsPath)) {
    return "index.ts";
  }

  throw new Error(`Could not find React Native entry file in ${appPath} (expected index.js or index.ts)`);
}

export function runCodePushCommand(
  appPath: string,
  platform: "ios" | "android",
  args: string[],
): Promise<void> {
  const command = "npx";
  const commandArgs = ["code-push", ...args];
  const commandLabel = `npx ${commandArgs.join(" ")}`;

  console.log(`[command] ${commandLabel} (cwd: ${appPath})`);

  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
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
      else reject(new Error(`${commandLabel} failed (exit code: ${code})`));
    });
  });
}
