import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { release } from "./release.js";
import { makeCodePushBundle } from "../../functions/makeCodePushBundle.js";
import { ASSET_DIFF_ARCHIVE_INFIX, assetDiffArchiveName } from "../../functions/makeAssetDiffBundle.js";
import {
    BINARY_PATCH_ARCHIVE_SUFFIX,
    BINARY_PATCH_BASE_RECORD_NAME,
    BINARY_PATCH_MANIFEST_NAME,
    hashBundleFile,
    writeBinaryPatchBaseRecord,
    type OversizedPatchPolicy,
} from "../../functions/makeBinaryPatchBundle.js";
import { applyPatch } from "../../utils/binaryPatch.js";
import { generatePackageHashFromDirectory } from "../../utils/hash-utils.js";
import { unzip } from "../../utils/unzip.js";
import type { BundleUploadArtifact, CliConfigInterface, ReleaseHistoryInterface } from "../../../typings/react-native-code-push.d.ts";

/**
 * Covers the release flow around the binary patch option with `--skip-bundle`, which is
 * the one path that reaches every decision - which artifacts exist, in which order they
 * are uploaded, what the history ends up saying - without running the bundler.
 */

/** Filled in by `bundle`, so `release --skip-bundle` starts from a real archive. */
const CONTENTS_DIR_NAME = 'CodePush';
const OUTPUT_DIR_NAME = 'build';
const BUNDLE_OUTPUT_DIR_NAME = 'bundleOutput';

const BINARY_VERSION = '9.9.9';
const APP_VERSION = '9.9.10';

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

let workDir: string;

type StagedBundle = {
    outputPath: string;
    bundleDirectory: string;
    bundleFileName: string;
};

/**
 * Leaves an output directory in the state a finished `bundle` run leaves it in: the
 * bundle file, and no update contents - the contents are the bundler's scratch space,
 * and `--skip-bundle` cannot assume they survived.
 */
async function stageBundleOutput(
    caseName: string,
    files: Record<string, Buffer | string> = { 'main.jsbundle': fs.readFileSync(targetFixture) },
): Promise<StagedBundle> {
    const caseDir = fs.mkdtempSync(path.join(workDir, `${caseName}-`));
    const outputPath = path.join(caseDir, OUTPUT_DIR_NAME);
    const contentsPath = path.join(outputPath, CONTENTS_DIR_NAME);

    for (const [relativePath, content] of Object.entries(files)) {
        const filePath = path.join(contentsPath, relativePath);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content);
    }

    const bundleDirectory = path.join(outputPath, BUNDLE_OUTPUT_DIR_NAME);
    const { bundleFileName } = await makeCodePushBundle(contentsPath, bundleDirectory);
    fs.rmSync(contentsPath, { recursive: true, force: true });

    return { outputPath, bundleDirectory, bundleFileName };
}

class ProcessExitError extends Error {
    constructor(readonly code: number) {
        super(`process.exit(${code})`);
    }
}

type Uploads = {
    artifact: BundleUploadArtifact | undefined;
    downloadUrl: string;
    filePath: string;
    logCountBeforeUpload: number;
}[];

function recordingUploader(
    uploads: Uploads,
    failOn?: (filePath: string) => boolean,
): CliConfigInterface['bundleUploader'] {
    return async (filePath, _platform, _identifier, artifact) => {
        if (failOn?.(filePath)) {
            throw new Error(`upload rejected: ${path.basename(filePath)}`);
        }
        const downloadUrl = `https://cdn.example.com/${path.basename(filePath)}`;
        uploads.push({ artifact, filePath, downloadUrl, logCountBeforeUpload: logs.length });
        return { downloadUrl };
    };
}

function historyStore(existingHistory: ReleaseHistoryInterface = {}, onSave?: () => void) {
    const saved: ReleaseHistoryInterface[] = [];
    return {
        saved,
        getReleaseHistory: async () => existingHistory,
        setReleaseHistory: async (
            _binaryVersion: string,
            _jsonFilePath: string,
            releaseInfo: ReleaseHistoryInterface,
        ) => {
            onSave?.();
            saved.push(releaseInfo);
        },
    };
}

