import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { makeCodePushBundle } from "./makeCodePushBundle.js";
import { resolveAssetDiffBases } from "./resolveAssetDiffBases.js";
import type { BundleDownloadInfo, CliConfigInterface, ReleaseHistoryInterface } from "../../typings/react-native-code-push.d.ts";

/**
 * Exercises base acquisition against real archives and real hashes: a base is only usable
 * if the bytes that came back are the ones the release history recorded, and only real
 * archives prove that the verification accepts a good download and rejects a wrong one.
 */

/** The directory a CodePush archive keeps its contents in, for legacy reasons. */
const CONTENTS_DIR_NAME = 'CodePush';

/** Where the resolver unpacks a base for verification, so leftovers are recognizable. */
const TEMP_DIR_PREFIX = 'codepush-asset-diff-base-';
const TARGET_BINARY_VERSION = '1.0.0';

type StagedRelease = {
    version: string;
    downloadUrl: string;
    packageHash: string;
    archivePath: string;
};

let workDir: string;
let bundleDirectory: string;

/** Releases one full archive the way the CLI does, and returns what the history records. */
async function stageRelease(version: string): Promise<StagedRelease> {
    const contentsPath = path.join(workDir, version, CONTENTS_DIR_NAME);
    fs.mkdirSync(contentsPath, { recursive: true });
    fs.writeFileSync(path.join(contentsPath, 'index.android.bundle'), `bundle bytes of ${version}`);

    const { bundleFileName } = await makeCodePushBundle(contentsPath, bundleDirectory);

    return {
        version,
        downloadUrl: `https://downloads.test/${version}.zip`,
        packageHash: bundleFileName,
        archivePath: path.join(bundleDirectory, bundleFileName),
    };
}

async function stageReleases(versions: string[]): Promise<StagedRelease[]> {
    const releases: StagedRelease[] = [];
    for (const version of versions) {
        releases.push(await stageRelease(version));
    }
    return releases;
}

function releaseHistoryOf(releases: StagedRelease[]): ReleaseHistoryInterface {
    return Object.fromEntries(
        releases.map((release) => [
            release.version,
            {
                enabled: true,
                mandatory: false,
                downloadUrl: release.downloadUrl,
                packageHash: release.packageHash,
            },
        ]),
    );
}

/** Stands in for the consumer's downloader: hands back a local archive per download url. */
function fakeDownloader(archives: Record<string, string | Error>) {
    const calls: Array<[BundleDownloadInfo, string, string | undefined]> = [];
    const download: NonNullable<CliConfigInterface['bundleDownloader']> = async (
        downloadInfo,
        platform,
        identifier,
    ) => {
        calls.push([downloadInfo, platform, identifier]);

        const downloadedArchive = archives[downloadInfo.downloadUrl];
        if (downloadedArchive instanceof Error) {
            throw downloadedArchive;
        }
        if (!downloadedArchive) {
            throw new Error(`the downloader was called with an unexpected url: ${downloadInfo.downloadUrl}`);
        }
        return { downloadedFilePath: downloadedArchive };
    };
    return { download, calls };
}

function leftoverTempDirs(): string[] {
    return fs.readdirSync(os.tmpdir()).filter((entry) => entry.startsWith(TEMP_DIR_PREFIX));
}

beforeAll(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "codepush-base-resolution-"));
    bundleDirectory = path.join(workDir, 'bundleOutput');
});

afterEach(() => {
    jest.restoreAllMocks();
});

afterAll(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
});

