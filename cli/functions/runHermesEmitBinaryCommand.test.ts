import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from "@jest/globals";
import {
    helpOutputSupportsBaseBytecode,
    resolveBaseBytecodeHermesFlags,
} from "./runHermesEmitBinaryCommand.js";

/**
 * The base bytecode flag only exists in recent Hermes compilers, and the compiler that
 * matters is the one inside the app being released - so the flag is decided by asking
 * that binary, not by a version check.
 */

/** Excerpt of `hermesc --help` from a compiler that has the flag. */
const HELP_WITH_BASE_BYTECODE = `OVERVIEW: Hermes driver

USAGE: hermesc [options] <input>

OPTIONS:
  -Wno-direct-eval                   - Disable Warning when attempting a direct (local) eval
  -base-bytecode=<string>            - input base bytecode for delta optimizing mode
  -bytecode-output-manifest=<string> - Name of the manifest file generated when compiling multiple segments to bytecode
  -commonjs                          - Use CommonJS modules
`;

/** The same excerpt from a compiler that predates the flag. */
const HELP_WITHOUT_BASE_BYTECODE = `OVERVIEW: Hermes driver

USAGE: hermesc [options] <input>

OPTIONS:
  -Wno-direct-eval                   - Disable Warning when attempting a direct (local) eval
  -bytecode-output-manifest=<string> - Name of the manifest file generated when compiling multiple segments to bytecode
  -commonjs                          - Use CommonJS modules
`;

function findRepoRoot(): string {
    let dir = process.cwd();
    for (;;) {
        if (fs.existsSync(path.join(dir, "node_modules", "react-native"))) {
            return dir;
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            throw new Error(`cannot locate the repository root from ${process.cwd()}`);
        }
        dir = parent;
    }
}

function hermesOSBinDirName(): string {
    switch (process.platform) {
        case 'win32':
            return 'win64-bin';
        case 'darwin':
            return 'osx-bin';
        default:
            return 'linux64-bin';
    }
}

const repoRoot = findRepoRoot();
const baseBundlePath = path.join(repoRoot, "cli", "fixtures", "binary-patch", "base.bundle");

let workDir: string;

/** A project whose Hermes compiler reports a help text without the flag. */
function writeProjectWithFakeHermesc(helpOutput: string): string {
    const projectRoot = fs.mkdtempSync(path.join(workDir, "project-"));
    const hermescDir = path.join(projectRoot, "node_modules", "react-native", "sdks", "hermesc", hermesOSBinDirName());

    fs.mkdirSync(hermescDir, { recursive: true });
    const hermescPath = path.join(hermescDir, "hermesc");
    fs.writeFileSync(hermescPath, `#!/bin/sh\ncat <<'HELP'\n${helpOutput}HELP\n`);
    fs.chmodSync(hermescPath, 0o755);

    return projectRoot;
}

beforeAll(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "codepush-hermes-flags-"));
});

afterAll(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe("helpOutputSupportsBaseBytecode", () => {
    it("detects the flag in the help output of a compiler that has it", () => {
        expect(helpOutputSupportsBaseBytecode(HELP_WITH_BASE_BYTECODE)).toBe(true);
    });

    it("reports no support when the help output does not list the flag", () => {
        expect(helpOutputSupportsBaseBytecode(HELP_WITHOUT_BASE_BYTECODE)).toBe(false);
    });
});

describe("resolveBaseBytecodeHermesFlags", () => {
    it("aligns the compilation with the base bundle when the compiler supports it", () => {
        expect(resolveBaseBytecodeHermesFlags(baseBundlePath, repoRoot)).toEqual(['-base-bytecode', baseBundlePath]);
    });

    const itUnlessWindows = process.platform === 'win32' ? it.skip : it;

    itUnlessWindows("warns and compiles without the flag when the compiler does not support it", () => {
        const projectRoot = writeProjectWithFakeHermesc(HELP_WITHOUT_BASE_BYTECODE);
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

        expect(resolveBaseBytecodeHermesFlags(baseBundlePath, projectRoot)).toEqual([]);
        expect(warn.mock.calls.join('\n')).toMatch(/-base-bytecode/);
    });

    itUnlessWindows("uses the flag when the app's own compiler advertises it", () => {
        const projectRoot = writeProjectWithFakeHermesc(HELP_WITH_BASE_BYTECODE);

        expect(resolveBaseBytecodeHermesFlags(baseBundlePath, projectRoot)).toEqual(['-base-bytecode', baseBundlePath]);
    });
});
