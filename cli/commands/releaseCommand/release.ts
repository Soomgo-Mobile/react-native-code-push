import fs from "fs";
import path from "path";
import { bundleCodePush } from "../bundleCommand/bundleCodePush.js";
import { addToReleaseHistory } from "./addToReleaseHistory.js";
import type { CliConfigInterface } from "../../../typings/react-native-code-push.d.ts";

export async function release(
    bundleUploader: CliConfigInterface['bundleUploader'],
    getReleaseHistory: CliConfigInterface['getReleaseHistory'],
    setReleaseHistory: CliConfigInterface['setReleaseHistory'],
    binaryVersion: string,
    appVersion: string,
    framework: 'expo' | undefined,
    platform: 'ios' | 'android',
    identifier: string | undefined,
    outputPath: string,
    entryFile: string,
    jsBundleName: string,
    mandatory: boolean,
    enable: boolean,
    rollout: number | undefined,
    skipBundle: boolean,
    skipCleanup: boolean,
    bundleDirectory: string,
): Promise<void> {
    const bundleFileName = skipBundle
        ? readBundleFileNameFrom(bundleDirectory)
        : await bundleCodePush(framework, platform, outputPath, entryFile, jsBundleName, bundleDirectory);
    const bundleFilePath = `${bundleDirectory}/${bundleFileName}`;

    const downloadUrl = await (async () => {
        try {
            const { downloadUrl } = await bundleUploader(bundleFilePath, platform, identifier);
            return downloadUrl
        } catch (error) {
            console.error('Failed to upload the bundle file. Exiting the program.\n', error)
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

function cleanUpOutputs(dir: string) {
    fs.rmSync(dir, { recursive: true });
}

function readBundleFileNameFrom(bundleDirectory: string): string {
    const files = fs.readdirSync(bundleDirectory);
    if (files.length !== 1) {
        console.error('The bundlePath must contain only one file.');
        process.exit(1);
    }
    const bundleFilePath = path.join(bundleDirectory, files[0]);
    return path.basename(bundleFilePath);
}
