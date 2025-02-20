import axios from "axios";
import {
  CliConfigInterface,
  ReleaseHistoryInterface,
} from "@bravemobile/react-native-code-push";
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
  fileName: string,
) {
  return `bundles/${platform}/${identifier}/${fileName}`;
}

const Config: CliConfigInterface = {
  bundleUploader: async (
    source: string,
    platform: "ios" | "android",
    identifier = "staging",
  ): Promise<{downloadUrl: string}> => {
    const fileName = source.split("/").pop();
    const remoteBundlePath = bundleFileRemotePath(
      platform,
      identifier,
      fileName!,
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
};

module.exports = Config;
