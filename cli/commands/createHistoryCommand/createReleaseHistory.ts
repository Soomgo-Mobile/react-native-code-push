import type { CliConfigInterface, ReleaseHistoryInterface, ReleaseInfo } from "../../../typings/react-native-code-push.d.ts";
import { stageReleaseHistoryFile } from "../../functions/stageReleaseHistoryFile.js";

export async function createReleaseHistory(
    targetVersion: string,
    setReleaseHistory: CliConfigInterface['setReleaseHistory'],
    platform: 'ios' | 'android',
    identifier?: string,
): Promise<void> {
    const BINARY_RELEASE: ReleaseInfo = {
        enabled: true,
        mandatory: false,
        downloadUrl: "",
        packageHash: "",
    };

    const INITIAL_HISTORY: ReleaseHistoryInterface = {
        [targetVersion]: BINARY_RELEASE
    };

    try {
        await stageReleaseHistoryFile(targetVersion, INITIAL_HISTORY, platform, (jsonFilePath) =>
            setReleaseHistory(targetVersion, jsonFilePath, INITIAL_HISTORY, platform, identifier));
    } catch (error) {
        console.error('Error occurred while creating new history:', error);
        process.exit(1)
    }
}
