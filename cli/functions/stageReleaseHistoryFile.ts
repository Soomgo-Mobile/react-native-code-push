import fs from "fs";
import path from "path";
import type { ReleaseHistoryInterface } from "../../typings/react-native-code-push.d.ts";

const STAGING_DIR_NAME = 'codepush-release-history';

/**
 * Writes the release history to a file for the config to read, and takes it away again
 * once the config has stored it.
 *
 * Written under a directory of the platform's own rather than straight into the directory
 * the command ran in. The name follows from the binary version alone, so two commands
 * releasing the same version of one app for different platforms shared one path: whichever
 * finished first took the file away while the other was still about to read it, and before
 * that each had overwritten the other's contents. The name itself is kept as it was,
 * because the name is part of what the config is handed.
 *
 * A file whose history was never stored is left where it was written, so a release that
 * failed can be read back from a path that is the same on every run.
 */
export async function stageReleaseHistoryFile<T>(
    binaryVersion: string,
    releaseHistory: ReleaseHistoryInterface,
    platform: 'ios' | 'android',
    store: (jsonFilePath: string) => Promise<T>,
): Promise<T> {
    const jsonFileName = `${binaryVersion}.json`;
    const stagingDir = path.resolve(process.cwd(), STAGING_DIR_NAME, platform);
    const jsonFilePath = path.join(stagingDir, jsonFileName);

    fs.mkdirSync(stagingDir, { recursive: true });
    console.log(`log: creating JSON file... ("${jsonFileName}")\n`, JSON.stringify(releaseHistory, null, 2));
    fs.writeFileSync(jsonFilePath, JSON.stringify(releaseHistory));

    const stored = await store(jsonFilePath);
    fs.rmSync(jsonFilePath, { force: true });
    return stored;
}
