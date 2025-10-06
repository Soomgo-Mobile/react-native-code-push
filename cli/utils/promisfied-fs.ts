/**
 * code based on appcenter-cli
 */

import { promises as fs } from "fs";
import path from "path";

export async function walk(dir: string): Promise<string[]> {
    const stats = await fs.stat(dir);
    if (stats.isDirectory()) {
        let files: string[] = [];
        for (const file of await fs.readdir(dir)) {
            files = files.concat(await walk(path.join(dir, file)));
        }
        return files;
    } else {
        return [dir];
    }
}
