const fs = require('fs');
const path = require('path');

/**
 *
 * @param targetVersion {string}
 * @param setReleaseHistory {
 *   function(
 *     targetBinaryVersion: string,
 *     jsonFilePath: string,
 *     releaseInfo: ReleaseHistoryInterface,
 *     platform: string,
 *     identifier: string
 *   ): Promise<void>}
 * @param platform {"ios" | "android"}
 * @param identifier {string}
 * @returns {Promise<void>}
 */
async function createReleaseHistory(
    targetVersion,
    setReleaseHistory,
    platform,
    identifier,
) {
    const BINARY_RELEASE = {
        enabled: true,
        mandatory: false,
        downloadUrl: "",
        packageHash: "",
    };

    /** @type {ReleaseHistoryInterface} */
    const INITIAL_HISTORY = {
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

module.exports = { createReleaseHistory: createReleaseHistory }
