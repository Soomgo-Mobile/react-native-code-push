import path from "path";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

/**
 * Checks the command definition against the arguments it forwards, which is where an
 * option name can silently drift: commander derives the name it stores from the flag,
 * so reading a differently named property yields `undefined` for every release rather
 * than an error, and every downstream default looks as if it had been chosen.
 */

jest.mock("./release.js");
jest.mock("../../utils/fsUtils.js", () => ({
    findAndReadConfigFile: () => ({
        bundleUploader: async () => ({ downloadUrl: 'https://cdn.example.com/bundle' }),
        getReleaseHistory: async () => ({}),
        setReleaseHistory: async () => undefined,
    }),
}));

/**
 * `release()` takes positional arguments; these are the positions this suite asserts on.
 */
const ARG_INDEX = {
    platform: 6,
    outputPath: 8,
    entryFile: 9,
    jsBundleName: 10,
    skipBundle: 14,
    bundleDirectory: 16,
    baseBundlePath: 19,
} as const;

async function runReleaseCommand(args: string[]): Promise<unknown[]> {
    const { release } = await import("./release.js");
    const { program } = await import("commander");
    await import("./index.js");

    await program.parseAsync(['release', ...args], { from: 'user' });

    const releaseMock = jest.mocked(release);
    expect(releaseMock).toHaveBeenCalledTimes(1);
    return releaseMock.mock.calls[0];
}

beforeEach(() => {
    jest.resetModules();
    jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

/** Relative to the CLI workspace root, which is where the test runner starts. */
const BASE_BUNDLE_FIXTURE = 'fixtures/binary-patch/base.bundle';

describe("release command options", () => {
    it("passes the JS bundle name from -j through to the release", async () => {
        const args = await runReleaseCommand([
            '-b', '1.0.0',
            '-v', '1.0.1',
            '-p', 'android',
            '-j', 'custom.jsbundle',
            '--skip-bundle', 'true',
            '--binary-bundle-path', BASE_BUNDLE_FIXTURE,
        ]);

        expect(args[ARG_INDEX.jsBundleName]).toBe('custom.jsbundle');
        expect(args[ARG_INDEX.platform]).toBe('android');
        expect(args[ARG_INDEX.skipBundle]).toBe(true);
        expect(args[ARG_INDEX.baseBundlePath]).toBe(path.resolve(BASE_BUNDLE_FIXTURE));
    });

    it("leaves the JS bundle name unset when -j is not given, so the platform default applies", async () => {
        const args = await runReleaseCommand(['-b', '1.0.0', '-v', '1.0.1']);

        expect(args[ARG_INDEX.jsBundleName]).toBeUndefined();
        expect(args[ARG_INDEX.baseBundlePath]).toBeUndefined();
        expect(args[ARG_INDEX.outputPath]).toBe('build');
        expect(args[ARG_INDEX.entryFile]).toBe('index.ts');
        expect(args[ARG_INDEX.bundleDirectory]).toBe('build/bundleOutput');
    });
});