type ReleaseOverrides = {
    binaryBundlePath?: string;
    platform?: 'ios' | 'android';
    jsBundleName?: string;
    skipCleanup?: boolean;
    uploadFailsFor?: (filePath: string) => boolean;
    onOversizedPatch?: OversizedPatchPolicy;
    /** Passed in when the case has to read the uploads of a release that threw. */
    uploads?: Uploads;
    /** What the consumer already has released, which the asset diff bases are picked from. */
    releaseHistory?: ReleaseHistoryInterface;
    bundleDownloader?: CliConfigInterface['bundleDownloader'];
    diffBaseCount?: number;
};

async function runRelease(staged: StagedBundle, overrides: ReleaseOverrides = {}) {
    const uploads: Uploads = overrides.uploads ?? [];
    const uploadCountsWhenHistorySaved: number[] = [];
    const history = historyStore(overrides.releaseHistory, () => {
        uploadCountsWhenHistorySaved.push(uploads.length);
    });

    await release(
        recordingUploader(uploads, overrides.uploadFailsFor),
        history.getReleaseHistory,
        history.setReleaseHistory,
        BINARY_VERSION,
        APP_VERSION,
        undefined,
        overrides.platform ?? 'ios',
        undefined,
        staged.outputPath,
        'index.ts',
        // Left unset unless the case is about -j, the way commander leaves it.
        overrides.jsBundleName,
        false,
        true,
        undefined,
        true, // skipBundle
        overrides.skipCleanup ?? true,
        staged.bundleDirectory,
        undefined,
        undefined,
        overrides.binaryBundlePath,
        overrides.onOversizedPatch,
        overrides.bundleDownloader,
        overrides.diffBaseCount,
    );

    return { uploads, releaseHistories: history.saved, uploadCountsWhenHistorySaved };
}

let logs: string[];

beforeAll(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "codepush-release-"));
});

afterAll(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
});

beforeEach(() => {
    logs = [];
    const collect = (...args: unknown[]) => {
        logs.push(args.map(String).join(' '));
    };
    jest.spyOn(console, 'log').mockImplementation(collect);
    jest.spyOn(console, 'warn').mockImplementation(collect);
    jest.spyOn(console, 'error').mockImplementation(collect);
    jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        throw new ProcessExitError(code ?? 0);
    }) as never);
});

afterEach(() => {
    jest.restoreAllMocks();
    // addToReleaseHistory writes its JSON next to the invocation, and only removes it
    // when the history was stored successfully.
    fs.rmSync(path.resolve(process.cwd(), `${BINARY_VERSION}.json`), { force: true });
});

describe("release without --binary-bundle-path", () => {
    it("keeps existing three-argument uploaders callable", async () => {
        const legacyUploader = async (
            source: string,
            _platform: 'ios' | 'android',
            _identifier?: string,
        ) => ({ downloadUrl: source });
        const uploader: CliConfigInterface['bundleUploader'] = legacyUploader;

        await expect(uploader('bundle.zip', 'ios')).resolves.toEqual({ downloadUrl: 'bundle.zip' });
    });

    it("uploads the full bundle only, exactly as before binary patches existed", async () => {
        const staged = await stageBundleOutput("full-only");

        const { uploads, releaseHistories } = await runRelease(staged);

        expect(uploads).toHaveLength(1);
        expect(uploads[0].filePath).toBe(`${staged.bundleDirectory}/${staged.bundleFileName}`);
        expect(uploads[0].artifact).toEqual({
            type: 'full-bundle',
            targetBinaryVersion: BINARY_VERSION,
            packageHash: staged.bundleFileName,
        });
        expect(fs.readdirSync(staged.bundleDirectory)).toEqual([staged.bundleFileName]);
        expect(releaseHistories[0][APP_VERSION]).toEqual({
            enabled: true,
            mandatory: false,
            downloadUrl: uploads[0].downloadUrl,
            packageHash: staged.bundleFileName,
        });
        // A release without a patch says nothing about one, so a client reading this
        // history behaves exactly as it did before binary patches existed.
        expect(releaseHistories[0][APP_VERSION]).not.toHaveProperty('binaryPatchDownloadUrl');
    });
});

