// @ts-nocheck
import {
  CliConfigInterface,
  ReleaseHistoryInterface,
} from "@bravemobile/react-native-code-push";
import * as fs from "fs";
import * as path from "path";

const MOCK_DATA_DIR = process.env.E2E_MOCK_DATA_DIR;
if (!MOCK_DATA_DIR) {
  throw new Error("E2E_MOCK_DATA_DIR environment variable is required");
}
const MOCK_SERVER_HOST = process.env.E2E_MOCK_SERVER_HOST;
if (!MOCK_SERVER_HOST) {
  throw new Error("E2E_MOCK_SERVER_HOST environment variable is required");
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

const Config: CliConfigInterface = {
  bundleUploader: async (
    source: string,
    platform: "ios" | "android",
    identifier = "staging",
  ): Promise<{ downloadUrl: string }> => {
    const fileName = path.basename(source);
    const destDir = path.join(MOCK_DATA_DIR, "bundles", platform, identifier);
    ensureDir(destDir);
    const destPath = path.join(destDir, fileName);
    fs.copyFileSync(source, destPath);

    const downloadUrl = `${MOCK_SERVER_HOST}/bundles/${platform}/${identifier}/${fileName}`;
    console.log("Bundle copied to:", destPath);
    console.log("Download URL:", downloadUrl);
    return { downloadUrl };
  },

  getReleaseHistory: async (
    targetBinaryVersion: string,
    platform: "ios" | "android",
    identifier = "staging",
  ): Promise<ReleaseHistoryInterface> => {
    const jsonPath = path.join(
      MOCK_DATA_DIR, "histories", platform, identifier, `${targetBinaryVersion}.json`,
    );
    if (!fs.existsSync(jsonPath)) {
      return {} as ReleaseHistoryInterface;
    }
    return JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  },

  setReleaseHistory: async (
    targetBinaryVersion: string,
    jsonFilePath: string,
    _releaseInfo: ReleaseHistoryInterface,
    platform: "ios" | "android",
    identifier = "staging",
  ): Promise<void> => {
    const destDir = path.join(MOCK_DATA_DIR, "histories", platform, identifier);
    ensureDir(destDir);
    const destPath = path.join(destDir, `${targetBinaryVersion}.json`);
    fs.copyFileSync(jsonFilePath, destPath);
    console.log("Release history saved to:", destPath);
  },
};

module.exports = Config;