import { spawnSync } from "child_process";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { applyPatch, generatePatch, resolveBinaryPatchTool } from "./binaryPatch.js";

/**
 * Locks the binary patch codec contract: which bytes a patch restores, and which
 * kinds of broken input the appliers do and do not catch.
 *
 * Everything here runs against real binaries and real bytes - hdiffz/hpatchz and a
 * host build of the native applier - because the whole point is to prove that the
 * committed patch format really is what every applier understands.
 */

/** Building the applier from source takes a while on a cold machine. */
const BUILD_APPLIER_TIMEOUT_MS = 5 * 60 * 1000;

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
const patchFixture = path.join(fixtureDir, "update.patch");
/**
 * One shared tree builds the applier for both platforms: iOS pulls it in through the
 * podspec at the repository root, Android through externalNativeBuild.
 */
const applierDir = path.join(repoRoot, "cpp", "binarypatch");

let workDir: string;

function sha256(filePath: string): string {
    return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function workPath(name: string): string {
    return path.join(workDir, name);
}

/** Writes a copy of `sourcePath` with `mutate` applied to its bytes. */
function writeMutatedCopy(sourcePath: string, name: string, mutate: (bytes: Buffer) => Buffer): string {
    const destination = workPath(name);
    fs.writeFileSync(destination, mutate(fs.readFileSync(sourcePath)));
    return destination;
}

function cCompiler(): string {
    return process.env.CC || "cc";
}

function hasCCompiler(): boolean {
    return spawnSync(cCompiler(), ["--version"], { stdio: "ignore" }).status === 0;
}

beforeAll(() => {
    // hdiffz/hpatchz are provisioned for the whole run by the jest global setup.
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "codepush-binary-patch-"));
});

afterAll(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
});

describe("generatePatch/applyPatch", () => {
    it("restores the target bytes from a freshly generated patch", () => {
        const generatedPatch = workPath("generated.patch");
        const restored = workPath("restored-from-generated.bundle");

        generatePatch(baseFixture, targetFixture, generatedPatch);
        applyPatch(baseFixture, generatedPatch, restored);

        expect(fs.statSync(generatedPatch).size).toBeGreaterThan(0);
        expect(sha256(restored)).toBe(sha256(targetFixture));
    });

    it("restores the target bytes from the committed patch fixture", () => {
        const restored = workPath("restored-from-fixture.bundle");

        applyPatch(baseFixture, patchFixture, restored);

        expect(sha256(restored)).toBe(sha256(targetFixture));
    });

    it("reports a missing patch tool with a message that says how to get it", () => {
        const previous = process.env.HDIFFPATCH_TOOLS_DIR;
        process.env.HDIFFPATCH_TOOLS_DIR = workPath("no-such-dir");
        try {
            expect(() => resolveBinaryPatchTool("hdiffz")).toThrow(/npx code-push build-patch-tools/);
        } finally {
            if (previous === undefined) {
                delete process.env.HDIFFPATCH_TOOLS_DIR;
            } else {
                process.env.HDIFFPATCH_TOOLS_DIR = previous;
            }
        }
    });
});

describe("applyPatch failure modes", () => {
    it("fails on a patch with a corrupted header", () => {
        const corrupted = writeMutatedCopy(patchFixture, "corrupt-header.patch", (bytes) => {
            // Byte 0 is inside the patch type string, which the header parser reads first.
            bytes[0] ^= 0xff;
            return bytes;
        });

        expect(() => applyPatch(baseFixture, corrupted, workPath("out-corrupt-header.bundle"))).toThrow(/hpatchz/);
    });

    it("fails on a truncated patch", () => {
        const truncated = writeMutatedCopy(patchFixture, "truncated.patch", (bytes) =>
            bytes.subarray(0, Math.floor(bytes.length / 2)),
        );

        expect(() => applyPatch(baseFixture, truncated, workPath("out-truncated.bundle"))).toThrow(/hpatchz/);
    });
});

