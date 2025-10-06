/**
 * code based on appcenter-cli
 */

import fs from "fs";

export function isDirectory(path: string): boolean {
    return fs.statSync(path).isDirectory();
}

export function generateRandomFilename(length: number): string {
    let filename = '';
    const validChar = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

    for (let i = 0; i < length; i++) {
        filename += validChar.charAt(Math.floor(Math.random() * validChar.length));
    }

    return filename;
}

export function normalizePath(filePath: string): string {
    //replace all backslashes coming from cli running on windows machines by slashes
    return filePath.replace(/\\/g, '/');
}
