import fs from "fs";
import path from "path";
import yauzl from "yauzl";
import { bundleCodePush } from "../bundleCommand/bundleCodePush.js";
import { addToReleaseHistory } from "./addToReleaseHistory.js";
import type { CliConfigInterface } from "../../../typings/react-native-code-push.d.ts";
import { generatePackageHashFromDirectory } from "../../utils/hash-utils.js";

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
    hashCalc?: boolean,
): Promise<void> {
    const bundleFileName = skipBundle
        ? readBundleFileNameFrom(bundleDirectory)
        : await bundleCodePush(framework, platform, outputPath, entryFile, jsBundleName, bundleDirectory);
    const bundleFilePath = `${bundleDirectory}/${bundleFileName}`;

    const packageHash = await (() => {
        if (skipBundle && hashCalc) {
            return calcHashFromBundleFile(bundleFilePath);
        }
        return bundleFileName;
    })();

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
        packageHash,
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

function calcHashFromBundleFile(bundleFilePath: string): Promise<string> {
    const tempDir = path.join(path.dirname(bundleFilePath), 'temp_contents_for_hash_calc');
    console.log('🔥 🔥 🔥 tempDir', tempDir);
    fs.mkdirSync(tempDir);

    // unzip
    yauzl.open(bundleFilePath, { lazyEntries: true }, (err, zipFile) => {
        if (err) throw err;
        zipFile.readEntry();
        zipFile.on("entry", (entry) => {
            if (/\/$/.test(entry.fileName)) {
                // Directory file names end with '/'.
                // Note that entries for directories themselves are optional.
                // An entry's fileName implicitly requires its parent directories to exist.
                zipFile.readEntry();
            } else {
                // file entry
                zipFile.openReadStream(entry, (err, readStream) => {
                    if (err) throw err;
                    readStream.on("end", () => {
                        zipFile.readEntry();
                    });
                    readStream.pipe(fs.createWriteStream(tempDir));
                });
            }
        });
    });

    // calc hash
    const hash = generatePackageHashFromDirectory(tempDir, path.join(tempDir, '..'));

    // cleanup
    fs.rmSync(tempDir, { recursive: true });

    console.log('🔥 🔥 🔥 hash', hash);

    return hash;
}
