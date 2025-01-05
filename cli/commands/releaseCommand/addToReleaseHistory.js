const path = require("path");
const fs = require("fs");

/**
 *
 * @param appVersion {string}
 * @param binaryVersion {string}
 * @param bundleDownloadUrl {string}
 * @param packageHash {string}
 * @param getReleaseHistory {
 *   function(
 *     targetBinaryVersion: string,
 *     platform: string,
 *     identifier?: string
 *   ): Promise<ReleaseHistoryInterface>}
 * @param setReleaseHistory {
 *   function(
 *     targetBinaryVersion: string,
 *     jsonFilePath: string,
 *     releaseInfo: ReleaseHistoryInterface,
 *     platform: string,
 *     identifier?: string
 *   ): Promise<void>}
 * @param platform {"ios" | "android"}
 * @param identifier {string?}
 * @param mandatory {boolean?}
 * @param enable {boolean?}
 * @returns {Promise<void>}
 */
async function addToReleaseHistory(
    appVersion,
    binaryVersion,
    bundleDownloadUrl,
    packageHash,
    getReleaseHistory,
    setReleaseHistory,
    platform,
    identifier,
    mandatory,
    enable,
) {
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

module.exports = { addToReleaseHistory: addToReleaseHistory }