describe("resolveAssetDiffBases", () => {
    it("takes the newest releases first, up to the requested count", async () => {
        const releases = await stageReleases(['1.0.0', '1.0.1', '1.0.2', '1.0.9', '1.0.10']);
        const [newest, second] = [releases[4], releases[3]];
        const { download, calls } = fakeDownloader(
            Object.fromEntries(releases.map((release) => [release.downloadUrl, release.archivePath])),
        );

        const bases = await resolveAssetDiffBases({
            releaseHistory: releaseHistoryOf(releases),
            diffBaseCount: 2,
            bundleDownloader: download,
            platform: 'android',
            identifier: 'my-app',
            targetBinaryVersion: TARGET_BINARY_VERSION,
        });

        expect(bases).toEqual([
            { basePackageHash: newest.packageHash, baseBundleFilePath: newest.archivePath },
            { basePackageHash: second.packageHash, baseBundleFilePath: second.archivePath },
        ]);
        expect(calls).toEqual([
            [{ downloadUrl: newest.downloadUrl, targetBinaryVersion: TARGET_BINARY_VERSION, releaseVersion: newest.version, packageHash: newest.packageHash }, 'android', 'my-app'],
            [{ downloadUrl: second.downloadUrl, targetBinaryVersion: TARGET_BINARY_VERSION, releaseVersion: second.version, packageHash: second.packageHash }, 'android', 'my-app'],
        ]);
    });

    it("skips history entries that lack a download url or a package hash", async () => {
        const [released] = await stageReleases(['1.1.0']);
        const { download, calls } = fakeDownloader({ [released.downloadUrl]: released.archivePath });

        const bases = await resolveAssetDiffBases({
            releaseHistory: {
                ...releaseHistoryOf([released]),
                // What `create-history` seeds for the update inside the app binary.
                '1.1.1': { enabled: true, mandatory: false, downloadUrl: "", packageHash: "" },
                '1.1.2': { enabled: true, mandatory: false, downloadUrl: released.downloadUrl, packageHash: "" },
            },
            diffBaseCount: 1,
            bundleDownloader: download,
            platform: 'ios',
            targetBinaryVersion: TARGET_BINARY_VERSION,
        });

        expect(bases).toEqual([
            { basePackageHash: released.packageHash, baseBundleFilePath: released.archivePath },
        ]);
        expect(calls).toEqual([[
            { downloadUrl: released.downloadUrl, targetBinaryVersion: TARGET_BINARY_VERSION, releaseVersion: released.version, packageHash: released.packageHash },
            'ios',
            undefined,
        ]]);
    });

    it("ignores a history entry whose key is not a version, and resolves the rest", async () => {
        const [released] = await stageReleases(['1.4.0']);
        const { download, calls } = fakeDownloader({ [released.downloadUrl]: released.archivePath });

        const bases = await resolveAssetDiffBases({
            releaseHistory: {
                ...releaseHistoryOf([released]),
                'not-a-version': {
                    enabled: true,
                    mandatory: false,
                    downloadUrl: released.downloadUrl,
                    packageHash: released.packageHash,
                },
            },
            diffBaseCount: 2,
            bundleDownloader: download,
            platform: 'ios',
            targetBinaryVersion: TARGET_BINARY_VERSION,
        });

        expect(bases).toEqual([
            { basePackageHash: released.packageHash, baseBundleFilePath: released.archivePath },
        ]);
        expect(calls).toEqual([[
            { downloadUrl: released.downloadUrl, targetBinaryVersion: TARGET_BINARY_VERSION, releaseVersion: released.version, packageHash: released.packageHash },
            'ios',
            undefined,
        ]]);
    });

    it("drops a base whose downloaded bytes do not match its recorded package hash", async () => {
        const [older, newer] = await stageReleases(['1.2.0', '1.2.1']);
        // The newest base comes back as some other release's archive.
        const { download } = fakeDownloader({
            [newer.downloadUrl]: older.archivePath,
            [older.downloadUrl]: older.archivePath,
        });
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

        const bases = await resolveAssetDiffBases({
            releaseHistory: releaseHistoryOf([older, newer]),
            diffBaseCount: 2,
            bundleDownloader: download,
            platform: 'android',
            targetBinaryVersion: TARGET_BINARY_VERSION,
        });

        expect(bases).toEqual([{ basePackageHash: older.packageHash, baseBundleFilePath: older.archivePath }]);
        expect(warn.mock.calls.join('\n')).toMatch(/1\.2\.1/);
        expect(leftoverTempDirs()).toEqual([]);
    });

    it("drops a base whose download fails instead of failing the release", async () => {
        const [older, newer] = await stageReleases(['1.3.0', '1.3.1']);
        const { download } = fakeDownloader({
            [newer.downloadUrl]: new Error('the network is down'),
            [older.downloadUrl]: older.archivePath,
        });
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

        const bases = await resolveAssetDiffBases({
            releaseHistory: releaseHistoryOf([older, newer]),
            diffBaseCount: 2,
            bundleDownloader: download,
            platform: 'android',
            targetBinaryVersion: TARGET_BINARY_VERSION,
        });

        expect(bases).toEqual([{ basePackageHash: older.packageHash, baseBundleFilePath: older.archivePath }]);
        expect(warn.mock.calls.join('\n')).toMatch(/1\.3\.1.*the network is down/s);
    });
});
