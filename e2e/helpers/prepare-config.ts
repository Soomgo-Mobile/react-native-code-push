import fs from "fs";
import path from "path";
import { getMockServerHost } from "../config";

const BACKUP_SUFFIX = ".e2e-backup";
const RESUME_SYNC_BUTTON_TITLE = "Sync ON_NEXT_RESUME (20s)";
const SUSPEND_SYNC_BUTTON_TITLE = "Sync ON_NEXT_SUSPEND (20s)";
const RETRY_FAILED_SYNC_BUTTON_TITLE = "Sync retry failed update";
const HANDLE_SYNC_PATTERN = /const handleSync = useCallback\(\(\) => \{\n[\s\S]*?\n {2}\}, \[\]\);/;
const DEFAULT_SYNC_BUTTON_PATTERN = /^(\s*)<Button title="Check for updates" onPress={handleSync} \/>$/m;

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
  content = replaceOrThrow(
    content,
    /const CODEPUSH_HOST = '[^']*'/,
    `const CODEPUSH_HOST = '${host}'`,
  );
  content = replaceOrThrow(
    content,
    /const IS_RELEASING_BUNDLE = (true|false)/,
    "const IS_RELEASING_BUNDLE = false",
  );
  content = injectResumeSyncSupport(content);
  fs.writeFileSync(appTsxPath, content, "utf8");
  console.log("App.tsx patched: CODEPUSH_HOST, IS_RELEASING_BUNDLE, E2E sync option buttons");
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

function replaceOrThrow(
  content: string,
  pattern: RegExp,
  replacement: string,
): string {
  if (!pattern.test(content)) {
    throw new Error(`Could not patch App.tsx with pattern: ${pattern.toString()}`);
  }
  return content.replace(pattern, replacement);
}

function injectResumeSyncSupport(content: string): string {
  if (
    content.includes(RESUME_SYNC_BUTTON_TITLE)
    && content.includes(SUSPEND_SYNC_BUTTON_TITLE)
    && content.includes(RETRY_FAILED_SYNC_BUTTON_TITLE)
  ) {
    return content;
  }

  const e2eSyncHandlers = [
    "  const handleSyncOnNextResume = useCallback(() => {",
    "    CodePush.sync(",
    "      {",
    "        installMode: CodePush.InstallMode.ON_NEXT_RESUME,",
    "        mandatoryInstallMode: CodePush.InstallMode.ON_NEXT_RESUME,",
    "        minimumBackgroundDuration: 20,",
    "      },",
    "      status => {",
    "        setSyncResult(findKeyByValue(CodePush.SyncStatus, status) ?? '');",
    "      },",
    "      ({ receivedBytes, totalBytes }) => {",
    "        setProgress(Math.round((receivedBytes / totalBytes) * 100));",
    "      },",
    "      mismatch => {",
    "        console.log('CodePush mismatch', JSON.stringify(mismatch, null, 2));",
    "      },",
    "    ).catch(error => {",
    "      console.error(error);",
    "      console.log('Sync failed', error.message ?? 'Unknown error');",
    "    });",
    "  }, []);",
    "",
    "  const handleSyncOnNextSuspend = useCallback(() => {",
    "    CodePush.sync(",
    "      {",
    "        installMode: CodePush.InstallMode.ON_NEXT_SUSPEND,",
    "        mandatoryInstallMode: CodePush.InstallMode.ON_NEXT_SUSPEND,",
    "        minimumBackgroundDuration: 20,",
    "      },",
    "      status => {",
    "        setSyncResult(findKeyByValue(CodePush.SyncStatus, status) ?? '');",
    "      },",
    "      ({ receivedBytes, totalBytes }) => {",
    "        setProgress(Math.round((receivedBytes / totalBytes) * 100));",
    "      },",
    "      mismatch => {",
    "        console.log('CodePush mismatch', JSON.stringify(mismatch, null, 2));",
    "      },",
    "    ).catch(error => {",
    "      console.error(error);",
    "      console.log('Sync failed', error.message ?? 'Unknown error');",
    "    });",
    "  }, []);",
    "",
    "  const handleSyncRetryFailedUpdate = useCallback(() => {",
    "    CodePush.sync(",
    "      {",
    "        ignoreFailedUpdates: false,",
    "      },",
    "      status => {",
    "        setSyncResult(findKeyByValue(CodePush.SyncStatus, status) ?? '');",
    "      },",
    "      ({ receivedBytes, totalBytes }) => {",
    "        setProgress(Math.round((receivedBytes / totalBytes) * 100));",
    "      },",
    "      mismatch => {",
    "        console.log('CodePush mismatch', JSON.stringify(mismatch, null, 2));",
    "      },",
    "    ).catch(error => {",
    "      console.error(error);",
    "      console.log('Sync failed', error.message ?? 'Unknown error');",
    "    });",
    "  }, []);",
  ].join("\n");

  let handlerInserted = false;
  content = content.replace(HANDLE_SYNC_PATTERN, (match: string) => {
    handlerInserted = true;
    return `${match}\n\n${e2eSyncHandlers}`;
  });

  if (!handlerInserted) {
    throw new Error("Could not inject E2E sync handlers into App.tsx");
  }

  let buttonInserted = false;
  content = content.replace(DEFAULT_SYNC_BUTTON_PATTERN, (_match: string, indent: string) => {
    buttonInserted = true;
    return [
      `${indent}<Button title="Check for updates" onPress={handleSync} />`,
      `${indent}<Button title="${RESUME_SYNC_BUTTON_TITLE}" onPress={handleSyncOnNextResume} />`,
      `${indent}<Button title="${SUSPEND_SYNC_BUTTON_TITLE}" onPress={handleSyncOnNextSuspend} />`,
      `${indent}<Button title="${RETRY_FAILED_SYNC_BUTTON_TITLE}" onPress={handleSyncRetryFailedUpdate} />`,
    ].join("\n");
  });

  if (!buttonInserted) {
    throw new Error("Could not inject E2E sync option buttons into App.tsx");
  }

  return content;
}
