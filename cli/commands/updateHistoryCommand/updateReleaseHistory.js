const fs = require('fs');
const path = require('path');

/**
 *
 * @param appVersion {string}
 * @param binaryVersion {string}
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
 * @param rollout {number?}
 * @returns {Promise<void>}
 */
async function updateReleaseHistory(
    appVersion,
    binaryVersion,
    getReleaseHistory,
    setReleaseHistory,
    platform,
    identifier,
    mandatory,
    enable,
    rollout
) {
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

module.exports = { updateReleaseHistory: updateReleaseHistory }
