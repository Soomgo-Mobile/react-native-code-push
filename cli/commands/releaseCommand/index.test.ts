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
        bundleDownloader: async () => ({ downloadedFilePath: '/tmp/base.zip' }),
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
    onOversizedPatch: 20,
    bundleDownloader: 21,
    diffBaseCount: 22,
} as const;

/**
 * Parses a `release` invocation against the real command definition. Commander is asked
 * to throw instead of exiting, and to keep its diagnostics to itself, so a rejected
 * option can be asserted on without ending the worker or the output.
 */
async function parseReleaseCommand(args: string[]): Promise<void> {
    const { program } = await import("commander");
    await import("./index.js");

    const releaseCommand = program.commands.find((command) => command.name() === 'release');
    releaseCommand?.exitOverride();
    releaseCommand?.configureOutput({ writeErr: () => {} });

    await program.parseAsync(['release', ...args], { from: 'user' });
}

async function runReleaseCommand(args: string[]): Promise<unknown[]> {
    const { release } = await import("./release.js");

    await parseReleaseCommand(args);

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

    it("defaults the oversized patch policy to skipping the patch", async () => {
        const args = await runReleaseCommand(['-b', '1.0.0', '-v', '1.0.1']);

        expect(args[ARG_INDEX.onOversizedPatch]).toBe('skip');
    });

    it("passes the chosen oversized patch policy through to the release", async () => {
        const args = await runReleaseCommand(['-b', '1.0.0', '-v', '1.0.1', '--on-oversized-patch', 'fail']);

        expect(args[ARG_INDEX.onOversizedPatch]).toBe('fail');
    });

    it("rejects an oversized patch policy it does not know", async () => {
        await expect(parseReleaseCommand(['-b', '1.0.0', '-v', '1.0.1', '--on-oversized-patch', 'ask']))
            .rejects.toThrow(/--on-oversized-patch.*'ask'.*skip, fail/s);

        const { release } = await import("./release.js");
        expect(jest.mocked(release)).not.toHaveBeenCalled();
    });

    it("hands the release the bundle downloader from the config and three diff bases by default", async () => {
        const args = await runReleaseCommand(['-b', '1.0.0', '-v', '1.0.1']);

        expect(typeof args[ARG_INDEX.bundleDownloader]).toBe('function');
        expect(args[ARG_INDEX.diffBaseCount]).toBe(3);
    });

    it("passes the chosen asset diff base count through to the release", async () => {
        const args = await runReleaseCommand(['-b', '1.0.0', '-v', '1.0.1', '--diff-base-count', '5']);

        expect(args[ARG_INDEX.diffBaseCount]).toBe(5);
    });

    it.each([
        ['is negative', '-1'],
        ['is not a number at all', 'many'],
    ])("rejects an asset diff base count that %s", async (_caseName, value) => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
            throw new Error(`process.exit(${code})`);
        }) as never);

        await expect(parseReleaseCommand(['-b', '1.0.0', '-v', '1.0.1', '--diff-base-count', value]))
            .rejects.toThrow('process.exit(1)');

        const { release } = await import("./release.js");
        expect(jest.mocked(release)).not.toHaveBeenCalled();
    });
});
