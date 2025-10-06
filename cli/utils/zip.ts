/**
 * code based on appcenter-cli
 */

import fs from "fs";
import path from "path";
import yazl from "yazl";
import { generateRandomFilename, normalizePath, isDirectory } from "./file-utils.js";
import { walk } from "./promisfied-fs.js";

type ReleaseFile = { sourceLocation: string, targetLocation: string };

export function zip(updateContentsPath: string): Promise<string> {

    // eslint-disable-next-line no-async-promise-executor
    return new Promise(async (resolve, reject) => {
        const releaseFiles: ReleaseFile[] = [];

        try {
            if (!isDirectory(updateContentsPath)) {
                releaseFiles.push({
                    sourceLocation: updateContentsPath,
                    targetLocation: normalizePath(path.basename(updateContentsPath)), // Put the file in the root
                });
            }
        } catch (error: unknown) {
            if (error instanceof Error) {
                error.message = error.message + " Make sure you have added the platform you are making a release to.`.";
            }
            reject(error);
        }

        const directoryPath = updateContentsPath;
        const baseDirectoryPath = path.join(directoryPath, '..'); // For legacy reasons, put the root directory in the zip

        const files: string[] = await walk(updateContentsPath);

        files.forEach((filePath) => {
            const relativePath = path.relative(baseDirectoryPath, filePath);
            releaseFiles.push({
                sourceLocation: filePath,
                targetLocation: normalizePath(relativePath),
            });
        });

        const packagePath = path.join(process.cwd(), generateRandomFilename(15) + '.zip');
        const zipFile = new yazl.ZipFile();
        const writeStream = fs.createWriteStream(packagePath);

        zipFile.outputStream
            .pipe(writeStream)
            .on('error', (error: unknown) => {
                reject(error);
            })
            .on('close', () => {
                resolve(packagePath);
            });

        releaseFiles.forEach((releaseFile) => {
            zipFile.addFile(releaseFile.sourceLocation, releaseFile.targetLocation);
        });

        zipFile.end();
    });
}
