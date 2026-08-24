// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- This template has environment-specific dependencies.
// @ts-nocheck
import {
  type BundleUploadArtifact,
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

// Optional: when set, every stored artifact is appended here as one JSON object per
// line, so the runner can assert where the CLI asked for its artifacts to be stored
// instead of re-deriving the paths it expects.
const ARTIFACT_LOG_PATH = process.env.E2E_ARTIFACT_LOG_PATH;

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function recordArtifact(entry: Record<string, unknown>) {
  if (!ARTIFACT_LOG_PATH) {
    return;
  }
  ensureDir(path.dirname(ARTIFACT_LOG_PATH));
  fs.appendFileSync(ARTIFACT_LOG_PATH, `${JSON.stringify(entry)}\n`);
}

function bundleFileRemotePath(
  platform: "ios" | "android",
  identifier: string,
  artifact: BundleUploadArtifact,
) {
  if (artifact.type === "full-bundle") {
    return `bundles/${platform}/${identifier}/full-bundle/${artifact.packageHash}`;
  }

  const artifactPath = artifact.type === "asset-diff"
    ? `asset-diff/${artifact.targetBinaryVersion}/${artifact.packageHash}/${artifact.basePackageHash}`
    : `binary-patch/${artifact.targetBinaryVersion}/${artifact.packageHash}`;

  return `bundles/${platform}/${identifier}/${artifactPath}`;
}

const Config: CliConfigInterface = {
  bundleUploader: async (
    source: string,
    platform: "ios" | "android",
    identifier = "staging",
    artifact,
  ): Promise<{ downloadUrl: string }> => {
    if (artifact === undefined) {
      throw new Error("The release command did not provide bundle artifact metadata.");
    }

    const remotePath = bundleFileRemotePath(platform, identifier, artifact);
    const destPath = path.join(MOCK_DATA_DIR, remotePath);
    const destDir = path.dirname(destPath);
    ensureDir(destDir);
    fs.copyFileSync(source, destPath);

    const downloadUrl = `${MOCK_SERVER_HOST}/${remotePath}`;
    console.log("Bundle copied to:", destPath);
    console.log("Download URL:", downloadUrl);
    recordArtifact({
      kind: "bundle",
      platform,
      identifier,
      artifactType: artifact.type,
      targetBinaryVersion: artifact.targetBinaryVersion,
      packageHash: artifact.packageHash,
      ...(artifact.type === "asset-diff" ? { basePackageHash: artifact.basePackageHash } : {}),
      storedPath: path.relative(MOCK_DATA_DIR, destPath),
      downloadUrl,
    });
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
    recordArtifact({
      kind: "history",
      platform,
      identifier,
      binaryVersion: targetBinaryVersion,
      storedPath: path.relative(MOCK_DATA_DIR, destPath),
    });
  },
};

module.exports = Config;
