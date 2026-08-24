import crypto from "crypto";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { ARTIFACT_LOG_PATH, MOCK_DATA_DIR, getMockServerHost } from "../config";

/** An image asset the released bundle carries. Same label, byte-identical file. */
export interface AssetMarker {
  /** Names the asset file, so releases naming the same label share the asset. */
  label: string;
  /** Pads the image to this size, for an asset whose size has to decide something. */
  byteSize?: number;
}

interface PrepareBundleOptions {
  releaseVersion?: string;
  mandatory?: boolean;
  releaseMarkerVersion?: string;
  crashOnStartVersion?: string;
  /** Releases a binary patch against this JS bundle alongside the full bundle. */
  binaryBundlePath?: string;
  /** Adds image assets to the released bundle, so the update carries more than JS. */
  assetMarkers?: AssetMarker[];
  /** Skipped when the release should join the history that is already being served. */
  createHistory?: boolean;
}

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
const CRASH_ON_START_MARKER_PATTERN = /^if \(IS_RELEASING_BUNDLE\) \{ throw new Error\("E2E_CRASH_ON_START_.*"\); \}$/m;

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

export function setCrashOnStartMarker(appPath: string, version: string): void {
  const appTsxPath = path.join(appPath, "App.tsx");
  let content = fs.readFileSync(appTsxPath, "utf8");
  const marker = `if (IS_RELEASING_BUNDLE) { throw new Error("E2E_CRASH_ON_START_${version}"); }`;

  if (CRASH_ON_START_MARKER_PATTERN.test(content)) {
    content = content.replace(CRASH_ON_START_MARKER_PATTERN, marker);
  } else {
    const declarationPattern = /const IS_RELEASING_BUNDLE = (true|false);/;
    if (!declarationPattern.test(content)) {
      throw new Error(`Could not find IS_RELEASING_BUNDLE declaration in ${appTsxPath}`);
    }
    content = content.replace(declarationPattern, (declaration) => `${declaration}\n${marker}`);
  }

  fs.writeFileSync(appTsxPath, content, "utf8");
}

export function clearCrashOnStartMarker(appPath: string): void {
  const appTsxPath = path.join(appPath, "App.tsx");
  let content = fs.readFileSync(appTsxPath, "utf8");
  content = content.replace(CRASH_ON_START_MARKER_PATTERN, "").replace(/\n{3,}/g, "\n\n");
  fs.writeFileSync(appTsxPath, content, "utf8");
}

const ASSET_MARKER_PATTERN = /^global\.__E2E_ASSETS__ = \[.*\];$/m;
const ASSET_MARKER_FILE_PREFIX = "e2e-asset-";
// Smallest valid PNG, so Metro reads its dimensions and packs it like any other image.
const ASSET_MARKER_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/**
 * Adds image assets to the released bundle.
 *
 * An update is not only its JS bundle, and a binary patch only replaces the bundle: the
 * assets have to travel in the patch archive untouched for the restored contents to be
 * the update. Requiring the images is enough to put them in the update - Metro copies
 * every asset the module graph reaches, whether or not the app draws it.
 */
export function setAssetMarker(appPath: string, markers: AssetMarker[]): void {
  const requires = markers.map((marker) => {
    const assetFileName = `${ASSET_MARKER_FILE_PREFIX}${marker.label}.png`;
    fs.writeFileSync(path.join(appPath, assetFileName), assetMarkerPng(marker.label, marker.byteSize));
    return `require("./${assetFileName}")`;
  });

  const appTsxPath = path.join(appPath, "App.tsx");
  let content = fs.readFileSync(appTsxPath, "utf8");
  // Assigned to a global so that no minifier can decide the assets are unused.
  const marker = `global.__E2E_ASSETS__ = [${requires.join(", ")}];`;
  if (ASSET_MARKER_PATTERN.test(content)) {
    content = content.replace(ASSET_MARKER_PATTERN, marker);
  } else {
    content = `${marker}\n${content}`;
  }
  fs.writeFileSync(appTsxPath, content, "utf8");
}