/**
 * A compressed diff carries no checksum of the base data, and the zstd streams
 * inside it are written without content checksums, so an applier cannot tell every
 * kind of wrong input apart from a legitimate one. These tests pin that down: the
 * apply step may report success, but it never produces the target bytes. Callers
 * must therefore verify the base and target hashes themselves rather than treating
 * a successful apply as proof of a correct result.
 */
describe("errors the codec cannot detect", () => {
    it("never produces the target bytes when a byte inside the compressed diff data is corrupted", () => {
        const corrupted = writeMutatedCopy(patchFixture, "corrupt-body.patch", (bytes) => {
            bytes[Math.floor(bytes.length / 2)] ^= 0xff;
            return bytes;
        });
        const restored = workPath("out-corrupt-body.bundle");

        // Whether the corruption is reported depends on where it lands: a flipped bit
        // inside a zstd literals block decodes to different bytes without any error,
        // while one that invalidates a block header does fail. Either way the result
        // is not the target, which is all the caller can rely on.
        let restoredHash: string | null = null;
        try {
            applyPatch(baseFixture, corrupted, restored);
            restoredHash = sha256(restored);
        } catch {
            restoredHash = null;
        }

        expect(restoredHash).not.toBe(sha256(targetFixture));
    });

    it("applies but produces wrong bytes when the base has the expected size and different content", () => {
        const wrongBase = writeMutatedCopy(baseFixture, "wrong-base.bundle", (bytes) => {
            bytes[1000] ^= 0xff;
            return bytes;
        });
        const restored = workPath("out-wrong-base.bundle");

        applyPatch(wrongBase, patchFixture, restored);

        expect(fs.statSync(wrongBase).size).toBe(fs.statSync(baseFixture).size);
        expect(sha256(restored)).not.toBe(sha256(targetFixture));
    });
});

/**
 * The native appliers on Android and iOS are built from the vendored sources, so a
 * host build of the same sources is what proves they agree with hdiffz/hpatchz.
 */
const describeNativeApplier = hasCCompiler() ? describe : describe.skip;

describeNativeApplier("host build of the native applier", () => {
    let hostApplier: string;

    const runHostApplier = (oldPath: string, patch: string, outPath: string): number | null => {
        const result = spawnSync(hostApplier, [oldPath, patch, outPath], { encoding: "utf8" });
        return result.status;
    };

    beforeAll(() => {
        hostApplier = workPath("apply_patch_host");
        const script = path.join(applierDir, "host", "build.sh");
        const result = spawnSync(script, [hostApplier], { encoding: "utf8", timeout: BUILD_APPLIER_TIMEOUT_MS });
        if (result.status !== 0) {
            throw new Error(`${script} failed:\n${result.stdout ?? ""}${result.stderr ?? ""}`);
        }
    }, BUILD_APPLIER_TIMEOUT_MS);

    it("restores the same target bytes as the CLI applier", () => {
        const restored = workPath("out-host.bundle");

        expect(runHostApplier(baseFixture, patchFixture, restored)).toBe(0);
        expect(sha256(restored)).toBe(sha256(targetFixture));
    });

    it("reports a corrupted patch header as exit code 3", () => {
        const corrupted = writeMutatedCopy(patchFixture, "host-corrupt-header.patch", (bytes) => {
            bytes[0] ^= 0xff;
            return bytes;
        });

        expect(runHostApplier(baseFixture, corrupted, workPath("out-host-corrupt-header.bundle"))).toBe(3);
    });

    it("reports a base of unexpected size as exit code 5", () => {
        const shortBase = writeMutatedCopy(baseFixture, "host-short-base.bundle", (bytes) =>
            bytes.subarray(0, bytes.length - 16),
        );

        expect(runHostApplier(shortBase, patchFixture, workPath("out-host-short-base.bundle"))).toBe(5);
    });

    it("reports a truncated patch as exit code 6", () => {
        const truncated = writeMutatedCopy(patchFixture, "host-truncated.patch", (bytes) =>
            bytes.subarray(0, Math.floor(bytes.length / 2)),
        );

        expect(runHostApplier(baseFixture, truncated, workPath("out-host-truncated.bundle"))).toBe(6);
    });
});
