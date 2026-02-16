import fs from "fs";
import path from "path";
import { getMockServerHost } from "../config";

const BACKUP_SUFFIX = ".e2e-backup";

export function prepareConfig(appPath: string, platform: "ios" | "android"): void {
  patchAppTsx(appPath, platform);
  copyLocalConfig(appPath);
  if (platform === "android") {
    patchAndroidManifest(appPath);
  }
}

export function restoreConfig(appPath: string): void {
  restoreFile(path.join(appPath, "App.tsx"));
  restoreFile(getAndroidManifestPath(appPath));
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
  content = content.replace(
    /CodePush\.sync\(\s*\{\s*updateDialog:\s*true\s*\}/,
    "CodePush.sync({}",
  );
  content = content.replace(/Alert\.alert\(/g, "console.log(");
  // Replace TextInput with Text in MetadataBlock so Maestro can read the content
  content = content.replace(
    /<TextInput\s+value=\{String\(value\)\}\s+multiline\s+style=\{[^}]+\}\s*\/>/,
    "<Text style={{ borderWidth: 1, borderRadius: 4, padding: 8, minHeight: 60, color: 'black' }}>{String(value)}</Text>",
  );
  fs.writeFileSync(appTsxPath, content, "utf8");
  console.log(`App.tsx patched: CODEPUSH_HOST, updateDialog, Alert.alert, MetadataBlock`);
}

function copyLocalConfig(appPath: string): void {
  const templatePath = path.resolve(__dirname, "../templates/code-push.config.local.ts");
  const destPath = path.join(appPath, "code-push.config.local.ts");
  fs.copyFileSync(templatePath, destPath);
  console.log("code-push.config.local.ts copied to app directory");
}

function getAndroidManifestPath(appPath: string): string {
  return path.join(appPath, "android", "app", "src", "main", "AndroidManifest.xml");
}

function patchAndroidManifest(appPath: string): void {
  const manifestPath = getAndroidManifestPath(appPath);
  if (!fs.existsSync(manifestPath)) {
    return;
  }
  backupFile(manifestPath);

  let content = fs.readFileSync(manifestPath, "utf8");
  content = content.replace(
    /android:usesCleartextTraffic="\$\{usesCleartextTraffic\}"/,
    'android:usesCleartextTraffic="true"',
  );
  fs.writeFileSync(manifestPath, content, "utf8");
  console.log("AndroidManifest.xml usesCleartextTraffic set to true");
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