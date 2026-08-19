import path from "path";

export const MOCK_SERVER_PORT = 18081;
export const EXAMPLES_DIR = path.resolve(__dirname, "../Examples");
export const MOCK_DATA_DIR = path.resolve(__dirname, "mock-server/data");

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
export const ARTIFACT_LOG_PATH = path.join(WORK_DIR, "artifact-log.jsonl");

export function getMockServerHost(platform: "ios" | "android"): string {
  const host = platform === "android"
    ? process.env.E2E_ANDROID_MOCK_SERVER_HOST ?? "10.0.2.2"
    : process.env.E2E_IOS_MOCK_SERVER_HOST ?? "localhost";
  return `http://${host}:${MOCK_SERVER_PORT}`;
}

export function getAppPath(appName: string): string {
  return path.join(EXAMPLES_DIR, appName);
}