describe("release --skip-bundle --binary-bundle-path", () => {
    it("patches the bundle that is already in the output directory and uploads both artifacts", async () => {
        const staged = await stageBundleOutput("skip-bundle");

        const { uploads, releaseHistories } = await runRelease(staged, { binaryBundlePath: baseFixture });

        const patchFileName = `${staged.bundleFileName}${BINARY_PATCH_ARCHIVE_SUFFIX}`;
        // The full archive goes first: the patch is an optimisation on top of it.
        expect(uploads.map(({ filePath }) => path.basename(filePath))).toEqual([staged.bundleFileName, patchFileName]);
        expect(fs.existsSync(path.join(staged.bundleDirectory, patchFileName))).toBe(true);

        // Both artifacts are described in the same entry: the full bundle every client can
        // download, and the patch a client holding the matching binary can apply instead.
        expect(releaseHistories[0][APP_VERSION].downloadUrl).toBe(uploads[0].downloadUrl);
        expect(releaseHistories[0][APP_VERSION].binaryPatchDownloadUrl).toBe(uploads[1].downloadUrl);
        expect(releaseHistories[0][APP_VERSION].packageHash).toBe(staged.bundleFileName);
    });

    it("prints the size summary before uploading anything", async () => {
        const staged = await stageBundleOutput("summary");

        const { uploads } = await runRelease(staged, { binaryBundlePath: baseFixture });

        const summaryIndex = logs.findIndex((line) => line.startsWith('Binary patch summary (ios)'));
        expect(summaryIndex).toBeGreaterThanOrEqual(0);
        expect(logs[summaryIndex]).toContain('Saved:');
        // Printed while the release can still be stopped, so before the first upload.
        expect(uploads).toHaveLength(2);
        expect(summaryIndex).toBeLessThan(uploads[0].logCountBeforeUpload);
    });

    it("uses the platform's own bundle name when picking the target to patch", async () => {
        const staged = await stageBundleOutput("android", {
            'index.android.bundle': fs.readFileSync(targetFixture),
        });

        await runRelease(staged, { binaryBundlePath: baseFixture, platform: 'android' });

        expect(logs.some((line) => line.startsWith('Binary patch summary (android)'))).toBe(true);
    });

    it("patches a bundle that was built with a custom JS bundle name", async () => {
        const staged = await stageBundleOutput("custom-name", {
            'custom.jsbundle': fs.readFileSync(targetFixture),
        });

        const { uploads } = await runRelease(staged, {
            binaryBundlePath: baseFixture,
            jsBundleName: 'custom.jsbundle',
        });

        expect(uploads.map(({ filePath }) => path.basename(filePath))).toEqual([
            staged.bundleFileName,
            `${staged.bundleFileName}${BINARY_PATCH_ARCHIVE_SUFFIX}`,
        ]);

        const extractRoot = path.join(staged.outputPath, 'extracted');
        fs.mkdirSync(extractRoot, { recursive: true });
        await unzip(path.join(staged.bundleDirectory, `${staged.bundleFileName}${BINARY_PATCH_ARCHIVE_SUFFIX}`), extractRoot);
        const manifest = JSON.parse(
            fs.readFileSync(path.join(extractRoot, CONTENTS_DIR_NAME, BINARY_PATCH_MANIFEST_NAME), 'utf8'),
        ) as { bundlePath: string, patchFile: string };

        expect(manifest.bundlePath).toBe('custom.jsbundle');
        expect(manifest.patchFile).toBe('custom.jsbundle.patch');
    });

    it("fails without -j when the released bundle uses a custom JS bundle name", async () => {
        const staged = await stageBundleOutput("custom-name-without-option", {
            'custom.jsbundle': fs.readFileSync(targetFixture),
        });

        // The error names -j because passing it is what makes this release work.
        await expect(runRelease(staged, { binaryBundlePath: baseFixture })).rejects.toThrow(
            /main\.jsbundle.*--js-bundle-name/s,
        );
    });

    it("fails with an actionable error when the released bundle holds no matching JS bundle", async () => {
        const staged = await stageBundleOutput("no-target", {
            'index.android.bundle': fs.readFileSync(targetFixture),
        });

        await expect(runRelease(staged, { binaryBundlePath: baseFixture, platform: 'ios' })).rejects.toThrow(
            /main\.jsbundle.*--js-bundle-name/s,
        );
    });

    it("warns when the bundle was compiled against a different base bundle", async () => {
        const staged = await stageBundleOutput("mismatch");
        writeBinaryPatchBaseRecord(staged.outputPath, 'f'.repeat(64));

        await runRelease(staged, { binaryBundlePath: baseFixture });

        expect(logs.filter((line) => line.startsWith('warn:')).join('\n')).toMatch(/compiled against base bundle/);
    });

    it("does not warn when the recorded base bundle is the one being patched against", async () => {
        const staged = await stageBundleOutput("match");
        // The record the `bundle` command writes holds the hash of this same file.
        writeBinaryPatchBaseRecord(staged.outputPath, hashBundleFile(baseFixture));

        await runRelease(staged, { binaryBundlePath: baseFixture });

        expect(logs.filter((line) => line.startsWith('warn:'))).toEqual([]);
    });

    it("keeps the release history untouched when the patch archive cannot be uploaded", async () => {
        const staged = await stageBundleOutput("patch-upload-failure");

        const uploads: Uploads = [];
        const history = historyStore();

        await expect(
            release(
                recordingUploader(uploads, (filePath) => filePath.endsWith(BINARY_PATCH_ARCHIVE_SUFFIX)),
                history.getReleaseHistory,
                history.setReleaseHistory,
                BINARY_VERSION,
                APP_VERSION,
                undefined,
                'ios',
                undefined,
                staged.outputPath,
                'index.ts',
                '',
                false,
                true,
                undefined,
                true,
                true,
                staged.bundleDirectory,
                undefined,
                undefined,
                baseFixture,
            ),
        ).rejects.toThrow(ProcessExitError);

        expect(uploads.map(({ filePath }) => path.basename(filePath))).toEqual([staged.bundleFileName]);
        expect(history.saved).toEqual([]);
    });

    it("leaves no working directories behind and cleans up the output when asked", async () => {
        const staged = await stageBundleOutput("cleanup");

        await runRelease(staged, { binaryBundlePath: baseFixture, skipCleanup: true });

        expect(fs.readdirSync(staged.outputPath)).toEqual([BUNDLE_OUTPUT_DIR_NAME]);

        await runRelease(staged, { binaryBundlePath: baseFixture, skipCleanup: false });

        expect(fs.existsSync(staged.outputPath)).toBe(false);
    });

    it("still finds the bundle to release when a previous run left its patch archive behind", async () => {
        const staged = await stageBundleOutput("leftover-patch");
        fs.writeFileSync(path.join(staged.bundleDirectory, `stale${BINARY_PATCH_ARCHIVE_SUFFIX}`), 'stale');

        const { uploads } = await runRelease(staged, { binaryBundlePath: baseFixture });

        expect(path.basename(uploads[0].filePath)).toBe(staged.bundleFileName);
    });

    it("uploads the patch when it is smaller than the full bundle, without warning about its size", async () => {
        const staged = await stageBundleOutput("worthwhile-patch");

        const { uploads } = await runRelease(staged, { binaryBundlePath: baseFixture });

        expect(uploads).toHaveLength(2);
        expect(logs.filter((line) => line.startsWith('warn:'))).toEqual([]);
        expect(logs.join('\n')).not.toContain('Patch skipped:');
    });

    it("ships a patch archive a client can turn back into the released bundle", async () => {
        const staged = await stageBundleOutput("manifest", {
            'main.jsbundle': fs.readFileSync(targetFixture),
            'assets/logo.png': Buffer.from('logo-bytes'),
        });

        await runRelease(staged, { binaryBundlePath: baseFixture });

        const extractRoot = path.join(staged.outputPath, 'extracted');
        fs.mkdirSync(extractRoot, { recursive: true });
        await unzip(path.join(staged.bundleDirectory, `${staged.bundleFileName}${BINARY_PATCH_ARCHIVE_SUFFIX}`), extractRoot);

        const contents = path.join(extractRoot, CONTENTS_DIR_NAME);
        const manifest = JSON.parse(fs.readFileSync(path.join(contents, BINARY_PATCH_MANIFEST_NAME), 'utf8')) as {
            bundlePath: string,
            patchFile: string,
        };
        expect(manifest.bundlePath).toBe('main.jsbundle');

        applyPatch(baseFixture, path.join(contents, manifest.patchFile), path.join(contents, manifest.bundlePath));
        fs.rmSync(path.join(contents, manifest.patchFile));
        fs.rmSync(path.join(contents, BINARY_PATCH_MANIFEST_NAME));

        expect(await generatePackageHashFromDirectory(contents, extractRoot)).toBe(staged.bundleFileName);
    });
});

