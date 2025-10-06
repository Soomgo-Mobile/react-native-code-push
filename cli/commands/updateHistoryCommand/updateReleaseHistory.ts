import fs from "fs";
import path from "path";
import type { CliConfigInterface } from "../../../typings/react-native-code-push.d.ts";

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
        const JSON_FILE_NAME = `${binaryVersion}.json`;
        const JSON_FILE_PATH = path.resolve(process.cwd(), JSON_FILE_NAME);

        console.log(`log: creating JSON file... ("${JSON_FILE_NAME}")\n`, JSON.stringify(releaseHistory, null, 2));
        fs.writeFileSync(JSON_FILE_PATH, JSON.stringify(releaseHistory));

        await setReleaseHistory(binaryVersion, JSON_FILE_PATH, releaseHistory, platform, identifier)

        fs.unlinkSync(JSON_FILE_PATH);
    } catch (error) {
        console.error('Error occurred while updating history:', error);
        process.exit(1)
    }
}
