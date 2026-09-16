import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { CliConfigInterface, ReleaseHistoryInterface } from "../../../typings/react-native-code-push.d.ts";

/**
 * Checks the command definition against the entry it saves. Everything this command does
 * ends up in the release history the config is handed, so an option that never reaches it
 * leaves the release exactly as it was - which the command still reports as a success.
 */

const BINARY_VERSION = '1.0.0';
const APP_VERSION = '1.0.1';

let mockConfig: CliConfigInterface;

jest.mock("../../utils/fsUtils.js", () => ({
    findAndReadConfigFile: () => mockConfig,
}));

/**
 * Puts one released version in the config's history and records every history it is
 * handed back, so a case can read the entry as the consumer would store it.
 */
function stageReleaseHistory(): ReleaseHistoryInterface[] {
    const releaseHistory: ReleaseHistoryInterface = {
        [APP_VERSION]: {
            enabled: true,
            mandatory: false,
            downloadUrl: 'https://cdn.example.com/bundle',
            packageHash: 'a3f1c0',
        },
    };
    const saved: ReleaseHistoryInterface[] = [];

    mockConfig = {
        bundleUploader: async () => ({ downloadUrl: 'https://cdn.example.com/bundle' }),
        getReleaseHistory: async () => releaseHistory,
        // The command edits the history in place, so what it saved is copied out here.
        setReleaseHistory: async (_binaryVersion, _jsonFilePath, releaseInfo) => {
            saved.push(structuredClone(releaseInfo));
        },
    };

    return saved;
}

/**
 * Parses an `update-history` invocation against the real command definition. Commander is
 * asked to throw instead of exiting, and to keep its diagnostics to itself, so a rejected
 * option can be asserted on without ending the worker or the output.
 */
async function parseUpdateHistoryCommand(args: string[]): Promise<void> {
    const { program } = await import("commander");
    await import("./index.js");

    const updateHistoryCommand = program.commands.find((command) => command.name() === 'update-history');
    updateHistoryCommand?.exitOverride();
    updateHistoryCommand?.configureOutput({ writeErr: () => {} });

    await program.parseAsync(['update-history', ...args], { from: 'user' });
}

async function runUpdateHistoryCommand(args: string[]): Promise<void> {
    await parseUpdateHistoryCommand(['-b', BINARY_VERSION, '-v', APP_VERSION, ...args]);
}

let saved: ReleaseHistoryInterface[];

beforeEach(() => {
    jest.resetModules();
    saved = stageReleaseHistory();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        throw new Error(`process.exit(${code})`);
    }) as never);
});

afterEach(() => {
    jest.restoreAllMocks();
    // The command writes its JSON under the directory it was invoked in.
    fs.rmSync(path.resolve(process.cwd(), "codepush-release-history"), { recursive: true, force: true });
});

describe("update-history command options", () => {
    it("lowers the background wait of a release that is already out to zero seconds", async () => {
        await runUpdateHistoryCommand(['--minimum-background-duration', '0']);

        expect(saved).toHaveLength(1);
        expect(saved[0][APP_VERSION].minimumBackgroundDuration).toBe(0);
    });

    it("leaves the entry saying nothing about the background wait when only --enable is given", async () => {
        await runUpdateHistoryCommand(['--enable', 'false']);

        expect(saved[0][APP_VERSION].enabled).toBe(false);
        expect(saved[0][APP_VERSION]).not.toHaveProperty('minimumBackgroundDuration');
    });

    it("saves the rollout percentage when --rollout is the only option given", async () => {
        await runUpdateHistoryCommand(['--rollout', '50']);

        expect(saved[0][APP_VERSION].rollout).toBe(50);
    });

    it("exits without saving anything when no option says what to change", async () => {
        await expect(runUpdateHistoryCommand([])).rejects.toThrow('process.exit(1)');

        expect(saved).toHaveLength(0);
    });

    it("rejects a negative background wait and saves nothing", async () => {
        await expect(runUpdateHistoryCommand(['--minimum-background-duration', '-1']))
            .rejects.toThrow('process.exit(1)');

        expect(saved).toHaveLength(0);
    });

    it.each([
        ['a percentage above 100', '150'],
        ['a percentage that is not a number', 'abc'],
    ])("rejects %s and saves nothing", async (_scenario, rollout) => {
        await expect(runUpdateHistoryCommand(['--rollout', rollout]))
            .rejects.toThrow('process.exit(1)');

        expect(saved).toHaveLength(0);
    });
});
