import fs from "fs";
import path from "path";
import { getMockServerHost } from "../config";

const BACKUP_SUFFIX = ".e2e-backup";

export function prepareConfig(appPath: string, platform: "ios" | "android"): void {
  patchAppTsx(appPath, platform);
  copyLocalConfig(appPath);
}

export function restoreConfig(appPath: string): void {
  restoreFile(path.join(appPath, "App.tsx"));
  const localConfig = path.join(appPath, "code-push.config.local.ts");
  if (fs.existsSync(localConfig)) {
    fs.unlinkSync(localConfig);
  }
}

function patchAppTsx(appPath: string, platform: "ios" | "android"): void {
  const appTsxPath = path.join(appPath, "App.tsx");
  backupFile(appTsxPath);

  let content = fs.readFileSync(appTsxPath, "utf8");
  const host = getMockServerHost(platform);
  content = content.replace(
    /const CODEPUSH_HOST = '[^']*'/,
    `const CODEPUSH_HOST = '${host}'`,
  );
  content = content.replace(
    /const IS_RELEASING_BUNDLE = true/,
    "const IS_RELEASING_BUNDLE = false",
  );
  fs.writeFileSync(appTsxPath, content, "utf8");
  console.log(`App.tsx patched: CODEPUSH_HOST, IS_RELEASING_BUNDLE`);
}

function copyLocalConfig(appPath: string): void {
  const templatePath = path.resolve(__dirname, "../templates/code-push.config.local.ts");
  const destPath = path.join(appPath, "code-push.config.local.ts");
  fs.copyFileSync(templatePath, destPath);
  console.log("code-push.config.local.ts copied to app directory");
}

function backupFile(filePath: string): void {
  const backupPath = filePath + BACKUP_SUFFIX;
  fs.copyFileSync(filePath, backupPath);
}

function restoreFile(filePath: string): void {
  const backupPath = filePath + BACKUP_SUFFIX;
  if (fs.existsSync(backupPath)) {
    fs.copyFileSync(backupPath, filePath);
    fs.unlinkSync(backupPath);
  }
}
