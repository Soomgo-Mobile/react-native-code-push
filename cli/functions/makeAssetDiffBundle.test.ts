import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import {
    ASSET_DIFF_ARCHIVE_INFIX,
    ASSET_DIFF_MANIFEST_NAME,
    assetDiffArchiveName,
    makeAssetDiffBundle,
} from "./makeAssetDiffBundle.js";
import { BINARY_PATCH_MANIFEST_NAME, makeBinaryPatchBundle } from "./makeBinaryPatchBundle.js";
import { makeCodePushBundle } from "./makeCodePushBundle.js";
import { applyPatch } from "../utils/binaryPatch.js";
import { generatePackageHashFromDirectory } from "../utils/hash-utils.js";
import { walk } from "../utils/promisfied-fs.js";
import { unzip } from "../utils/unzip.js";

/**
 * Exercises the diff artifact against real archives, real hdiffz output and real hashes.
 * A diff is only worth shipping if a client that owns the base package can rebuild the
 * exact contents of the new full archive from it, and only real bytes prove that.
 */

/** The directory a CodePush archive keeps its contents in, for legacy reasons. */
const CONTENTS_DIR_NAME = 'CodePush';

const BUNDLE_NAME = 'index.android.bundle';

function findRepoRoot(): string {
    let dir = process.cwd();
    for (;;) {
        if (fs.existsSync(path.join(dir, "scripts", "binary-patch", "build-hdiffpatch.sh"))) {
            return dir;
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            throw new Error(`cannot locate the repository root from ${process.cwd()}`);
        }
        dir = parent;
    }
}

const repoRoot = findRepoRoot();
const fixtureDir = path.join(repoRoot, "cli", "fixtures", "binary-patch");
const baseFixture = path.join(fixtureDir, "base.bundle");
const targetFixture = path.join(fixtureDir, "target.bundle");

/**
 * The asset both releases hold. Sized like a real asset rather than a few bytes, because
 * the builder only ships a diff that is smaller than the patch archive: dropping a
 * four-byte file would save less than the deletion manifest costs, and the builder would
 * rightly report the diff as not worth shipping.
 */
const unchangedAsset = crypto.randomBytes(4096);

let workDir: string;

/** A unique directory per test so a failed run never leaks state into the next one. */
function makeCaseDir(name: string): string {
    return fs.mkdtempSync(path.join(workDir, `${name}-`));
}

/** Writes an update contents directory shaped like the one the bundler produces. */
function writeUpdateContents(parentDir: string, files: Record<string, Buffer | string>): string {
    const contentsPath = path.join(parentDir, CONTENTS_DIR_NAME);
    for (const [relativePath, content] of Object.entries(files)) {
        const filePath = path.join(contentsPath, relativePath);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content);
    }
    return contentsPath;
}

function baseContentFiles(): Record<string, Buffer | string> {
    return {
        [BUNDLE_NAME]: fs.readFileSync(baseFixture),
        'assets/keep.png': unchangedAsset,
        'assets/change.png': 'OLD',
        'assets/gone.png': 'GONE',
    };
}

function updateContentFiles(): Record<string, Buffer | string> {
    return {
        [BUNDLE_NAME]: fs.readFileSync(targetFixture),
        'assets/keep.png': unchangedAsset,
        'assets/change.png': 'NEW',
        'assets/new.png': 'ADDED',
    };
}

type Release = {
    caseDir: string;
    bundleDirectory: string;
    packageHash: string;
    basePackageHash: string;
    baseBundleFilePath: string;
    patchBundleFilePath: string;
};

/**
 * Releases a base package and then the update, exactly the way the CLI does: a full
 * archive for each, plus the patch archive the diff is derived from.
 */
async function stageRelease(name: string, baseFiles: Record<string, Buffer | string>): Promise<Release> {
    const caseDir = makeCaseDir(name);
    const bundleDirectory = path.join(caseDir, 'bundleOutput');

    const baseContents = writeUpdateContents(path.join(caseDir, 'base'), baseFiles);
    const { bundleFileName: basePackageHash } = await makeCodePushBundle(baseContents, bundleDirectory);

    const updateContents = writeUpdateContents(path.join(caseDir, 'update'), updateContentFiles());
    const { bundleFileName: packageHash } = await makeCodePushBundle(updateContents, bundleDirectory);

    const { patchBundleFilePath } = await makeBinaryPatchBundle({
        contentsPath: updateContents,
        baseBundlePath: baseFixture,
        bundleRelativePath: BUNDLE_NAME,
        bundleDirectory,
        packageHash,
    });

    return {
        caseDir,
        bundleDirectory,
        packageHash,
        basePackageHash,
        baseBundleFilePath: path.join(bundleDirectory, basePackageHash),
        patchBundleFilePath,
    };
}

async function extractTo(archivePath: string, destination: string): Promise<string> {
    fs.mkdirSync(destination, { recursive: true });
    await unzip(archivePath, destination);
    return destination;
}

/** Every file in an archive, as the archive names it. */
async function listArchiveFiles(archivePath: string, destination: string): Promise<string[]> {
    await extractTo(archivePath, destination);
    const files = await walk(destination);
    return files.map((filePath) => path.relative(destination, filePath).split(path.sep).join('/')).sort();
}

beforeAll(() => {
    // hdiffz/hpatchz are provisioned for the whole run by the jest global setup.
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "codepush-asset-diff-"));
});

afterAll(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
});

