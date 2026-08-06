import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from "@jest/globals";
import {
    BINARY_PATCH_ARCHIVE_SUFFIX,
    BINARY_PATCH_BASE_RECORD_NAME,
    BINARY_PATCH_MANIFEST_NAME,
    extractCodePushBundleContents,
    formatBinaryPatchSummary,
    isPatchArchiveOversized,
    makeBinaryPatchBundle,
    readBinaryPatchBaseRecord,
    resolveBaseBundlePath,
    writeBinaryPatchBaseRecord,
} from "./makeBinaryPatchBundle.js";
import { makeCodePushBundle } from "./makeCodePushBundle.js";
import { applyPatch, BINARY_PATCH_ALGORITHM, BINARY_PATCH_FORMAT_VERSION } from "../utils/binaryPatch.js";
import { generatePackageHashFromDirectory } from "../utils/hash-utils.js";
import { unzip } from "../utils/unzip.js";

/**
 * Exercises the patch artifact against real archives, real hdiffz output and real
 * hashes: the artifact only has value if a client can rebuild the exact contents of
 * the full archive from it, and only real bytes prove that.
 */

/** The directory a CodePush archive keeps its contents in, for legacy reasons. */
const CONTENTS_DIR_NAME = 'CodePush';

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

function sha256(filePath: string): string {
    return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

/** A unique directory per test so a failed run never leaks state into the next one. */
function makeCaseDir(name: string): string {
    const caseDir = fs.mkdtempSync(path.join(workDir, `${name}-`));
    return caseDir;
}

/**
 * Writes an update contents directory shaped like the one the bundler produces: the
 * JS bundle next to the assets that ship with it.
 */
function writeUpdateContents(caseDir: string, files: Record<string, Buffer | string>): string {
    const contentsPath = path.join(caseDir, CONTENTS_DIR_NAME);
    for (const [relativePath, content] of Object.entries(files)) {
        const filePath = path.join(contentsPath, relativePath);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content);
    }
    return contentsPath;
}

function defaultContents(caseDir: string, bundleName = 'main.jsbundle'): string {
    return writeUpdateContents(caseDir, {
        [bundleName]: fs.readFileSync(targetFixture),
        'assets/logo.png': Buffer.from('logo-bytes'),
    });
}

async function unzipTo(archivePath: string, destination: string): Promise<string> {
    fs.mkdirSync(destination, { recursive: true });
    await unzip(archivePath, destination);
    return path.join(destination, CONTENTS_DIR_NAME);
}

beforeAll(() => {
    // hdiffz/hpatchz are provisioned for the whole run by the jest global setup.
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "codepush-patch-bundle-"));
});

