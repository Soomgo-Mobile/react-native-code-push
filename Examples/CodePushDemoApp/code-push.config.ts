import axios from "axios";
import os from "os";
import path from "path";
import {
  type BundleDownloadInfo,
  type BundleUploadArtifact,
  CliConfigInterface,
  ReleaseHistoryInterface,
} from "@bravemobile/react-native-code-push";
import {downloadFileFromS3} from "./scripts/downloadFileFromS3";
import {invalidateCloudfrontCache} from "./scripts/invalidateCloudfrontCache";
import {uploadFileToS3} from "./scripts/uploadFileToS3";

export const CDN_HOST = "https://your.cdn.provider.com";

function historyJsonFileRemotePath(
  platform: "ios" | "android",
  identifier: string,
  binaryVersion: string,
) {
  return `histories/${platform}/${identifier}/${binaryVersion}.json`;
}

function bundleFileRemotePath(
  platform: "ios" | "android",
  identifier: string,
  artifact: BundleUploadArtifact,
) {
  if (artifact.type === "full-bundle") {
    // A package hash identifies full bundle contents across target binary versions.
    return fullBundleRemotePath(platform, identifier, artifact.packageHash);
  }

  const artifactPath = artifact.type === "asset-diff"
    ? `asset-diff/${artifact.targetBinaryVersion}/${artifact.packageHash}/${artifact.basePackageHash}`
    : `binary-patch/${artifact.targetBinaryVersion}/${artifact.packageHash}`;

  return `bundles/${platform}/${identifier}/${artifactPath}`;
}

function fullBundleRemotePath(
  platform: "ios" | "android",
  identifier: string,
  packageHash: string,
) {
  return `bundles/${platform}/${identifier}/full-bundle/${packageHash}`;
}

const Config: CliConfigInterface = {
  bundleUploader: async (
    source: string,
    platform: "ios" | "android",
    identifier = "staging",
    artifact,
  ): Promise<{downloadUrl: string}> => {
    if (artifact === undefined) {
      throw new Error("The release command did not provide bundle artifact metadata.");
    }

    const remoteBundlePath = bundleFileRemotePath(
      platform,
      identifier,
      artifact,
    );

    await uploadFileToS3({
      pathToLocalFile: source,
      key: remoteBundlePath,
    });

    const downloadUrl = `${CDN_HOST}/${remoteBundlePath}`;

    console.log("🎉 Bundle File uploaded:", downloadUrl);

    return {
      downloadUrl: downloadUrl,
    };
  },

  getReleaseHistory: async (
    targetBinaryVersion: string,
    platform: "ios" | "android",
    identifier = "staging",
  ): Promise<ReleaseHistoryInterface> => {
    const remoteJsonPath = historyJsonFileRemotePath(
      platform,
      identifier,
      targetBinaryVersion,
    );

    const jsonUrl = `${CDN_HOST}/${remoteJsonPath}`;

    try {
      const {data} = await axios.get(jsonUrl);
      return data as ReleaseHistoryInterface;
    } catch (error) {
      if (
        axios.isAxiosError(error) &&
        error.response != null &&
        [403, 404].includes(error.response.status)
      ) {
        console.error("Release history file not found at", jsonUrl);
      }
      throw error;
    }
  },

  setReleaseHistory: async (
    targetBinaryVersion: string,
    jsonFilePath: string,
    releaseInfo: ReleaseHistoryInterface,
    platform: "ios" | "android",
    identifier = "staging",
  ): Promise<void> => {
    // upload JSON file or call API using `releaseInfo` metadata.

    const remoteJsonPath = historyJsonFileRemotePath(
      platform,
      identifier,
      targetBinaryVersion,
    );

    await uploadFileToS3({
      pathToLocalFile: jsonFilePath,
      key: remoteJsonPath,
    });

    await invalidateCloudfrontCache({
      key: remoteJsonPath,
    });

    const jsonUrl = `${CDN_HOST}/${remoteJsonPath}`;

    console.log("🎉 Release history File uploaded:", jsonUrl);
  },

  bundleDownloader: async (
    archive: BundleDownloadInfo,
    platform: "ios" | "android",
    identifier = "staging",
  ): Promise<{downloadedFilePath: string}> => {
    const key = fullBundleRemotePath(
      platform,
      identifier,
      archive.packageHash,
    );
    const downloadedFilePath = path.join(
      os.tmpdir(),
      `codepush-${archive.releaseVersion}-${archive.packageHash}`,
    );

    await downloadFileFromS3({
      pathToLocalFile: downloadedFilePath,
      key,
    });

    return {downloadedFilePath};
  },
};

module.exports = Config;
