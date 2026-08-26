import type { CliConfigInterface } from "../../../typings/react-native-code-push.d.ts";
import { stageReleaseHistoryFile } from "../../functions/stageReleaseHistoryFile.js";

export async function addToReleaseHistory(
    appVersion: string,
    binaryVersion: string,
    bundleDownloadUrl: string,
    binaryPatchDownloadUrl: string | undefined,
    packageHash: string,
    getReleaseHistory: CliConfigInterface['getReleaseHistory'],
    setReleaseHistory: CliConfigInterface['setReleaseHistory'],
    platform: 'ios' | 'android',
    identifier: string | undefined,
    mandatory: boolean,
    enable: boolean,
    rollout: number | undefined,
    diffPackages: Record<string, string> | undefined,
): Promise<void> {
    const releaseHistory = await getReleaseHistory(binaryVersion, platform, identifier);

    const updateInfo = releaseHistory[appVersion]
    if (updateInfo) {
        console.error(`v${appVersion} is already released`)
        process.exit(1)
    }

    const newReleaseHistory = structuredClone(releaseHistory);

    newReleaseHistory[appVersion] = {
        enabled: enable,
        mandatory: mandatory,
        downloadUrl: bundleDownloadUrl,
        packageHash: packageHash,
    };

    // A release without a binary patch says nothing about one, so that a client reading
    // this history downloads the full bundle exactly as it did before patches existed.
    if (binaryPatchDownloadUrl) {
        newReleaseHistory[appVersion].binaryPatchDownloadUrl = binaryPatchDownloadUrl;
    }

    // Same for the asset diffs: an entry only names the bases it actually published a
    // diff archive for.
    if (diffPackages && Object.keys(diffPackages).length > 0) {
        newReleaseHistory[appVersion].diffPackages = diffPackages;
    }

    if (typeof rollout === 'number') {
        newReleaseHistory[appVersion].rollout = rollout;
    }

    try {
        await stageReleaseHistoryFile(binaryVersion, newReleaseHistory, platform, (jsonFilePath) =>
            setReleaseHistory(binaryVersion, jsonFilePath, newReleaseHistory, platform, identifier));
    } catch (error) {
        console.error('Error occurred while updating history:', error);
        process.exit(1)
    }
}
