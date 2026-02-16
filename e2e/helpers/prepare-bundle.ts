import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { MOCK_DATA_DIR, getMockServerHost } from "../config";

export async function prepareBundle(
  appPath: string,
  platform: "ios" | "android",
  appName: string,
): Promise<void> {
  const appTsxPath = path.join(appPath, "App.tsx");

  // Temporarily set IS_RELEASING_BUNDLE = true
  let content = fs.readFileSync(appTsxPath, "utf8");
  content = content.replace(
    /const IS_RELEASING_BUNDLE = false/,
    "const IS_RELEASING_BUNDLE = true",
  );
  fs.writeFileSync(appTsxPath, content, "utf8");

  try {
    await runCodePushRelease(appPath, platform, appName);
  } finally {
    // Restore IS_RELEASING_BUNDLE = false
    content = fs.readFileSync(appTsxPath, "utf8");
    content = content.replace(
      /const IS_RELEASING_BUNDLE = true/,
      "const IS_RELEASING_BUNDLE = false",
    );
    fs.writeFileSync(appTsxPath, content, "utf8");
  }
}

function runCodePushRelease(
  appPath: string,
  platform: "ios" | "android",
  appName: string,
): Promise<void> {
  const args = [
    "code-push", "release",
    "-c", "code-push.config.local.ts",
    "-b", "1.0.0",
    "-v", "1.0.1",
    "-p", platform,
    "-i", appName,
    "-m", "true",
  ];

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
      else reject(new Error(`code-push release failed (exit code: ${code})`));
    });
  });
}