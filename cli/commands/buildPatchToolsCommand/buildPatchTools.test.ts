import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { buildPatchTools } from "./buildPatchTools.js";

/**
 * The command is a thin wrapper around the build script this package ships. What it has
 * to get right is what it hands the script: the directory the CLI will later look in, and
 * `--force` when asked. A script that records what it was handed proves both without
 * cloning and compiling HDiffPatch. The shipped script is run once at the end, against an
 * install it already finds complete, to show the wrapper speaks its actual interface.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SHIPPED_BUILD_SCRIPT = path.join(REPO_ROOT, "scripts", "binary-patch", "build-hdiffpatch.sh");
/** Where `jest.globalSetup.ts` built the tools for this run. */
const INSTALLED_TOOLS_DIR = process.env.HDIFFPATCH_TOOLS_DIR ?? path.join(REPO_ROOT, ".hdiffpatch-tools");

let workDir: string;

beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "build-patch-tools-"));
});

afterEach(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
});

function writeScript(body: string): string {
    const scriptPath = path.join(workDir, "build.sh");
    fs.writeFileSync(scriptPath, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    return scriptPath;
}

/** A script that writes the install directory it was given, then each argument, one per line. */
function writeRecordingScript(): string {
    return writeScript('printf \'%s\\n\' "$HDIFFPATCH_TOOLS_DIR" "$@" > "$HDIFFPATCH_TOOLS_DIR/invocation"');
}

function readInvocation(toolsDir: string): string[] {
    return fs.readFileSync(path.join(toolsDir, "invocation"), "utf8").trimEnd().split("\n");
}

describe("buildPatchTools", () => {
    it("runs the build script against the tools directory it was given, without forcing a rebuild", () => {
        const toolsDir = path.join(workDir, "tools");
        fs.mkdirSync(toolsDir);

        buildPatchTools({ buildScriptPath: writeRecordingScript(), toolsDir, force: false });

        expect(readInvocation(toolsDir)).toEqual([toolsDir]);
    });

    it("asks the build script to rebuild when forced", () => {
        const toolsDir = path.join(workDir, "tools");
        fs.mkdirSync(toolsDir);

        buildPatchTools({ buildScriptPath: writeRecordingScript(), toolsDir, force: true });

        expect(readInvocation(toolsDir)).toEqual([toolsDir, "--force"]);
    });

    it("fails with the exit code when the build script fails", () => {
        const buildScriptPath = writeScript("exit 3");

        expect(() => buildPatchTools({ buildScriptPath, toolsDir: workDir, force: false })).toThrow(/exit code 3/);
    });

    it("fails naming the script when it cannot be started", () => {
        const buildScriptPath = path.join(workDir, "no-such-script.sh");

        expect(() => buildPatchTools({ buildScriptPath, toolsDir: workDir, force: false })).toThrow(
            /no-such-script\.sh/,
        );
    });

    it("succeeds against an install the shipped script already finds complete", () => {
        expect(() =>
            buildPatchTools({ buildScriptPath: SHIPPED_BUILD_SCRIPT, toolsDir: INSTALLED_TOOLS_DIR, force: false }),
        ).not.toThrow();
    });
});
