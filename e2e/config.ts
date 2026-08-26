import os from "os";
import path from "path";

export const EXAMPLES_DIR = path.resolve(__dirname, "../Examples");

/**
 * Port the mock server of one platform listens on.
 *
 * Each platform serves its own artifacts, so a run that covers both needs a server each.
 * The port follows from the platform rather than being picked when the server starts,
 * because the app binary is built with the host it will ask.
 */
export function getMockServerPort(platform: "ios" | "android"): number {
  return platform === "ios" ? 18081 : 18082;
}

const MOCK_DATA_ROOT = path.resolve(__dirname, "mock-server/data");

/**
 * The data one platform's mock server serves.
 *
 * Scenarios empty this between releases, and the artifacts of the two platforms are told
 * apart by the same assertions either way, so each platform gets a root of its own rather
 * than a shared one that a scenario would have to empty piece by piece.
 */
export function getMockDataDir(platform: "ios" | "android"): string {
  return path.join(MOCK_DATA_ROOT, platform);
}

/**
 * Scratch directory for files a run builds but never serves, such as the JS bundle
 * extracted from the installed app binary.
 */
export const WORK_DIR = path.resolve(__dirname, ".work");

/**
 * Where the local CLI config records every artifact it stores. Kept outside the served
 * data directory so the record is not itself downloadable, and so wiping the mock data
 * between scenarios does not decide when the record is cleared.
 */
export function getArtifactLogPath(platform: "ios" | "android"): string {
  return path.join(WORK_DIR, `artifact-log-${platform}.jsonl`);
}

/**
 * Output root the CLI writes a platform's bundle and archives to, relative to the app.
 *
 * The bundle step empties this directory before it writes anything, so the two platforms
 * need roots of their own. It stays under `build`, which the example apps already ignore.
 */
export function getCliOutputPath(platform: "ios" | "android"): string {
  return path.join("build", platform);
}

/**
 * Temporary directory a platform's CLI invocations work in.
 *
 * The bundle step also clears `$TMPDIR/react-*`, which reaches every directory that
 * pattern matches rather than only its own, so the two platforms are pointed at temporary
 * directories of their own and that sweep stays inside the run that made it. Metro's cache
 * follows the same variable, which leaves each platform bundling out of a cache of its own.
 */
export function getCliTempDir(platform: "ios" | "android"): string {
  return path.join(os.tmpdir(), `codepush-e2e-${platform}`);
}

export function getMockServerHost(platform: "ios" | "android"): string {
  const host = platform === "android"
    ? process.env.E2E_ANDROID_MOCK_SERVER_HOST ?? "10.0.2.2"
    : process.env.E2E_IOS_MOCK_SERVER_HOST ?? "localhost";
  return `http://${host}:${getMockServerPort(platform)}`;
}

export function getAppPath(appName: string): string {
  return path.join(EXAMPLES_DIR, appName);
}

/** The app entry as the example app ships it, which a run reads but never writes. */
export function getAppSourceEntryPath(appPath: string): string {
  return path.join(appPath, "App.tsx");
}

/**
 * The app entry one platform's run rewrites.
 *
 * A run rewrites its entry once per release, so two platforms sharing `App.tsx` would
 * overwrite each other's markers. Metro resolves a platform extension ahead of the plain
 * name, so a file per platform gives each run an entry of its own, and leaves `App.tsx`
 * itself as the source every entry is patched from.
 */
export function getAppEntryPath(appPath: string, platform: "ios" | "android"): string {
  return path.join(appPath, `App.${platform}.tsx`);
}

/**
 * Directory holding the marker assets of one platform's releases.
 *
 * Both platforms write the same file for the same label, and a release clears its markers
 * by emptying the directory, so the runs need one directory each for neither to delete an
 * asset the other is about to bundle.
 *
 * The name avoids the `e2e-asset` prefix the marker files themselves carry. The asset
 * assertions match archive entries on the characters both platforms keep, and a directory
 * carrying that prefix would show up inside those entry names.
 */
export function getAssetMarkerDirName(platform: "ios" | "android"): string {
  return `e2e-marker-assets-${platform}`;
}
