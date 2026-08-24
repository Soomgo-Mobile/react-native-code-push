/**
 * Picks the previously released packages a new release builds asset diffs against, and
 * hands back a verified local copy of each.
 *
 * A diff is only installable by a client whose package is byte for byte the base it was
 * built against, so the base has to be the exact archive the release history describes.
 * Every download is therefore unpacked and hashed before it is accepted: a base that is
 * not what the history recorded would produce a diff that sends every client holding
 * that version into the full-download fallback.
 *
 * Bases are the most recent releases, because that is where the installed clients are.
 * One base failing is never a reason to fail the release - the release still publishes
 * its full and patch archives, and simply serves fewer diffs.
 */

import fs from "fs";
import os from "os";
import path from "path";
import semver from "semver";
import { generatePackageHashFromDirectory } from "../utils/hash-utils.js";
import { extractCodePushBundleContents } from "./makeBinaryPatchBundle.js";
import type { CliConfigInterface, ReleaseHistoryInterface } from "../../typings/react-native-code-push.d.ts";

const TEMP_DIR_PREFIX = 'codepush-asset-diff-base-';

export type AssetDiffBase = {
    basePackageHash: string;
    baseBundleFilePath: string;
};

/**
 * @param releaseHistory {ReleaseHistoryInterface} History of the binary version being released to
 * @param diffBaseCount {number} How many of the most recent releases to build diffs against
 * @param bundleDownloader Consumer-provided downloader for a released archive
 * @return The bases that downloaded and verified, newest release first.
 */
export async function resolveAssetDiffBases({
    releaseHistory,
    diffBaseCount,
    bundleDownloader,
    platform,
    identifier,
    targetBinaryVersion,
}: {
    releaseHistory: ReleaseHistoryInterface;
    diffBaseCount: number;
    bundleDownloader: NonNullable<CliConfigInterface['bundleDownloader']>;
    platform: 'ios' | 'android';
    identifier?: string;
    targetBinaryVersion: string;
}): Promise<AssetDiffBase[]> {
    // The seeded entry for the update inside the app binary has neither a url nor a hash,
    // and nothing can be diffed against a package that was never published. A key that is
    // not a version cannot be ordered against the others either, and ordering is what picks
    // the recent releases, so it is not eligible.
    const candidates = Object.entries(releaseHistory)
        .filter(([version, releaseInfo]) =>
            Boolean(semver.valid(version)) && Boolean(releaseInfo.downloadUrl) && Boolean(releaseInfo.packageHash))
        .sort(([left], [right]) => semver.rcompare(left, right))
        .slice(0, diffBaseCount);

    const bases: AssetDiffBase[] = [];
    for (const [version, releaseInfo] of candidates) {
        try {
            const { downloadedFilePath } = await bundleDownloader({
                downloadUrl: releaseInfo.downloadUrl,
                targetBinaryVersion,
                releaseVersion: version,
                packageHash: releaseInfo.packageHash,
            }, platform, identifier);

            if (!(await matchesPackageHash(downloadedFilePath, releaseInfo.packageHash))) {
                console.warn(
                    `warn: Skipping the asset diff base v${version}: the downloaded archive does not hash to the ` +
                        `package hash recorded for it (${releaseInfo.packageHash}).`,
                );
                continue;
            }

            bases.push({ basePackageHash: releaseInfo.packageHash, baseBundleFilePath: downloadedFilePath });
        } catch (error) {
            console.warn(
                `warn: Skipping the asset diff base v${version}: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    return bases;
}

/**
 * Whether an archive holds the contents the release history recorded for it.
 *
 * Unpacked into a working directory of its own: the extraction reuses one directory name,
 * so bases sharing a parent would have the second unpack wipe the first.
 */
async function matchesPackageHash(bundleFilePath: string, packageHash: string): Promise<boolean> {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_DIR_PREFIX));

    try {
        const { contentsPath } = await extractCodePushBundleContents(bundleFilePath, tempRoot);
        // Hashed relative to the contents parent, the way the archive itself was hashed.
        const actualHash = await generatePackageHashFromDirectory(contentsPath, path.join(contentsPath, '..'));
        return actualHash === packageHash;
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}
