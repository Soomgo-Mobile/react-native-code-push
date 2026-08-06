import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { release } from "./release.js";
import { makeCodePushBundle } from "../../functions/makeCodePushBundle.js";
import {
    BINARY_PATCH_ARCHIVE_SUFFIX,
    BINARY_PATCH_MANIFEST_NAME,
    hashBundleFile,
    writeBinaryPatchBaseRecord,
    type OversizedPatchPolicy,
} from "../../functions/makeBinaryPatchBundle.js";
import { applyPatch } from "../../utils/binaryPatch.js";
import { generatePackageHashFromDirectory } from "../../utils/hash-utils.js";
import { unzip } from "../../utils/unzip.js";
import type { ReleaseHistoryInterface } from "../../../typings/react-native-code-push.d.ts";

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

type Uploads = { filePath: string, downloadUrl: string, logCountBeforeUpload: number }[];

function recordingUploader(uploads: Uploads, failOn?: (filePath: string) => boolean) {
    return async (filePath: string) => {
        if (failOn?.(filePath)) {
            throw new Error(`upload rejected: ${path.basename(filePath)}`);
        }
        const downloadUrl = `https://cdn.example.com/${path.basename(filePath)}`;
        uploads.push({ filePath, downloadUrl, logCountBeforeUpload: logs.length });
        return { downloadUrl };
    };
}

function historyStore() {
    const saved: ReleaseHistoryInterface[] = [];
    return {
        saved,
        getReleaseHistory: async () => ({}) as ReleaseHistoryInterface,
        setReleaseHistory: async (
            _binaryVersion: string,
            _jsonFilePath: string,
            releaseInfo: ReleaseHistoryInterface,
        ) => {
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
};

async function runRelease(staged: StagedBundle, overrides: ReleaseOverrides = {}) {
    const uploads: Uploads = [];
    const history = historyStore();

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
    );

    return { uploads, releaseHistories: history.saved };
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
    it("uploads the full bundle only, exactly as before binary patches existed", async () => {
        const staged = await stageBundleOutput("full-only");

        const { uploads, releaseHistories } = await runRelease(staged);

        expect(uploads).toHaveLength(1);
        expect(uploads[0].filePath).toBe(`${staged.bundleDirectory}/${staged.bundleFileName}`);
        expect(fs.readdirSync(staged.bundleDirectory)).toEqual([staged.bundleFileName]);
        expect(releaseHistories[0][APP_VERSION]).toEqual({
            enabled: true,
            mandatory: false,
            downloadUrl: uploads[0].downloadUrl,
            packageHash: staged.bundleFileName,
        });
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

        // Carrying the patch URL in the release history is a separate concern; for now
        // the history keeps describing the full bundle only.
        expect(releaseHistories[0][APP_VERSION].downloadUrl).toBe(uploads[0].downloadUrl);
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
