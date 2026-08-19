import fs from "fs";
import path from "path";
import { bundleCodePush, resolveJsBundleName } from "../bundleCommand/bundleCodePush.js";
import { addToReleaseHistory } from "./addToReleaseHistory.js";
import type { CliConfigInterface } from "../../../typings/react-native-code-push.d.ts";
import { generatePackageHashFromDirectory } from "../../utils/hash-utils.js";
import { unzip } from "../../utils/unzip.js";
import {
    BINARY_PATCH_ARCHIVE_SUFFIX,
    BINARY_PATCH_BASE_RECORD_NAME,
    DEFAULT_OVERSIZED_PATCH_POLICY,
    extractCodePushBundleContents,
    formatBinaryPatchSummary,
    hashBundleFile,
    isPatchArchiveOversized,
    makeBinaryPatchBundle,
    readBinaryPatchBaseRecord,
    type BinaryPatchBaseRecord,
    type BinaryPatchBundle,
    type OversizedPatchPolicy,
} from "../../functions/makeBinaryPatchBundle.js";

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
    jsBundleName: string | undefined,
    mandatory: boolean,
    enable: boolean,
    rollout: number | undefined,
    skipBundle: boolean,
    skipCleanup: boolean,
    bundleDirectory: string,
    outputMetroDir?: string,
    hashCalc?: boolean,
    baseBundlePath?: string,
    onOversizedPatch: OversizedPatchPolicy = DEFAULT_OVERSIZED_PATCH_POLICY,
): Promise<void> {
    if (baseBundlePath) {
        // Checked before the bundler runs, so the wrong base bundle costs a second rather
        // than a full build.
        verifyExportedBaseBundleRecord(baseBundlePath, binaryVersion);
    }

    const codePushBundle = skipBundle
        ? null
        : await bundleCodePush(framework, platform, outputPath, entryFile, jsBundleName, bundleDirectory, outputMetroDir, baseBundlePath);
    const bundleFileName = codePushBundle?.bundleFileName ?? readBundleFileNameFrom(bundleDirectory);
    const bundleFilePath = `${bundleDirectory}/${bundleFileName}`;

    const packageHash = await (() => {
        if (skipBundle && hashCalc) {
            return calcHashFromBundleFile(bundleFilePath);
        }
        // If not using --skip-bundle, the bundleFileName represents package hash already.
        return bundleFileName;
    })();

    const binaryPatch = baseBundlePath
        ? await makeBinaryPatchArtifact({
            baseBundlePath,
            contentsPath: codePushBundle?.contentsPath,
            bundleFilePath,
            jsBundleName: codePushBundle?.jsBundleName ?? resolveJsBundleName(platform, jsBundleName),
            bundleDirectory,
            packageHash,
            outputPath,
            platform,
            onOversizedPatch,
        })
        : null;

    // Every artifact is uploaded before the release history is touched, so a failed
    // upload leaves the history describing only updates that can actually be downloaded.
    const downloadUrl = await uploadArtifact(bundleUploader, bundleFilePath, platform, identifier, 'bundle');
    let patchDownloadUrl: string | undefined;
    if (binaryPatch) {
        patchDownloadUrl = await uploadArtifact(bundleUploader, binaryPatch.patchBundleFilePath, platform, identifier, 'binary patch bundle');
        console.log(`log: Binary patch archive uploaded (download url: ${patchDownloadUrl})`);
    }

    await addToReleaseHistory(
        appVersion,
        binaryVersion,
        downloadUrl,
        patchDownloadUrl,
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
    // A previous release of the same bundle may have left its patch archive here, and
    // that archive is derived from the bundle file rather than a candidate for release.
    const files = fs.readdirSync(bundleDirectory).filter((file) => !file.endsWith(BINARY_PATCH_ARCHIVE_SUFFIX));
    if (files.length !== 1) {
        console.error('The bundlePath must contain only one file.');
        process.exit(1);
    }
    const bundleFilePath = path.join(bundleDirectory, files[0]);
    return path.basename(bundleFilePath);
}

async function calcHashFromBundleFile(bundleFilePath: string): Promise<string> {
    const tempDir = path.resolve(path.join(path.dirname(bundleFilePath), 'temp_contents_for_hash_calc'));
    const zipFilePath = path.resolve(bundleFilePath);

    if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tempDir, { recursive: true });

    try {
        await unzip(zipFilePath, tempDir);
        const hash = await generatePackageHashFromDirectory(tempDir, tempDir);
        console.log(`log: Calculated package hash from existing bundle file: ${hash}`);
        return hash;
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

/**
 * Builds the binary patch artifact of this release and reports what it saves, before
 * anything is uploaded.
 *
 * A patch that is not smaller than the full archive is not worth publishing, and the
 * CLI cannot ask: it runs unattended. `onOversizedPatch` decides instead - `skip`
 * releases the full bundle alone, `fail` stops the release while nothing has been
 * uploaded yet.
 *
 * @param contentsPath {string | undefined} Update contents of a bundle that was just built. Absent with `--skip-bundle`, where the bundle file being released is unpacked instead, so the patch describes exactly the bytes that go out.
 * @return {Promise<BinaryPatchBundle | null>} The artifact to upload, or `null` when the patch was skipped.
 */
async function makeBinaryPatchArtifact({
    baseBundlePath,
    contentsPath,
    bundleFilePath,
    jsBundleName,
    bundleDirectory,
    packageHash,
    outputPath,
    platform,
    onOversizedPatch,
}: {
    baseBundlePath: string;
    contentsPath: string | undefined;
    bundleFilePath: string;
    jsBundleName: string;
    bundleDirectory: string;
    packageHash: string;
    outputPath: string;
    platform: 'ios' | 'android';
    onOversizedPatch: OversizedPatchPolicy;
}): Promise<BinaryPatchBundle | null> {
    warnOnBaseBundleMismatch(outputPath, baseBundlePath);

    let patchContentsPath = contentsPath;
    let extractDir: string | null = null;
    if (patchContentsPath === undefined) {
        const extracted = await extractCodePushBundleContents(bundleFilePath, outputPath);
        patchContentsPath = extracted.contentsPath;
        extractDir = extracted.extractDir;
    }

    try {
        const binaryPatch = await makeBinaryPatchBundle({
            contentsPath: patchContentsPath,
            baseBundlePath,
            bundleRelativePath: jsBundleName,
            bundleDirectory,
            packageHash,
        });

        const fullArchiveSize = fs.statSync(bundleFilePath).size;
        const patchArchiveSize = fs.statSync(binaryPatch.patchBundleFilePath).size;
        const oversized = isPatchArchiveOversized(fullArchiveSize, patchArchiveSize);

        console.log(formatBinaryPatchSummary({
            platform,
            baseBundleHash: binaryPatch.manifest.baseBundleHash,
            targetBundleHash: binaryPatch.manifest.targetBundleHash,
            fullArchiveSize,
            patchArchiveSize,
            patchSkipped: oversized && onOversizedPatch === 'skip',
        }));

        if (oversized) {
            if (onOversizedPatch === 'fail') {
                throw new Error(
                    `The binary patch archive (${patchArchiveSize} bytes) is not smaller than the full archive (${fullArchiveSize} bytes), ` +
                        'and --on-oversized-patch is set to "fail". Nothing was uploaded.',
                );
            }

            console.warn(
                `warn: The binary patch archive (${patchArchiveSize} bytes) is not smaller than the full archive (${fullArchiveSize} bytes). ` +
                    'Releasing the full bundle only, without a binary patch.',
            );
            return null;
        }

        return binaryPatch;
    } finally {
        if (extractDir) {
            fs.rmSync(extractDir, { recursive: true, force: true });
        }
    }
}

/**
 * Cross-checks the base bundle against the record a build hook exported next to it.
 *
 * The base bundle is the one input a release cannot verify on its own: pass the bundle of
 * a different build and everything still succeeds, only for the patch to be unappliable
 * on every device. The record says which bytes and which binary the export came from, so
 * when it is there, the two mistakes that produce a broken release - a base file that was
 * replaced after it was exported, and a base exported from a different binary version -
 * stop the release before anything is built or uploaded.
 *
 * A base bundle produced some other way has no record next to it, and releases exactly as
 * it did before. A record that cannot be read only warns: it is a cross-check, and losing
 * it must never be able to fail a release that is otherwise fine.
 */
function verifyExportedBaseBundleRecord(baseBundlePath: string, binaryVersion: string): void {
    const recordPath = path.join(path.dirname(path.resolve(baseBundlePath)), BINARY_PATCH_BASE_RECORD_NAME);

    let contents: string;
    try {
        contents = fs.readFileSync(recordPath, 'utf8');
    } catch {
        return;
    }

    let record: Partial<BinaryPatchBaseRecord> = {};
    try {
        record = (JSON.parse(contents) as Partial<BinaryPatchBaseRecord> | null) ?? {};
    } catch {
        // Left empty, which is reported below as a record that says nothing to check.
    }
    if (typeof record.baseBundleHash !== 'string') {
        console.warn(
            `warn: "${recordPath}" is not a readable binary patch base record, so the base bundle was released without cross-checking it.`,
        );
        return;
    }

    const baseBundleHash = hashBundleFile(baseBundlePath);
    if (record.baseBundleHash !== baseBundleHash) {
        throw new Error(
            `The base bundle "${baseBundlePath}" does not match the record exported next to it: the record describes ${record.baseBundleHash}, ` +
                `but the file hashes to ${baseBundleHash}. Export the bundle again from the build that produced the binary.`,
        );
    }

    if (typeof record.binaryVersion === 'string' && record.binaryVersion !== binaryVersion) {
        throw new Error(
            `The base bundle "${baseBundlePath}" was exported from binary version ${record.binaryVersion}, but this release targets ${binaryVersion} ` +
                '(--binary-version). Release against the bundle of the binary being targeted.',
        );
    }
}

/**
 * The bundle being released may have been compiled by an earlier `bundle` run against a
 * different base. The patch stays valid - it is always computed against the base given
 * here - but the bytecode alignment that keeps it small is lost, which is worth saying
 * out loud instead of leaving it to be noticed in the size summary.
 */
function warnOnBaseBundleMismatch(outputPath: string, baseBundlePath: string): void {
    const record = readBinaryPatchBaseRecord(outputPath);
    if (!record) {
        return;
    }

    const baseBundleHash = hashBundleFile(baseBundlePath);
    if (record.baseBundleHash !== baseBundleHash) {
        console.warn(
            `warn: The bundle was compiled against base bundle ${record.baseBundleHash}, but this release patches against ${baseBundleHash}. ` +
                'The patch is valid but larger than an aligned one.',
        );
    }
}

async function uploadArtifact(
    bundleUploader: CliConfigInterface['bundleUploader'],
    filePath: string,
    platform: 'ios' | 'android',
    identifier: string | undefined,
    artifactName: string,
): Promise<string> {
    try {
        const { downloadUrl } = await bundleUploader(filePath, platform, identifier);
        return downloadUrl
    } catch (error) {
        console.error(`Failed to upload the ${artifactName} file. Exiting the program.\n`, error)
        process.exit(1)
    }
}
