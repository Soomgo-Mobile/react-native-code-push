const fs = require('fs');
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
 * @param framework {string|undefined} 'expo'
 * @param platform {"ios" | "android"}
 * @param identifier {string?}
 * @param outputPath {string}
 * @param entryFile {string}
 * @param jsBundleName {string}
 * @param mandatory {boolean}
 * @param enable {boolean}
 * @param rollout {number}
 * @param skipBundle {boolean}
 * @param skipCleanup {boolean}
 * @param bundleDirectory {string}
 * @return {Promise<void>}
 */
async function release(
    bundleUploader,
    getReleaseHistory,
    setReleaseHistory,
    binaryVersion,
    appVersion,
    framework,
    platform,
    identifier,
    outputPath,
    entryFile,
    jsBundleName,
    mandatory,
    enable,
    rollout,
    skipBundle,
    skipCleanup,
    bundleDirectory,
) {
    const bundleFileName = skipBundle
        ? readBundleFileNameFrom(bundleDirectory)
        : await bundleCodePush(framework, platform, outputPath, entryFile, jsBundleName, bundleDirectory);
    const bundleFilePath = `${bundleDirectory}/${bundleFileName}`;

    const downloadUrl = await (async () => {
        try {
            const { downloadUrl } = await bundleUploader(bundleFilePath, platform, identifier);
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
        bundleFileName,
        getReleaseHistory,
        setReleaseHistory,
        platform,
        identifier,
        mandatory,
        enable,
        rollout,
    )

    if (!skipCleanup) {
        cleanUpOutputs(outputPath);
    }
}

function cleanUpOutputs(dir) {
    fs.rmSync(dir, { recursive: true });
}

/**
 * @param bundleDirectory {string}
 * @return {string}
 */
function readBundleFileNameFrom(bundleDirectory) {
    const files = fs.readdirSync(bundleDirectory);
    if (files.length !== 1) {
        console.error('The bundlePath must contain only one file.');
        process.exit(1);
    }
    const path = require('path');
    const bundleFilePath = path.join(bundleDirectory, files[0]);
    return path.basename(bundleFilePath);
}

module.exports = { release: release }
