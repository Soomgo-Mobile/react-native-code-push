import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { createReleaseHistory } from "./createReleaseHistory.js";
import { updateReleaseHistory } from "../updateHistoryCommand/updateReleaseHistory.js";

/**
 * Covers where the release history is staged before the config is handed it.
 *
 * The config receives a path rather than the history itself, so the command has to put the
 * file somewhere first. Two releases of one app for different platforms are the same binary
 * version, so a staging path derived from that version alone is the same path for both, and
 * they overwrite each other's contents before either has read its own.
 */

const BINARY_VERSION = "1.0.0";

let workingDir: string;
let previousCwd: string;

beforeEach(() => {
    previousCwd = process.cwd();
    workingDir = fs.mkdtempSync(path.join(os.tmpdir(), "codepush-history-staging-"));
    process.chdir(workingDir);
});

afterEach(() => {
    process.chdir(previousCwd);
    fs.rmSync(workingDir, { recursive: true, force: true });
    jest.restoreAllMocks();
});

function stagedPath(platform: "ios" | "android"): string {
    return path.join(workingDir, "codepush-release-history", platform, `${BINARY_VERSION}.json`);
}

/**
 * Turns the command's own exit into a throw, so a staging failure fails the test instead
 * of taking the worker down with it.
 */
function failOnExit(): void {
    jest.spyOn(process, "exit").mockImplementation((code) => {
        throw new Error(`the command exited with code ${String(code)}`);
    });
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.spyOn(console, "log").mockImplementation(() => undefined);
}

describe("staging the release history a config is handed", () => {
    it("gives each platform writing at the same time a file of its own", async () => {
        failOnExit();

        const staged: Record<string, { jsonFilePath: string; contents: string }> = {};
        const setReleaseHistory = async (
            _binaryVersion: string,
            jsonFilePath: string,
            _releaseInfo: unknown,
            platform: "ios" | "android",
        ): Promise<void> => {
            // Yields once, which is all it takes for the other platform to reach its own
            // write and its own clean-up while this one still holds only a path.
            await Promise.resolve();
            staged[platform] = { jsonFilePath, contents: fs.readFileSync(jsonFilePath, "utf8") };
        };

        await Promise.all([
            createReleaseHistory(BINARY_VERSION, setReleaseHistory, "ios", "RN0840"),
            createReleaseHistory(BINARY_VERSION, setReleaseHistory, "android", "RN0840"),
        ]);

        expect(staged.ios.jsonFilePath).not.toBe(staged.android.jsonFilePath);
    });

    it("hands each platform the history that platform released", async () => {
        failOnExit();

        const released: Record<string, string> = {
            ios: JSON.stringify({ [BINARY_VERSION]: { enabled: true, mandatory: false, downloadUrl: "", packageHash: "" }, "1.0.1": { enabled: true, mandatory: true, downloadUrl: "ios-url", packageHash: "ios-hash" } }),
            android: JSON.stringify({ [BINARY_VERSION]: { enabled: true, mandatory: false, downloadUrl: "", packageHash: "" }, "1.0.1": { enabled: true, mandatory: true, downloadUrl: "android-url", packageHash: "android-hash" } }),
        };

        const staged: Record<string, string> = {};
        const getReleaseHistory = async (
            _binaryVersion: string,
            platform: "ios" | "android",
        ) => JSON.parse(released[platform]);
        const setReleaseHistory = async (
            _binaryVersion: string,
            jsonFilePath: string,
            _releaseInfo: unknown,
            platform: "ios" | "android",
        ): Promise<void> => {
            await Promise.resolve();
            staged[platform] = fs.readFileSync(jsonFilePath, "utf8");
        };

        await Promise.all([
            updateReleaseHistory("1.0.1", BINARY_VERSION, getReleaseHistory, setReleaseHistory, "ios", "RN0840", undefined, false, undefined),
            updateReleaseHistory("1.0.1", BINARY_VERSION, getReleaseHistory, setReleaseHistory, "android", "RN0840", undefined, false, undefined),
        ]);

        expect(staged.ios).toContain("ios-url");
        expect(staged.ios).not.toContain("android-url");
        expect(staged.android).toContain("android-url");
        expect(staged.android).not.toContain("ios-url");
    });

    it("takes the file away once the config has stored the history", async () => {
        failOnExit();

        const setReleaseHistory = async (): Promise<void> => undefined;
        await createReleaseHistory(BINARY_VERSION, setReleaseHistory, "ios", "RN0840");

        expect(fs.existsSync(stagedPath("ios"))).toBe(false);
    });

    it("leaves the file behind when the config could not store the history", async () => {
        failOnExit();

        const setReleaseHistory = async (): Promise<void> => {
            throw new Error("the storage backend rejected the history");
        };

        await expect(createReleaseHistory(BINARY_VERSION, setReleaseHistory, "ios", "RN0840")).rejects.toThrow(
            "the command exited with code 1",
        );

        // What the release tried to store is worth reading back, so a failed release keeps
        // its history at a path that is the same on every run.
        expect(Object.keys(JSON.parse(fs.readFileSync(stagedPath("ios"), "utf8")))).toEqual([BINARY_VERSION]);
    });
});
