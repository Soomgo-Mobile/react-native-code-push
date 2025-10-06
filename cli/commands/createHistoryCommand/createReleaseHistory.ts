import fs from "fs";
import path from "path";
import type { CliConfigInterface, ReleaseHistoryInterface, ReleaseInfo } from "../../../typings/react-native-code-push.d.ts";

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
        const JSON_FILE_NAME = `${targetVersion}.json`;
        const JSON_FILE_PATH = path.resolve(process.cwd(), JSON_FILE_NAME);

        console.log(`log: creating JSON file... ("${JSON_FILE_NAME}")\n`, JSON.stringify(INITIAL_HISTORY, null, 2));
        fs.writeFileSync(JSON_FILE_PATH, JSON.stringify(INITIAL_HISTORY));

        await setReleaseHistory(targetVersion, JSON_FILE_PATH, INITIAL_HISTORY, platform, identifier)

        fs.unlinkSync(JSON_FILE_PATH);
    } catch (error) {
        console.error('Error occurred while creating new history:', error);
        process.exit(1)
    }
}
