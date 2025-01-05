const { bundleCodePush } = require("../bundleCommand/bundleCodePush");
const { addToReleaseHistory } = require("./addToReleaseHistory");

/**
 * @param bundleUploader {
 *   function(
 *       source: string,
 *       platform: "ios" | "android",
 *       identifier?: string
 *   ): Promise<{ downloadUrl: string }>}
 * @param getReleaseHistory {
 *   function(
 *     targetBinaryVersion: string,
 *     platform: "ios" | "android",
 *     identifier?: string
 *   ): Promise<ReleaseHistoryInterface>}
 * @param setReleaseHistory {
 *   function(
 *     targetBinaryVersion: string,
 *     jsonFilePath: string,
 *     releaseInfo: ReleaseHistoryInterface,
 *     platform: "ios" | "android",
 *     identifier?: string
 *   ): Promise<void>}
 * @param binaryVersion {string}
 * @param appVersion {string}
 * @param platform {"ios" | "android"}
 * @param identifier {string?}
 * @param outputPath {string}
 * @param entryFile {string}
 * @param jsBundleName {string}
 * @param mandatory {boolean}
 * @param enable {boolean}
 * @return {Promise<void>}
 */
async function release(
    bundleUploader,
    getReleaseHistory,
    setReleaseHistory,
    binaryVersion,
    appVersion,
    platform,
    identifier,
    outputPath,
    entryFile,
    jsBundleName,
    mandatory,
    enable,
) {
    const { bundleFileName, packageHash } = await bundleCodePush(
        platform,
        outputPath,
        entryFile,
        jsBundleName,
    );

    const downloadUrl = await (async () => {
        try {
            const { downloadUrl } = await bundleUploader(`./${bundleFileName}`, platform, identifier);
            return downloadUrl
        } catch (error) {
            console.error('Failed to upload the bundle file. Exiting the program.', error)
            process.exit(1)
        }
    })();

    await addToReleaseHistory(
        appVersion,
        binaryVersion,
        downloadUrl,
        packageHash,
        getReleaseHistory,
        setReleaseHistory,
        platform,
        identifier,
        mandatory,
        enable,
    )

    deleteUploadedBundleFile(bundleFileName);
}

function deleteUploadedBundleFile(bundleFileName) {
    const fs = require('fs');
    fs.unlinkSync(`./${bundleFileName}`);
}

module.exports = { release: release }