/**
 * The build hooks export the bundle of a native build with a record describing it, so the
 * base bundle a release is handed can be checked against the build it came out of.
 */
describe("release --binary-bundle-path with an exported base bundle record", () => {
    /** A base bundle laid out the way a build hook leaves it: the bundle, and its record beside it. */
    function stageExportedBaseBundle(caseName: string, record?: string): string {
        const exportDir = fs.mkdtempSync(path.join(workDir, `${caseName}-export-`));
        const baseBundlePath = path.join(exportDir, 'main.jsbundle');
        fs.copyFileSync(baseFixture, baseBundlePath);

        if (record !== undefined) {
            fs.writeFileSync(path.join(exportDir, BINARY_PATCH_BASE_RECORD_NAME), record);
        }

        return baseBundlePath;
    }

    function exportedRecord(overrides: Record<string, unknown> = {}): string {
        return JSON.stringify({
            baseBundleHash: hashBundleFile(baseFixture),
            binaryVersion: BINARY_VERSION,
            buildNumber: '42',
            gitSha: 'a'.repeat(40),
            ...overrides,
        }, null, 2);
    }

    it("releases both artifacts when the record describes this bundle and this binary version", async () => {
        const staged = await stageBundleOutput("record-match");
        const baseBundlePath = stageExportedBaseBundle("record-match", exportedRecord());

        const { uploads } = await runRelease(staged, { binaryBundlePath: baseBundlePath });

        expect(uploads).toHaveLength(2);
        expect(logs.filter((line) => line.startsWith('warn:'))).toEqual([]);
    });

    it("fails before anything is built when the base bundle is not the file the record describes", async () => {
        const staged = await stageBundleOutput("record-hash-mismatch");
        const baseBundlePath = stageExportedBaseBundle("record-hash-mismatch", exportedRecord({ baseBundleHash: 'f'.repeat(64) }));

        const uploads: Uploads = [];
        await expect(runRelease(staged, { binaryBundlePath: baseBundlePath, uploads })).rejects.toThrow(
            /does not match the record exported next to it/,
        );

        expect(uploads).toEqual([]);
    });

    it("fails when the base bundle was exported from a different binary version", async () => {
        const staged = await stageBundleOutput("record-version-mismatch");
        const baseBundlePath = stageExportedBaseBundle("record-version-mismatch", exportedRecord({ binaryVersion: '1.0.0' }));

        const uploads: Uploads = [];
        await expect(runRelease(staged, { binaryBundlePath: baseBundlePath, uploads })).rejects.toThrow(
            new RegExp(`exported from binary version 1\\.0\\.0, but this release targets ${BINARY_VERSION}`),
        );

        expect(uploads).toEqual([]);
    });

    it.each([
        ['is not JSON at all', 'not json at all'],
        ['holds nothing to read a record out of', 'null'],
    ])("warns and releases when the record %s", async (caseName, contents) => {
        const staged = await stageBundleOutput("record-unreadable");
        const baseBundlePath = stageExportedBaseBundle(`record-unreadable-${caseName.replace(/\W+/g, '-')}`, contents);

        const { uploads } = await runRelease(staged, { binaryBundlePath: baseBundlePath });

        expect(logs.filter((line) => line.startsWith('warn:')).join('\n')).toMatch(/not a readable binary patch base record/);
        expect(uploads).toHaveLength(2);
    });

    it("warns and releases when the record leaves out the hash it is checked against", async () => {
        const staged = await stageBundleOutput("record-no-hash");
        const baseBundlePath = stageExportedBaseBundle("record-no-hash", JSON.stringify({ binaryVersion: '1.0.0' }));

        const { uploads } = await runRelease(staged, { binaryBundlePath: baseBundlePath });

        expect(logs.filter((line) => line.startsWith('warn:')).join('\n')).toMatch(/not a readable binary patch base record/);
        expect(uploads).toHaveLength(2);
    });

    it("releases exactly as before when the base bundle has no record beside it", async () => {
        const staged = await stageBundleOutput("record-absent");
        const baseBundlePath = stageExportedBaseBundle("record-absent");

        const { uploads } = await runRelease(staged, { binaryBundlePath: baseBundlePath });

        expect(uploads).toHaveLength(2);
        expect(logs.filter((line) => line.startsWith('warn:'))).toEqual([]);
    });
});

