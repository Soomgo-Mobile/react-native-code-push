import type { CliConfigInterface } from "../../../typings/react-native-code-push.d.ts";
import { stageReleaseHistoryFile } from "../../functions/stageReleaseHistoryFile.js";

export async function updateReleaseHistory(
    appVersion: string,
    binaryVersion: string,
    getReleaseHistory: CliConfigInterface['getReleaseHistory'],
    setReleaseHistory: CliConfigInterface['setReleaseHistory'],
    platform: 'ios' | 'android',
    identifier: string | undefined,
    mandatory: boolean | undefined,
    enable: boolean | undefined,
    rollout: number | undefined,
): Promise<void> {
    const releaseHistory = await getReleaseHistory(binaryVersion, platform, identifier);

    const updateInfo = releaseHistory[appVersion]
    if (!updateInfo) throw new Error(`v${appVersion} is not released`)

    if (typeof mandatory === "boolean") updateInfo.mandatory = mandatory;
    if (typeof enable === "boolean") updateInfo.enabled = enable;
    if (typeof rollout === "number") updateInfo.rollout = rollout;

    try {
        await stageReleaseHistoryFile(binaryVersion, releaseHistory, platform, (jsonFilePath) =>
            setReleaseHistory(binaryVersion, jsonFilePath, releaseHistory, platform, identifier));
    } catch (error) {
        console.error('Error occurred while updating history:', error);
        process.exit(1)
    }
}
