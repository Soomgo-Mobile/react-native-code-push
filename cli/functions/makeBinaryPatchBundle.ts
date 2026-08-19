/**
 * Builds the binary patch artifact that ships alongside a full CodePush update.
 *
 * A patch archive is the full archive with the JS bundle swapped for a patch against
 * the bundle that is already inside the app binary, plus a manifest describing how to
 * rebuild it. Every other file (assets and so on) is copied over untouched, so a
 * client that applies the patch and drops the two patch-only files holds byte-for-byte
 * the same contents as the full archive - and therefore computes the same
 * `packageHash`. That is what lets one release serve both artifacts.
 *
 * The archive is produced from an already assembled contents directory rather than
 * from the bundler, so it is independent of Metro and Hermes: whoever prepared the
 * contents (a fresh bundle run, or an existing bundle file unpacked for
 * `--skip-bundle`) gets the same artifact.
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import shell from "shelljs";
import {
    BINARY_PATCH_ALGORITHM,
    BINARY_PATCH_FORMAT_VERSION,
    generatePatch,
} from "../utils/binaryPatch.js";
import { unzip } from "../utils/unzip.js";
import { zip } from "../utils/zip.js";

/** Manifest file a client reads to decide whether it can apply the patch, and how. */
export const BINARY_PATCH_MANIFEST_NAME = 'codepush-binary-patch.json';

/** Appended to the full archive name so the two artifacts of a release stay paired. */
export const BINARY_PATCH_ARCHIVE_SUFFIX = '-patch.zip';

/**
 * Record the `bundle` command leaves in the output root - outside the update contents,
 * so it never reaches the archive - to say which base bundle the JS bundle was
 * compiled against. A later `release` compares it with the base it was given.
 *
 * The build hooks (`android/codepush-export.gradle`, `scripts/export-embedded-bundle.sh`)
 * write a record of the same name next to the bundle they export from a native build,
 * which is what makes that bundle self-describing when it is later passed to
 * `release --binary-bundle-path`.
 */
export const BINARY_PATCH_BASE_RECORD_NAME = 'binary-patch-base.json';

const TEMP_PATCH_CONTENTS_DIR_NAME = 'temp_contents_for_binary_patch';
const TEMP_EXTRACTED_CONTENTS_DIR_NAME = 'temp_contents_from_bundle_file';

const HASH_ALGORITHM = 'sha256';

export type BinaryPatchManifest = {
    formatVersion: number;
    algorithm: string;
    /** Target bundle path, relative to the update contents root. */
    bundlePath: string;
    /** Patch file path, relative to the update contents root. */
    patchFile: string;
    baseBundleHash: string;
    targetBundleHash: string;
    targetBundleSize: number;
};

export type BinaryPatchBundle = {
    patchBundleFilePath: string;
    manifest: BinaryPatchManifest;
};

/**
 * Contents of `binary-patch-base.json`. The `bundle` command writes the hash alone; a
 * build hook, which knows which binary the bundle it exported went into, adds the rest.
 *
 * The field names are a contract shared with `android/codepush-export.gradle` and
 * `scripts/export-embedded-bundle.sh`, which spell them out as literals. Keep the three
 * in step.
 */
export type BinaryPatchBaseRecord = {
    baseBundleHash: string;
    /** Marketing version of the binary the bundle shipped in: `versionName` / `CFBundleShortVersionString`. */
    binaryVersion?: string;
    /** Build number of that binary: `versionCode` / `CFBundleVersion`. */
    buildNumber?: string;
    /** Commit the binary was built from, present only when the build could work it out. */
    gitSha?: string;
};

/** SHA-256 of a single file's bytes, which is what the manifest records. */
export function hashBundleFile(filePath: string): string {
    return crypto.createHash(HASH_ALGORITHM).update(fs.readFileSync(filePath)).digest('hex');
}

/**
 * Resolves the `--binary-bundle-path` option to an absolute path, rejecting anything
 * that is not an existing file. Called before the bundler runs so a typo surfaces
 * before minutes of bundling rather than after.
 */
export function resolveBaseBundlePath(binaryBundlePath: string): string {
    const resolved = path.resolve(binaryBundlePath);

    let stats: fs.Stats;
    try {
        stats = fs.statSync(resolved);
    } catch {
        throw new Error(`--binary-bundle-path "${binaryBundlePath}" does not exist.`);
    }
    if (!stats.isFile()) {
        throw new Error(`--binary-bundle-path "${binaryBundlePath}" is not a file.`);
    }

    return resolved;
}

/**
 * Same as `resolveBaseBundlePath`, but reports the problem the way the other CLI
 * options do. Returns `undefined` when the option was not passed at all.
 */