/**
 * A patch is only worth publishing when it is smaller than the archive it replaces. The
 * CLI runs unattended, so `--on-oversized-patch` decides what happens when it is not.
 *
 * An update whose bundle is a few bytes long produces one: the patch container and the
 * manifest that describes it together outweigh the whole full archive.
 */
describe("release --on-oversized-patch", () => {
    const tinyContents = () => ({ 'main.jsbundle': Buffer.from('tiny') });

    it("skips the patch by default and releases the full bundle alone", async () => {
        const staged = await stageBundleOutput("oversized-skip", tinyContents());

        const { uploads, releaseHistories } = await runRelease(staged, { binaryBundlePath: baseFixture });

        expect(uploads.map(({ filePath }) => path.basename(filePath))).toEqual([staged.bundleFileName]);
        expect(logs.filter((line) => line.startsWith('warn:')).join('\n')).toMatch(/not smaller than the full archive/);
        expect(logs.join('\n')).toContain('Patch skipped:');
        expect(releaseHistories[0][APP_VERSION].downloadUrl).toBe(uploads[0].downloadUrl);
        // Nothing was uploaded to patch from, so the entry must not point at one.
        expect(releaseHistories[0][APP_VERSION]).not.toHaveProperty('binaryPatchDownloadUrl');
    });

    it("fails before any upload when the policy is fail", async () => {
        const staged = await stageBundleOutput("oversized-fail", tinyContents());

        const uploads: Uploads = [];
        const history = historyStore();

        await expect(
            release(
                recordingUploader(uploads),
                history.getReleaseHistory,
                history.setReleaseHistory,
                BINARY_VERSION,
                APP_VERSION,
                undefined,
                'ios',
                undefined,
                staged.outputPath,
                'index.ts',
                undefined,
                false,
                true,
                undefined,
                true,
                true,
                staged.bundleDirectory,
                undefined,
                undefined,
                baseFixture,
                'fail',
            ),
        ).rejects.toThrow(/not smaller than the full archive/);

        expect(uploads).toEqual([]);
        expect(history.saved).toEqual([]);
        // The temp directories are still cleaned up on the way out.
        expect(fs.readdirSync(staged.outputPath)).toEqual([BUNDLE_OUTPUT_DIR_NAME]);
    });

    it("uploads a worthwhile patch even when the policy is fail", async () => {
        const staged = await stageBundleOutput("worthwhile-under-fail");

        const { uploads } = await runRelease(staged, {
            binaryBundlePath: baseFixture,
            onOversizedPatch: 'fail',
        });

        expect(uploads).toHaveLength(2);
    });
});