describe("makeAssetDiffBundle", () => {
    it("ships only the files the base does not already hold", async () => {
        const release = await stageRelease("ships", baseContentFiles());

        const diff = await makeAssetDiffBundle({
            patchBundleFilePath: release.patchBundleFilePath,
            baseBundleFilePath: release.baseBundleFilePath,
            bundleDirectory: release.bundleDirectory,
            packageHash: release.packageHash,
            basePackageHash: release.basePackageHash,
        });

        expect(diff).not.toBeNull();
        expect(path.basename(diff!.diffBundleFilePath)).toBe(
            `${release.packageHash}${ASSET_DIFF_ARCHIVE_INFIX}${release.basePackageHash}.zip`,
        );
        expect(await listArchiveFiles(diff!.diffBundleFilePath, path.join(release.caseDir, "extracted"))).toEqual(
            [
                ASSET_DIFF_MANIFEST_NAME,
                `${CONTENTS_DIR_NAME}/${BINARY_PATCH_MANIFEST_NAME}`,
                `${CONTENTS_DIR_NAME}/${BUNDLE_NAME}.patch`,
                `${CONTENTS_DIR_NAME}/assets/change.png`,
                `${CONTENTS_DIR_NAME}/assets/new.png`,
            ].sort(),
        );
    });

    it("lists files the base holds but the update dropped, with the contents prefix", async () => {
        const release = await stageRelease("deletions", baseContentFiles());

        const diff = await makeAssetDiffBundle({
            patchBundleFilePath: release.patchBundleFilePath,
            baseBundleFilePath: release.baseBundleFilePath,
            bundleDirectory: release.bundleDirectory,
            packageHash: release.packageHash,
            basePackageHash: release.basePackageHash,
        });

        const extracted = await extractTo(diff!.diffBundleFilePath, path.join(release.caseDir, "extracted"));
        const manifest = JSON.parse(fs.readFileSync(path.join(extracted, ASSET_DIFF_MANIFEST_NAME), 'utf8'));

        expect(manifest.deletedFiles).toEqual([`${CONTENTS_DIR_NAME}/assets/gone.png`]);
    });

    it("reproduces the full package hash when merged the way the client merges", async () => {
        const release = await stageRelease("round-trip", baseContentFiles());

        const diff = await makeAssetDiffBundle({
            patchBundleFilePath: release.patchBundleFilePath,
            baseBundleFilePath: release.baseBundleFilePath,
            bundleDirectory: release.bundleDirectory,
            packageHash: release.packageHash,
            basePackageHash: release.basePackageHash,
        });

        // The installed base package, which is what a client merges the diff onto.
        const packageDir = await extractTo(release.baseBundleFilePath, path.join(release.caseDir, "package"));
        const diffDir = await extractTo(diff!.diffBundleFilePath, path.join(release.caseDir, "downloaded"));
        const diffContents = path.join(diffDir, CONTENTS_DIR_NAME);

        // Rebuild the bundle from its patch, then drop the two patch-only files.
        const patchManifest = JSON.parse(fs.readFileSync(path.join(diffContents, BINARY_PATCH_MANIFEST_NAME), 'utf8'));
        applyPatch(
            baseFixture,
            path.join(diffContents, patchManifest.patchFile),
            path.join(diffContents, patchManifest.bundlePath),
        );
        fs.rmSync(path.join(diffContents, patchManifest.patchFile));
        fs.rmSync(path.join(diffContents, BINARY_PATCH_MANIFEST_NAME));

        // Apply the deletions to the base package, then drop the deletion manifest.
        const diffManifestPath = path.join(diffDir, ASSET_DIFF_MANIFEST_NAME);
        const { deletedFiles } = JSON.parse(fs.readFileSync(diffManifestPath, 'utf8'));
        for (const deletedFile of deletedFiles) {
            fs.rmSync(path.join(packageDir, deletedFile));
        }
        fs.rmSync(diffManifestPath);

        // Overlay what the diff shipped onto the base package.
        fs.cpSync(diffDir, packageDir, { recursive: true });

        expect(await generatePackageHashFromDirectory(path.join(packageDir, CONTENTS_DIR_NAME), packageDir)).toBe(
            release.packageHash,
        );
    });

    it("skips the diff when it would not be smaller than the patch archive", async () => {
        // A base that shares no bytes with the update leaves nothing to prune, so the diff
        // is the patch archive plus a deletion manifest.
        const release = await stageRelease("oversized", {
            [BUNDLE_NAME]: fs.readFileSync(baseFixture),
            'assets/keep.png': crypto.randomBytes(4096),
            'assets/change.png': 'OLD',
        });
        const archivesBefore = fs.readdirSync(release.bundleDirectory).sort();

        const diff = await makeAssetDiffBundle({
            patchBundleFilePath: release.patchBundleFilePath,
            baseBundleFilePath: release.baseBundleFilePath,
            bundleDirectory: release.bundleDirectory,
            packageHash: release.packageHash,
            basePackageHash: release.basePackageHash,
        });

        expect(diff).toBeNull();
        expect(
            fs.existsSync(
                path.join(release.bundleDirectory, assetDiffArchiveName(release.packageHash, release.basePackageHash)),
            ),
        ).toBe(false);
        expect(fs.readdirSync(release.bundleDirectory).sort()).toEqual(archivesBefore);
    });

    it("leaves no working directory behind", async () => {
        const release = await stageRelease("cleanup", baseContentFiles());
        const entriesBefore = fs.readdirSync(release.caseDir).sort();

        await makeAssetDiffBundle({
            patchBundleFilePath: release.patchBundleFilePath,
            baseBundleFilePath: release.baseBundleFilePath,
            bundleDirectory: release.bundleDirectory,
            packageHash: release.packageHash,
            basePackageHash: release.basePackageHash,
        });

        expect(fs.readdirSync(release.caseDir).sort()).toEqual(entriesBefore);
    });
});