afterAll(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe("resolveBaseBundlePath", () => {
    it("returns an absolute path for an existing file", () => {
        expect(resolveBaseBundlePath(path.relative(process.cwd(), baseFixture))).toBe(baseFixture);
    });

    it("fails with a message naming the option when the file does not exist", () => {
        const missing = path.join(makeCaseDir("missing-base"), "no-such.bundle");

        expect(() => resolveBaseBundlePath(missing)).toThrow(/--binary-bundle-path/);
        expect(() => resolveBaseBundlePath(missing)).toThrow(/does not exist/);
    });

    it("fails when the path is a directory", () => {
        expect(() => resolveBaseBundlePath(fixtureDir)).toThrow(/is not a file/);
    });
});

describe("makeBinaryPatchBundle", () => {
    it("writes a patch archive next to the full archive, named after the package hash", async () => {
        const caseDir = makeCaseDir("names");
        const contentsPath = defaultContents(caseDir);
        const bundleDirectory = path.join(caseDir, "bundleOutput");
        const { bundleFileName: packageHash } = await makeCodePushBundle(contentsPath, bundleDirectory);

        const { patchBundleFilePath } = await makeBinaryPatchBundle({
            contentsPath,
            baseBundlePath: baseFixture,
            bundleRelativePath: 'main.jsbundle',
            bundleDirectory,
            packageHash,
        });

        expect(path.basename(patchBundleFilePath)).toBe(`${packageHash}${BINARY_PATCH_ARCHIVE_SUFFIX}`);
        expect(fs.existsSync(patchBundleFilePath)).toBe(true);
        // The full archive stays exactly as it was uploaded before patches existed.
        expect(fs.readdirSync(bundleDirectory).sort()).toEqual(
            [packageHash, `${packageHash}${BINARY_PATCH_ARCHIVE_SUFFIX}`].sort(),
        );
    });

    it("pins the manifest to the codec contract and to the target bundle it describes", async () => {
        const caseDir = makeCaseDir("manifest");
        const contentsPath = defaultContents(caseDir);
        const bundleDirectory = path.join(caseDir, "bundleOutput");

        const { patchBundleFilePath, manifest } = await makeBinaryPatchBundle({
            contentsPath,
            baseBundlePath: baseFixture,
            bundleRelativePath: 'main.jsbundle',
            bundleDirectory,
            packageHash: 'package-hash',
        });

        expect(manifest).toEqual({
            formatVersion: BINARY_PATCH_FORMAT_VERSION,
            algorithm: BINARY_PATCH_ALGORITHM,
            bundlePath: 'main.jsbundle',
            patchFile: 'main.jsbundle.patch',
            baseBundleHash: sha256(baseFixture),
            targetBundleHash: sha256(targetFixture),
            targetBundleSize: fs.statSync(targetFixture).size,
        });

        const extracted = await unzipTo(patchBundleFilePath, path.join(caseDir, "extracted"));
        expect(JSON.parse(fs.readFileSync(path.join(extracted, BINARY_PATCH_MANIFEST_NAME), 'utf8'))).toEqual(manifest);
    });

    it("replaces the target bundle with its patch and keeps every other file", async () => {
        const caseDir = makeCaseDir("layout");
        const contentsPath = defaultContents(caseDir);
        const bundleDirectory = path.join(caseDir, "bundleOutput");

        const { patchBundleFilePath } = await makeBinaryPatchBundle({
            contentsPath,
            baseBundlePath: baseFixture,
            bundleRelativePath: 'main.jsbundle',
            bundleDirectory,
            packageHash: 'package-hash',
        });

        const extracted = await unzipTo(patchBundleFilePath, path.join(caseDir, "extracted"));
        expect(fs.existsSync(path.join(extracted, 'main.jsbundle'))).toBe(false);
        expect(fs.existsSync(path.join(extracted, 'main.jsbundle.patch'))).toBe(true);
        expect(fs.readFileSync(path.join(extracted, 'assets/logo.png'), 'utf8')).toBe('logo-bytes');
    });

    it("restores the exact package hash of the full archive from the patch archive", async () => {
        const caseDir = makeCaseDir("round-trip");
        const contentsPath = defaultContents(caseDir);
        const bundleDirectory = path.join(caseDir, "bundleOutput");
        const { bundleFileName: packageHash } = await makeCodePushBundle(contentsPath, bundleDirectory);

        const { patchBundleFilePath, manifest } = await makeBinaryPatchBundle({
            contentsPath,
            baseBundlePath: baseFixture,
            bundleRelativePath: 'main.jsbundle',
            bundleDirectory,
            packageHash,
        });

        // Replay what a client does: apply the patch onto the bundle from the binary,
        // then drop the patch artifacts that are not part of the update contents.
        const extractRoot = path.join(caseDir, "extracted");
        const extracted = await unzipTo(patchBundleFilePath, extractRoot);
        applyPatch(baseFixture, path.join(extracted, manifest.patchFile), path.join(extracted, manifest.bundlePath));
        fs.rmSync(path.join(extracted, manifest.patchFile));
        fs.rmSync(path.join(extracted, BINARY_PATCH_MANIFEST_NAME));

        expect(sha256(path.join(extracted, manifest.bundlePath))).toBe(sha256(targetFixture));
        expect(await generatePackageHashFromDirectory(extracted, extractRoot)).toBe(packageHash);
    });

    it("patches only the bundle named by the caller, leaving another platform's bundle untouched", async () => {
        const caseDir = makeCaseDir("android");
        const contentsPath = writeUpdateContents(caseDir, {
            'index.android.bundle': fs.readFileSync(targetFixture),
            'main.jsbundle': Buffer.from('ios-bundle-bytes'),
        });
        const bundleDirectory = path.join(caseDir, "bundleOutput");

        const { patchBundleFilePath, manifest } = await makeBinaryPatchBundle({
            contentsPath,
            baseBundlePath: baseFixture,
            bundleRelativePath: 'index.android.bundle',
            bundleDirectory,
            packageHash: 'package-hash',
        });

        expect(manifest.bundlePath).toBe('index.android.bundle');
        expect(manifest.patchFile).toBe('index.android.bundle.patch');

        const extracted = await unzipTo(patchBundleFilePath, path.join(caseDir, "extracted"));
        expect(fs.existsSync(path.join(extracted, 'index.android.bundle'))).toBe(false);
        expect(fs.readFileSync(path.join(extracted, 'main.jsbundle'), 'utf8')).toBe('ios-bundle-bytes');
    });

    it("warns when the base and the target bundle are the same bytes", async () => {
        const caseDir = makeCaseDir("identical");
        const contentsPath = writeUpdateContents(caseDir, { 'main.jsbundle': fs.readFileSync(baseFixture) });
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

        await makeBinaryPatchBundle({
            contentsPath,
            baseBundlePath: baseFixture,
            bundleRelativePath: 'main.jsbundle',
            bundleDirectory: path.join(caseDir, "bundleOutput"),
            packageHash: 'package-hash',
        });

        expect(warn.mock.calls.join('\n')).toMatch(/identical/);
    });

    it("fails with an actionable error when the target bundle is not in the contents", async () => {
        const caseDir = makeCaseDir("no-target");
        const contentsPath = writeUpdateContents(caseDir, { 'index.android.bundle': Buffer.from('android') });

        await expect(
            makeBinaryPatchBundle({
                contentsPath,
                baseBundlePath: baseFixture,
                bundleRelativePath: 'main.jsbundle',
                bundleDirectory: path.join(caseDir, "bundleOutput"),
                packageHash: 'package-hash',
            }),
        ).rejects.toThrow(/main\.jsbundle.*--js-bundle-name/s);
    });

    it("leaves no working directory behind, whether it succeeds or fails", async () => {
        const caseDir = makeCaseDir("cleanup");
        const contentsPath = defaultContents(caseDir);
        const bundleDirectory = path.join(caseDir, "bundleOutput");
        const entriesBefore = fs.readdirSync(caseDir).sort();

        await makeBinaryPatchBundle({
            contentsPath,
            baseBundlePath: baseFixture,
            bundleRelativePath: 'main.jsbundle',
            bundleDirectory,
            packageHash: 'package-hash',
        });

        expect(fs.readdirSync(caseDir).sort()).toEqual([...entriesBefore, 'bundleOutput'].sort());

        await expect(
            makeBinaryPatchBundle({
                contentsPath,
                baseBundlePath: path.join(caseDir, 'no-such-base.bundle'),
                bundleRelativePath: 'main.jsbundle',
                bundleDirectory,
                packageHash: 'package-hash',
            }),
        ).rejects.toThrow();

        expect(fs.readdirSync(caseDir).sort()).toEqual([...entriesBefore, 'bundleOutput'].sort());
    });
});

describe("binary patch base record", () => {
    it("is written outside the update contents, so it cannot change the package hash", async () => {
        const caseDir = makeCaseDir("record");
        const contentsPath = defaultContents(caseDir);
        const hashBefore = await generatePackageHashFromDirectory(contentsPath, caseDir);

        const recordPath = writeBinaryPatchBaseRecord(caseDir, sha256(baseFixture));

        expect(path.relative(contentsPath, recordPath).startsWith('..')).toBe(true);
        expect(path.basename(recordPath)).toBe(BINARY_PATCH_BASE_RECORD_NAME);
        expect(await generatePackageHashFromDirectory(contentsPath, caseDir)).toBe(hashBefore);
        expect(readBinaryPatchBaseRecord(caseDir)).toEqual({ baseBundleHash: sha256(baseFixture) });
    });

    it("reads as absent when there is no record or the record is unreadable", () => {
        const caseDir = makeCaseDir("record-missing");

        expect(readBinaryPatchBaseRecord(caseDir)).toBeNull();

        fs.writeFileSync(path.join(caseDir, BINARY_PATCH_BASE_RECORD_NAME), 'not json');
        expect(readBinaryPatchBaseRecord(caseDir)).toBeNull();
    });
});

describe("extractCodePushBundleContents", () => {
    it("unpacks the contents of an already built bundle file so a patch can be built from it", async () => {
        const caseDir = makeCaseDir("extract");
        const contentsPath = defaultContents(caseDir);
        const bundleDirectory = path.join(caseDir, "bundleOutput");
        const { bundleFileName } = await makeCodePushBundle(contentsPath, bundleDirectory);

        const { extractDir, contentsPath: extractedContents } = await extractCodePushBundleContents(
            path.join(bundleDirectory, bundleFileName),
            caseDir,
        );

        expect(await generatePackageHashFromDirectory(extractedContents, path.dirname(extractedContents))).toBe(bundleFileName);
        expect(fs.existsSync(path.join(extractedContents, 'main.jsbundle'))).toBe(true);

        fs.rmSync(extractDir, { recursive: true, force: true });
    });
});

describe("isPatchArchiveOversized", () => {
    it("keeps a patch that is smaller than the full archive", () => {
        expect(isPatchArchiveOversized(100, 99)).toBe(false);
    });

    it("rejects a patch of exactly the same size, which saves a client nothing", () => {
        expect(isPatchArchiveOversized(100, 100)).toBe(true);
    });

    it("rejects a patch that is larger than the full archive", () => {
        expect(isPatchArchiveOversized(100, 101)).toBe(true);
    });
});

describe("formatBinaryPatchSummary", () => {
    it("reports both archive sizes and what the patch saves", () => {
        const baseBundleHash = 'a'.repeat(64);
        const targetBundleHash = 'b'.repeat(64);

        const summary = formatBinaryPatchSummary({
            platform: 'ios',
            baseBundleHash,
            targetBundleHash,
            fullArchiveSize: 19_293_798,
            patchArchiveSize: 3_250_586,
        });

        expect(summary).toBe(
            [
                'Binary patch summary (ios)',
                `Base bundle SHA-256:   ${baseBundleHash}`,
                `Target bundle SHA-256: ${targetBundleHash}`,
                'Full archive:          18.4 MB',
                'Patch archive:          3.1 MB',
                'Saved:                 15.3 MB (83.2%)',
            ].join('\n'),
        );
    });

    it("reports a negative saving when the patch is larger than the full archive", () => {
        const summary = formatBinaryPatchSummary({
            platform: 'android',
            baseBundleHash: 'a'.repeat(64),
            targetBundleHash: 'b'.repeat(64),
            fullArchiveSize: 1_000,
            patchArchiveSize: 1_500,
        });

        expect(summary).toContain('Binary patch summary (android)');
        expect(summary).toContain('Saved:                 -500 B (-50.0%)');
        expect(summary).not.toContain('Patch skipped:');
    });

    it("states that the patch was skipped, and why, when it is not being released", () => {
        const summary = formatBinaryPatchSummary({
            platform: 'android',
            baseBundleHash: 'a'.repeat(64),
            targetBundleHash: 'b'.repeat(64),
            fullArchiveSize: 1_000,
            patchArchiveSize: 1_500,
            patchSkipped: true,
        });

        expect(summary.split('\n').at(-1)).toBe(
            'Patch skipped:         not smaller than the full archive; releasing the full bundle only (--on-oversized-patch skip)',
        );
    });
});