/**
 * A release can also ship a diff per recently released package: the patch archive without
 * the files that package already holds. The bases come out of the release history and are
 * downloaded through the consumer's `bundleDownloader`, so a release only builds diffs
 * where the consumer supplied one.
 */
describe("release with asset diff bases", () => {
    /**
     * The asset both packages hold. Sized like a real asset because a diff is only shipped
     * when it comes out smaller than the patch archive it was derived from.
     */
    const sharedAsset = crypto.randomBytes(4096);

    const PREVIOUS_APP_VERSION = '9.9.9';

    function updateFiles(): Record<string, Buffer | string> {
        return { 'main.jsbundle': fs.readFileSync(targetFixture), 'assets/keep.png': sharedAsset };
    }

    type StagedBaseRelease = { downloadUrl: string, packageHash: string, archivePath: string };

    /**
     * A package released earlier, as the history describes it and as the CDN serves it.
     *
     * @param ownAsset An asset only this release holds, which is what makes two staged base releases two packages rather than one.
     */
    async function stageBaseRelease(caseName: string, ownAsset?: string): Promise<StagedBaseRelease> {
        const caseDir = fs.mkdtempSync(path.join(workDir, `${caseName}-base-`));
        const contentsPath = path.join(caseDir, CONTENTS_DIR_NAME);
        const files: Record<string, Buffer | string> = {
            'main.jsbundle': fs.readFileSync(baseFixture),
            'assets/keep.png': sharedAsset,
            ...(ownAsset === undefined ? {} : { 'assets/dropped.png': ownAsset }),
        };

        for (const [relativePath, content] of Object.entries(files)) {
            const filePath = path.join(contentsPath, relativePath);
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, content);
        }

        const archiveDir = path.join(caseDir, 'archive');
        const { bundleFileName } = await makeCodePushBundle(contentsPath, archiveDir);

        return {
            downloadUrl: `https://cdn.example.com/released/${bundleFileName}`,
            packageHash: bundleFileName,
            archivePath: path.join(archiveDir, bundleFileName),
        };
    }

    function releaseHistoryOf(base: StagedBaseRelease, versions = [PREVIOUS_APP_VERSION]): ReleaseHistoryInterface {
        return Object.fromEntries(versions.map((version) => [
            version,
            {
                enabled: true,
                mandatory: false,
                downloadUrl: base.downloadUrl,
                packageHash: base.packageHash,
            },
        ]));
    }

    /** Serves the staged base archives, and records which releases were asked for. */
    function recordingDownloader(bases: StagedBaseRelease[], downloads: string[]): CliConfigInterface['bundleDownloader'] {
        return async (archive) => {
            downloads.push(archive.downloadUrl);
            const base = bases.find((candidate) => candidate.downloadUrl === archive.downloadUrl);
            if (!base) {
                throw new Error(`the downloader was called with an unexpected url: ${archive.downloadUrl}`);
            }
            return { downloadedFilePath: base.archivePath };
        };
    }

    it("publishes asset diff archives against recent releases and records them in the history", async () => {
        const staged = await stageBundleOutput("asset-diff", updateFiles());
        const base = await stageBaseRelease("asset-diff");
        const downloads: string[] = [];

        const { uploads, releaseHistories, uploadCountsWhenHistorySaved } = await runRelease(staged, {
            binaryBundlePath: baseFixture,
            releaseHistory: releaseHistoryOf(base),
            bundleDownloader: recordingDownloader([base], downloads),
        });

        const diffFileName = `${staged.bundleFileName}${ASSET_DIFF_ARCHIVE_INFIX}${base.packageHash}.zip`;
        // The diff is the last artifact: it is an optimisation on top of the patch, which
        // is itself an optimisation on top of the full archive.
        expect(uploads.map(({ filePath }) => path.basename(filePath))).toEqual([
            staged.bundleFileName,
            `${staged.bundleFileName}${BINARY_PATCH_ARCHIVE_SUFFIX}`,
            diffFileName,
        ]);
        expect(uploads.map(({ artifact }) => artifact)).toEqual([
            {
                type: 'full-bundle',
                targetBinaryVersion: BINARY_VERSION,
                packageHash: staged.bundleFileName,
            },
            {
                type: 'binary-patch',
                targetBinaryVersion: BINARY_VERSION,
                packageHash: staged.bundleFileName,
            },
            {
                type: 'asset-diff',
                targetBinaryVersion: BINARY_VERSION,
                packageHash: staged.bundleFileName,
                basePackageHash: base.packageHash,
            },
        ]);
        expect(downloads).toEqual([base.downloadUrl]);
        // Every artifact is uploaded before the history points at any of them.
        expect(uploadCountsWhenHistorySaved).toEqual([3]);
        expect(releaseHistories[0][APP_VERSION].diffPackages).toEqual({
            [base.packageHash]: uploads[2].downloadUrl,
        });
        expect(fs.existsSync(path.join(staged.bundleDirectory, diffFileName))).toBe(true);
    });

    it("publishes without diff archives when the config has no bundle downloader", async () => {
        const staged = await stageBundleOutput("no-downloader", updateFiles());
        const base = await stageBaseRelease("no-downloader");

        const { uploads, releaseHistories } = await runRelease(staged, {
            binaryBundlePath: baseFixture,
            releaseHistory: releaseHistoryOf(base),
        });

        expect(uploads).toHaveLength(2);
        // A release without diffs says nothing about them, so a client reading this history
        // behaves exactly as it did before asset diffs existed.
        expect(releaseHistories[0][APP_VERSION]).not.toHaveProperty('diffPackages');
    });

    it("publishes without diff archives when --diff-base-count is zero", async () => {
        const staged = await stageBundleOutput("zero-bases", updateFiles());
        const base = await stageBaseRelease("zero-bases");
        const downloads: string[] = [];

        const { uploads, releaseHistories } = await runRelease(staged, {
            binaryBundlePath: baseFixture,
            releaseHistory: releaseHistoryOf(base),
            bundleDownloader: recordingDownloader([base], downloads),
            diffBaseCount: 0,
        });

        expect(uploads).toHaveLength(2);
        expect(downloads).toEqual([]);
        expect(releaseHistories[0][APP_VERSION]).not.toHaveProperty('diffPackages');
    });

    it("builds one diff archive when two releases hold the same package", async () => {
        const staged = await stageBundleOutput("repeated-base", updateFiles());
        const base = await stageBaseRelease("repeated-base");
        const downloads: string[] = [];

        const { uploads, releaseHistories } = await runRelease(staged, {
            binaryBundlePath: baseFixture,
            releaseHistory: releaseHistoryOf(base, ['9.9.8', PREVIOUS_APP_VERSION]),
            bundleDownloader: recordingDownloader([base], downloads),
        });

        expect(downloads).toHaveLength(2);
        expect(uploads.filter(({ filePath }) => filePath.includes(ASSET_DIFF_ARCHIVE_INFIX))).toHaveLength(1);
        expect(releaseHistories[0][APP_VERSION].diffPackages).toEqual({
            [base.packageHash]: uploads[2].downloadUrl,
        });
    });

    it("releases the diffs that uploaded when one of them is rejected", async () => {
        const staged = await stageBundleOutput("diff-upload-failure", updateFiles());
        // Two packages to diff against, one of whose diffs the storage backend refuses.
        const rejected = await stageBaseRelease("diff-upload-failure-rejected");
        const kept = await stageBaseRelease("diff-upload-failure-kept", 'an asset of the older release');
        const downloads: string[] = [];

        const { uploads, releaseHistories } = await runRelease(staged, {
            binaryBundlePath: baseFixture,
            releaseHistory: {
                ...releaseHistoryOf(kept, ['9.9.8']),
                ...releaseHistoryOf(rejected, [PREVIOUS_APP_VERSION]),
            },
            bundleDownloader: recordingDownloader([kept, rejected], downloads),
            uploadFailsFor: (filePath) => filePath.includes(rejected.packageHash),
        });

        expect(uploads.map(({ filePath }) => path.basename(filePath))).toEqual([
            staged.bundleFileName,
            `${staged.bundleFileName}${BINARY_PATCH_ARCHIVE_SUFFIX}`,
            `${staged.bundleFileName}${ASSET_DIFF_ARCHIVE_INFIX}${kept.packageHash}.zip`,
        ]);
        // The release goes out with the two artifacts it needs, and describes only the diff
        // a client can actually download.
        expect(releaseHistories[0][APP_VERSION].diffPackages).toEqual({
            [kept.packageHash]: uploads[2].downloadUrl,
        });
        expect(logs.filter((line) => line.startsWith('warn:')).join('\n')).toMatch(
            new RegExp(`Skipping the asset diff archive against ${rejected.packageHash}`),
        );
    });

    it("still picks the full bundle when diff archives sit in the output directory", async () => {
        const staged = await stageBundleOutput("leftover-diff");
        fs.writeFileSync(path.join(staged.bundleDirectory, assetDiffArchiveName('stale', 'stale-base')), 'stale');

        const { uploads } = await runRelease(staged, { binaryBundlePath: baseFixture });

        expect(path.basename(uploads[0].filePath)).toBe(staged.bundleFileName);
    });
});