/**
 * The marker image, padded to `byteSize` for an asset whose size matters.
 *
 * The padding sits after the IEND chunk, where image decoders stop reading, so Metro
 * still reads the 1x1 dimensions from the header. It is derived from the label alone,
 * because both of its uses need it reproducible: two releases only share the asset if
 * each writes the same bytes, and hash chains do not compress, so the padded size
 * survives into the zip archives whose sizes are compared when a diff is published.
 */
function assetMarkerPng(label: string, byteSize?: number): Buffer {
  const png = Buffer.from(ASSET_MARKER_PNG_BASE64, "base64");
  if (!byteSize || byteSize <= png.length) {
    return png;
  }

  const blocks: Buffer[] = [png];
  let length = png.length;
  let block = crypto.createHash("sha256").update(`${ASSET_MARKER_FILE_PREFIX}${label}`).digest();
  while (length < byteSize) {
    blocks.push(block);
    length += block.length;
    block = crypto.createHash("sha256").update(block).digest();
  }
  return Buffer.concat(blocks).subarray(0, byteSize);
}

export function clearAssetMarker(appPath: string): void {
  const appTsxPath = path.join(appPath, "App.tsx");
  let content = fs.readFileSync(appTsxPath, "utf8");
  content = content.replace(ASSET_MARKER_PATTERN, "").replace(/^\n+/, "");
  fs.writeFileSync(appTsxPath, content, "utf8");

  for (const fileName of fs.readdirSync(appPath)) {
    if (fileName.startsWith(ASSET_MARKER_FILE_PREFIX) && fileName.endsWith(".png")) {
      fs.rmSync(path.join(appPath, fileName), { force: true });
    }
  }
}

export async function prepareBundle(
  appPath: string,
  platform: "ios" | "android",
  appName: string,
  framework?: "expo",
  options: PrepareBundleOptions = {},
): Promise<void> {
  const releaseVersion = options.releaseVersion ?? "1.0.1";
  const mandatory = options.mandatory ?? true;
  const releaseMarkerVersion = options.releaseMarkerVersion;
  const crashOnStartVersion = options.crashOnStartVersion;
  const assetMarkers = options.assetMarkers;

  setReleasingBundle(appPath, true);

  try {
    if (releaseMarkerVersion) {
      setReleaseMarker(appPath, releaseMarkerVersion);
    }
    if (crashOnStartVersion) {
      setCrashOnStartMarker(appPath, crashOnStartVersion);
    }
    if (assetMarkers?.length) {
      setAssetMarker(appPath, assetMarkers);
    }

    if (options.createHistory ?? true) {
      await runCodePushCommand(appPath, platform, [
        "create-history",
        "-c", "code-push.config.local.ts",
        "-b", "1.0.0",
        "-p", platform,
        "-i", appName,
      ]);
    }
    await runCodePushRelease(
      appPath,
      platform,
      appName,
      releaseVersion,
      mandatory,
      framework,
      options.binaryBundlePath,
    );
  } finally {
    if (releaseMarkerVersion) {
      clearReleaseMarker(appPath);
    }
    if (crashOnStartVersion) {
      clearCrashOnStartMarker(appPath);
    }
    if (assetMarkers?.length) {
      clearAssetMarker(appPath);
    }
    setReleasingBundle(appPath, false);
  }
}

function runCodePushRelease(
  appPath: string,
  platform: "ios" | "android",
  appName: string,
  releaseVersion: string,
  mandatory: boolean,
  framework?: "expo",
  binaryBundlePath?: string,
): Promise<void> {
  const { frameworkArgs, entryFile } = getCodePushReleaseArgs(appPath, framework);
  return runCodePushCommand(appPath, platform, [
    "release",
    "-c", "code-push.config.local.ts",
    "-b", "1.0.0",
    "-v", releaseVersion,
    ...frameworkArgs,
    "-p", platform,
    "-i", appName,
    "-e", entryFile,
    "-m", mandatory ? "true" : "false",
    ...(binaryBundlePath ? ["--binary-bundle-path", binaryBundlePath] : []),
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
        E2E_ARTIFACT_LOG_PATH: ARTIFACT_LOG_PATH,
      },
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${commandLabel} failed (exit code: ${code})`));
    });
  });
}
