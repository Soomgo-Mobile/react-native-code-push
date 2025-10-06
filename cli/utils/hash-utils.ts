/**
 * code based on appcenter-cli
 */

/**
 * NOTE!!! This utility file is duplicated for use by the CodePush service (for server-driven hashing/
 * integrity checks) and Management SDK (for end-to-end code signing), please keep them in sync.
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { isDirectory } from "./file-utils.js";
import { walk } from "./promisfied-fs.js";

// Do not throw an exception if either of these modules are missing, as they may not be needed by the
// consumer of this file.
const HASH_ALGORITHM = 'sha256';
class PackageManifest {
    private _map: Map<string, string>;

    constructor(map?: Map<string, string>) {
        if (map == null) {
            map = new Map();
        }
        this._map = map;
    }

    toMap(): Map<string, string> {
        return this._map;
    }

    computePackageHash(): string {
        let entries: string[] = [];
        this._map.forEach((hash, name) => {
            entries.push(name + ':' + hash);
        });

        // Make sure this list is alphabetically ordered so that other clients
        // can also compute this hash easily given the update contents.
        entries = entries.sort();

        return crypto.createHash(HASH_ALGORITHM).update(JSON.stringify(entries)).digest('hex');
    }

    serialize(): string {
        const obj: Record<string, string> = {};

        this._map.forEach(function (value, key) {
            obj[key] = value;
        });

        return JSON.stringify(obj);
    }

    static normalizePath(filePath: string): string {
        //replace all backslashes coming from cli running on windows machines by slashes
        return filePath.replace(/\\/g, '/');
    }

    static isIgnored(relativeFilePath: string): boolean {
        const __MACOSX = '__MACOSX/';
        const DS_STORE = '.DS_Store';
        const CODEPUSH_METADATA = '.codepushrelease';
        return (
            relativeFilePath.startsWith(__MACOSX) ||
            relativeFilePath === DS_STORE ||
            relativeFilePath.endsWith('/' + DS_STORE) ||
            relativeFilePath === CODEPUSH_METADATA ||
            relativeFilePath.endsWith('/' + CODEPUSH_METADATA)
        );
    }
}

export async function generatePackageHashFromDirectory(directoryPath: string, basePath: string) {
    try {
        if (!isDirectory(directoryPath)) {
            throw new Error('Not a directory. Please either create a directory, or use hashFile().');
        }
    } catch (error) {
        throw new Error('Directory does not exist. Please either create a directory, or use hashFile().');
    }

    /**
     * @type {PackageManifest}
     */
    const manifest = await generatePackageManifestFromDirectory(directoryPath, basePath);
    return manifest.computePackageHash();
}

function generatePackageManifestFromDirectory(directoryPath: string, basePath: string): Promise<PackageManifest> {
    // eslint-disable-next-line no-async-promise-executor
    return new Promise(async (resolve, reject) => {
        const fileHashesMap = new Map<string, string>();

        const files: string[] = await walk(directoryPath);

        if (!files || files.length === 0) {
            reject('Error: Cannot sign the release because no files were found.');
            return;
        }

        // Hash the files sequentially, because streaming them in parallel is not necessarily faster
        const generateManifestPromise = files.reduce<Promise<unknown>>((soFar, filePath) => {
            return soFar.then(() => {
                const relativePath: string = PackageManifest.normalizePath(path.relative(basePath, filePath));
                if (!PackageManifest.isIgnored(relativePath)) {
                    return hashFile(filePath).then((hash) => {
                        fileHashesMap.set(relativePath, hash);
                    });
                }
            });
        }, Promise.resolve(null));

        generateManifestPromise.then(() => {
            resolve(new PackageManifest(fileHashesMap));
        }, reject);
    });
}

function hashFile(filePath: string): Promise<string> {
    const readStream: fs.ReadStream = fs.createReadStream(filePath);
    return hashStream(readStream);
}

function hashStream(readStream: fs.ReadStream): Promise<string> {
    return new Promise((resolve, reject) => {
        const _hashStream = crypto.createHash(HASH_ALGORITHM)

        readStream
            .on('error', (error) => {
                _hashStream.end();
                reject(error);
            })
            .on('end', () => {
                _hashStream.end();

                const buffer = _hashStream.read();
                const hash: string = buffer.toString('hex');

                resolve(hash);
            });

        readStream.pipe(_hashStream);
    });
}
