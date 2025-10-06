import path from "path";
import fs from "fs";
import type { CliConfigInterface } from "../../../typings/react-native-code-push.d.ts";

export async function addToReleaseHistory(
    appVersion: string,
    binaryVersion: string,
    bundleDownloadUrl: string,
    packageHash: string,
    getReleaseHistory: CliConfigInterface['getReleaseHistory'],
    setReleaseHistory: CliConfigInterface['setReleaseHistory'],
    platform: 'ios' | 'android',
    identifier: string | undefined,
    mandatory: boolean,
    enable: boolean,
    rollout: number | undefined,
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

    if (typeof rollout === 'number') {
        newReleaseHistory[appVersion].rollout = rollout;
    }

    try {
        const JSON_FILE_NAME = `${binaryVersion}.json`;
        const JSON_FILE_PATH = path.resolve(process.cwd(), JSON_FILE_NAME);

        console.log(`log: creating JSON file... ("${JSON_FILE_NAME}")\n`, JSON.stringify(newReleaseHistory, null, 2));
        fs.writeFileSync(JSON_FILE_PATH, JSON.stringify(newReleaseHistory));

        await setReleaseHistory(binaryVersion, JSON_FILE_PATH, newReleaseHistory, platform, identifier)

        fs.unlinkSync(JSON_FILE_PATH);
    } catch (error) {
        console.error('Error occurred while updating history:', error);
        process.exit(1)
    }
}