export function resolveBinaryBundlePathOption(binaryBundlePath: string | undefined): string | undefined {
    if (!binaryBundlePath) {
        return undefined;
    }

    try {
        return resolveBaseBundlePath(binaryBundlePath);
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    }
}

/**
 * Creates the patch archive for an update that has already been assembled.
 *
 * @param contentsPath {string} Directory holding the update contents that went into the full archive
 * @param baseBundlePath {string} JS bundle from the target binary, which the patch is computed against
 * @param bundleRelativePath {string} Target bundle path inside `contentsPath`
 * @param bundleDirectory {string} Directory the full archive was written to
 * @param packageHash {string} Package hash of the full archive, which names both artifacts
 */
export async function makeBinaryPatchBundle({
    contentsPath,
    baseBundlePath,
    bundleRelativePath,
    bundleDirectory,
    packageHash,
}: {
    contentsPath: string;
    baseBundlePath: string;
    bundleRelativePath: string;
    bundleDirectory: string;
    packageHash: string;
}): Promise<BinaryPatchBundle> {
    const resolvedContentsPath = path.resolve(contentsPath);
    const targetBundlePath = path.join(resolvedContentsPath, bundleRelativePath);
    if (!isFile(targetBundlePath)) {
        throw new Error(
            `Target bundle "${bundleRelativePath}" was not found in the update contents ("${resolvedContentsPath}"). ` +
                `Pass -j/--js-bundle-name if the bundle file has a different name.`,
        );
    }
    const resolvedBaseBundlePath = resolveBaseBundlePath(baseBundlePath);

    const baseBundleHash = hashBundleFile(resolvedBaseBundlePath);
    const targetBundleHash = hashBundleFile(targetBundlePath);
    if (baseBundleHash === targetBundleHash) {
        console.warn(
            'warn: The base bundle and the target bundle are identical, so the update changes nothing. Releasing anyway.',
        );
    }

    // Kept next to the update contents rather than in the system temp directory so a
    // crash leaves the leftovers where the rest of the build output is cleaned up.
    const tempRoot = path.join(path.dirname(resolvedContentsPath), TEMP_PATCH_CONTENTS_DIR_NAME);
    // The archive root directory name is part of the contents layout, so the patch
    // archive has to reuse the name the full archive used.
    const patchContentsPath = path.join(tempRoot, path.basename(resolvedContentsPath));

    fs.rmSync(tempRoot, { recursive: true, force: true });

    try {
        fs.cpSync(resolvedContentsPath, patchContentsPath, { recursive: true });
        fs.rmSync(path.join(patchContentsPath, bundleRelativePath));

        const patchRelativePath = `${bundleRelativePath}.patch`;
        generatePatch(resolvedBaseBundlePath, targetBundlePath, path.join(patchContentsPath, patchRelativePath));

        const manifest: BinaryPatchManifest = {
            formatVersion: BINARY_PATCH_FORMAT_VERSION,
            algorithm: BINARY_PATCH_ALGORITHM,
            bundlePath: bundleRelativePath,
            patchFile: patchRelativePath,
            baseBundleHash,
            targetBundleHash,
            targetBundleSize: fs.statSync(targetBundlePath).size,
        };
        fs.writeFileSync(path.join(patchContentsPath, BINARY_PATCH_MANIFEST_NAME), JSON.stringify(manifest, null, 2));

        const patchArchiveZipPath = await zip(patchContentsPath);
        const patchBundleFilePath = path.join(bundleDirectory, `${packageHash}${BINARY_PATCH_ARCHIVE_SUFFIX}`);
        shell.mkdir('-p', bundleDirectory);
        shell.mv(patchArchiveZipPath, patchBundleFilePath);

        return { patchBundleFilePath, manifest };
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

/**
 * Unpacks an already built CodePush bundle file, so `release --skip-bundle` can patch
 * exactly the contents that were packed instead of bundling them again.
 *
 * @return The extraction directory, which the caller owns and must remove, and the
 * update contents root inside it.
 */
export async function extractCodePushBundleContents(
    bundleFilePath: string,
    parentDirectory: string,
): Promise<{ extractDir: string, contentsPath: string }> {
    const extractDir = path.resolve(path.join(parentDirectory, TEMP_EXTRACTED_CONTENTS_DIR_NAME));

    fs.rmSync(extractDir, { recursive: true, force: true });
    fs.mkdirSync(extractDir, { recursive: true });
    try {
        await unzip(path.resolve(bundleFilePath), extractDir);
    } catch (error) {
        fs.rmSync(extractDir, { recursive: true, force: true });
        throw error;
    }

    return { extractDir, contentsPath: resolveExtractedContentsPath(extractDir) };
}

/**
 * A CodePush archive wraps its files in a single directory, so that directory - not
 * the extraction directory - is the contents root.
 */
function resolveExtractedContentsPath(extractDir: string): string {
    const entries = fs.readdirSync(extractDir, { withFileTypes: true });
    if (entries.length === 1 && entries[0].isDirectory()) {
        return path.join(extractDir, entries[0].name);
    }
    return extractDir;
}

/** Records which base bundle the JS bundle in `outputRootPath` was compiled against. */
export function writeBinaryPatchBaseRecord(outputRootPath: string, baseBundleHash: string): string {
    const recordPath = path.join(outputRootPath, BINARY_PATCH_BASE_RECORD_NAME);
    const record: BinaryPatchBaseRecord = { baseBundleHash };

    fs.mkdirSync(outputRootPath, { recursive: true });
    fs.writeFileSync(recordPath, JSON.stringify(record, null, 2));

    return recordPath;
}

/**
 * Reads the record left by a previous `bundle` run. An unreadable record is treated as
 * no record: it only feeds a warning, and must never be able to fail a release.
 */
export function readBinaryPatchBaseRecord(outputRootPath: string): BinaryPatchBaseRecord | null {
    const recordPath = path.join(outputRootPath, BINARY_PATCH_BASE_RECORD_NAME);

    try {
        const record = JSON.parse(fs.readFileSync(recordPath, 'utf8')) as Partial<BinaryPatchBaseRecord>;
        if (typeof record.baseBundleHash !== 'string') {
            return null;
        }
        return { baseBundleHash: record.baseBundleHash };
    } catch {
        return null;
    }
}

/**
 * What a release does with a patch archive that did not turn out smaller than the full
 * archive. The CLI runs unattended in CI, so the answer is a policy chosen up front
 * rather than a decision the summary invites someone to make.
 */
export type OversizedPatchPolicy = 'skip' | 'fail';

/** Accepted `--on-oversized-patch` values, in the order the help text lists them. */
export const OVERSIZED_PATCH_POLICIES: OversizedPatchPolicy[] = ['skip', 'fail'];

export const DEFAULT_OVERSIZED_PATCH_POLICY: OversizedPatchPolicy = 'skip';

/**
 * Whether the patch archive is worth publishing next to the full archive.
 *
 * Equal sizes count as oversized: a patch that saves nothing still costs a client the
 * download plus an apply step, so it is never the better artifact of the two.
 */
export function isPatchArchiveOversized(fullArchiveSize: number, patchArchiveSize: number): boolean {
    return patchArchiveSize >= fullArchiveSize;
}

/**
 * The operator-facing summary, printed before the artifacts are uploaded so the size of
 * what is about to be published is on the record. When the patch is not smaller than the
 * full archive and the release is going ahead without it, the summary says so rather
 * than leaving a negative saving to be interpreted.
 */
export function formatBinaryPatchSummary({
    platform,
    baseBundleHash,
    targetBundleHash,
    fullArchiveSize,
    patchArchiveSize,
    patchSkipped = false,
}: {
    platform: 'ios' | 'android';
    baseBundleHash: string;
    targetBundleHash: string;
    fullArchiveSize: number;
    patchArchiveSize: number;
    patchSkipped?: boolean;
}): string {
    const savedBytes = fullArchiveSize - patchArchiveSize;
    const savedRatio = fullArchiveSize > 0 ? savedBytes / fullArchiveSize : 0;

    const sizes = [fullArchiveSize, patchArchiveSize, savedBytes].map(formatBytes);
    const sizeWidth = Math.max(...sizes.map((size) => size.length));
    const [fullSize, patchSize, savedSize] = sizes.map((size) => size.padStart(sizeWidth));

    const label = (text: string) => text.padEnd(23);

    const lines = [
        `Binary patch summary (${platform})`,
        `${label('Base bundle SHA-256:')}${baseBundleHash}`,
        `${label('Target bundle SHA-256:')}${targetBundleHash}`,
        `${label('Full archive:')}${fullSize}`,
        `${label('Patch archive:')}${patchSize}`,
        `${label('Saved:')}${savedSize} (${(savedRatio * 100).toFixed(1)}%)`,
    ];

    if (patchSkipped) {
        lines.push(
            `${label('Patch skipped:')}not smaller than the full archive; releasing the full bundle only (--on-oversized-patch skip)`,
        );
    }

    return lines.join('\n');
}

function formatBytes(bytes: number): string {
    const units = ['KB', 'MB', 'GB', 'TB'];

    if (Math.abs(bytes) < 1024) {
        return `${bytes} B`;
    }

    let value = bytes / 1024;
    let unitIndex = 0;
    while (Math.abs(value) >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex++;
    }

    return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function isFile(filePath: string): boolean {
    try {
        return fs.statSync(filePath).isFile();
    } catch {
        return false;
    }
}
