/**
 * Builds the diff artifact a client can install on top of one particular base package.
 *
 * A diff archive is the patch archive of this release with every file the base package
 * already holds byte for byte taken out, plus a manifest naming the files the base holds
 * that the update dropped. A client copies its installed base package, applies the
 * deletions, rebuilds the JS bundle from the patch and overlays what the diff shipped -
 * which leaves it holding exactly the contents of the full archive, and therefore the
 * same `packageHash`. One release can serve a diff per base it was built against.
 *
 * The diff is derived from the artifacts the release already produced rather than from
 * the bundler, so it costs no extra bundling and cannot drift from what was published.
 */

import fs from "fs";
import path from "path";
import shell from "shelljs";
import { normalizePath } from "../utils/file-utils.js";
import { walk } from "../utils/promisfied-fs.js";
import { zipDirectoryContents } from "../utils/zip.js";
import {
    BINARY_PATCH_MANIFEST_NAME,
    type BinaryPatchManifest,
    extractCodePushBundleContents,
} from "./makeBinaryPatchBundle.js";

/**
 * Manifest listing what a client must delete from its copy of the base package. It sits
 * at the archive root, outside the contents directory, because that is where the native
 * clients look for it - and because a file inside the contents would change the package
 * hash the merged folder has to reproduce.
 */
export const ASSET_DIFF_MANIFEST_NAME = 'hotcodepush.json';

/** Separates the two hashes, so a diff archive names both the update and the base it needs. */
export const ASSET_DIFF_ARCHIVE_INFIX = '-diff-';

const TEMP_ASSET_DIFF_DIR_NAME = 'temp_contents_for_asset_diff';

export type AssetDiffManifest = {
    /** Paths relative to the package folder root, so with the contents directory prefix. */
    deletedFiles: string[];
};

export function assetDiffArchiveName(packageHash: string, basePackageHash: string): string {
    return `${packageHash}${ASSET_DIFF_ARCHIVE_INFIX}${basePackageHash}.zip`;
}

/**
 * Creates the diff archive for a release against one base package.
 *
 * @param patchBundleFilePath {string} Patch archive this release already built
 * @param baseBundleFilePath {string} Full archive of the base release, downloaded locally
 * @param bundleDirectory {string} Directory the release artifacts are written to
 * @param packageHash {string} Package hash of this release
 * @param basePackageHash {string} Package hash of the base release
 * @return The diff archive, or `null` when it is not smaller than the patch archive it
 * was derived from, in which case there is nothing to gain from publishing it.
 */
export async function makeAssetDiffBundle({
    patchBundleFilePath,
    baseBundleFilePath,
    bundleDirectory,
    packageHash,
    basePackageHash,
}: {
    patchBundleFilePath: string;
    baseBundleFilePath: string;
    bundleDirectory: string;
    packageHash: string;
    basePackageHash: string;
}): Promise<{ diffBundleFilePath: string } | null> {
    // Kept next to the release output rather than in the system temp directory so a crash
    // leaves the leftovers where the rest of the build output is cleaned up. Named after
    // the base so building the diffs of one release against several bases at once cannot
    // have two of them share a working directory.
    const tempRoot = path.join(
        path.dirname(path.resolve(bundleDirectory)),
        `${TEMP_ASSET_DIFF_DIR_NAME}_${basePackageHash}`,
    );
    const stagingRoot = path.join(tempRoot, 'archive');

    fs.rmSync(tempRoot, { recursive: true, force: true });

    try {
        // Extracted into separate parents: `extractCodePushBundleContents` reuses one
        // directory name, so a shared parent would have the second unpack wipe the first.
        const { contentsPath: patchContents } = await extractCodePushBundleContents(
            patchBundleFilePath,
            path.join(tempRoot, 'patch-archive'),
        );
        const { contentsPath: baseContents } = await extractCodePushBundleContents(
            baseBundleFilePath,
            path.join(tempRoot, 'base-archive'),
        );

        const patchManifest: BinaryPatchManifest = JSON.parse(
            fs.readFileSync(path.join(patchContents, BINARY_PATCH_MANIFEST_NAME), 'utf8'),
        );
        // Manifest paths are compared against archive-relative paths, which are POSIX.
        const patchFile = normalizePath(patchManifest.patchFile);
        const bundlePath = normalizePath(patchManifest.bundlePath);

        // What the full archive of this release holds: the patch archive without its two
        // patch-only files, plus the bundle the patch rebuilds. Deletions are worked out
        // against that set, not against the subset the diff happens to ship.
        const patchFiles = await listFilesRelative(patchContents);
        const updateFiles = new Set(
            patchFiles.filter(
                (relativePath) => relativePath !== BINARY_PATCH_MANIFEST_NAME && relativePath !== patchFile,
            ),
        );
        updateFiles.add(bundlePath);

        // The archive root directory name is part of the contents layout, so the diff
        // archive has to reuse the name the full archive used.
        const contentsDirName = path.basename(patchContents);
        const stagedContents = path.join(stagingRoot, contentsDirName);
        fs.cpSync(patchContents, stagedContents, { recursive: true });
        for (const relativePath of patchFiles) {
            const baseFile = path.join(baseContents, relativePath);
            if (fs.existsSync(baseFile) && sameBytes(path.join(patchContents, relativePath), baseFile)) {
                fs.rmSync(path.join(stagedContents, relativePath));
            }
        }

        const manifest: AssetDiffManifest = {
            deletedFiles: (await listFilesRelative(baseContents))
                .filter((relativePath) => !updateFiles.has(relativePath))
                .map((relativePath) => `${contentsDirName}/${relativePath}`),
        };
        fs.writeFileSync(path.join(stagingRoot, ASSET_DIFF_MANIFEST_NAME), JSON.stringify(manifest, null, 2));

        const diffArchiveZipPath = await zipDirectoryContents(stagingRoot);
        if (fs.statSync(diffArchiveZipPath).size >= fs.statSync(patchBundleFilePath).size) {
            // A diff that costs a client as much as the patch archive is never the better
            // artifact of the two, and the release still publishes that patch archive.
            fs.rmSync(diffArchiveZipPath);
            return null;
        }

        const diffBundleFilePath = path.join(bundleDirectory, assetDiffArchiveName(packageHash, basePackageHash));
        shell.mkdir('-p', bundleDirectory);
        shell.mv(diffArchiveZipPath, diffBundleFilePath);

        return { diffBundleFilePath };
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

/** Every file below `directoryPath`, as POSIX paths relative to it. */
async function listFilesRelative(directoryPath: string): Promise<string[]> {
    const files = await walk(directoryPath);
    return files.map((filePath) => normalizePath(path.relative(directoryPath, filePath)));
}

function sameBytes(left: string, right: string): boolean {
    // A base that holds a directory where the update holds a file has nothing the update
    // can be spared from downloading, so the file ships.
    const rightStats = fs.statSync(right);
    if (!rightStats.isFile() || fs.statSync(left).size !== rightStats.size) {
        return false;
    }
    return fs.readFileSync(left).equals(fs.readFileSync(right));
}
