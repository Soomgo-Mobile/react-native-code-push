import path from "path";

export const MOCK_SERVER_PORT = 18081;
export const EXAMPLES_DIR = path.resolve(__dirname, "../Examples");
export const MOCK_DATA_DIR = path.resolve(__dirname, "mock-server/data");

export function getMockServerHost(platform: "ios" | "android"): string {
  const host = platform === "android"
    ? process.env.E2E_ANDROID_MOCK_SERVER_HOST ?? "10.0.2.2"
    : process.env.E2E_IOS_MOCK_SERVER_HOST ?? "localhost";
  return `http://${host}:${MOCK_SERVER_PORT}`;
}

export function getAppPath(appName: string): string {
  return path.join(EXAMPLES_DIR, appName);
}
