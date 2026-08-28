import { spawnSync } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { TOOLS_DIR_ENV_NAME } from "../../utils/binaryPatch.js";

interface BuildPatchToolsOptions {
    /** The `build-hdiffpatch.sh` this package ships. */
    buildScriptPath: string;
    /** Where the script installs `hdiffz` and `hpatchz`. It has to be a place the CLI looks in. */
    toolsDir: string;
    /** Rebuild even when both tools are already there. */
    force: boolean;
}

/**
 * Runs the build script with the install directory the caller chose.
 *
 * The script's output goes straight to the terminal: a first build clones and compiles
 * HDiffPatch, which takes minutes, and a silent wait would look like a hang. So when the
 * script fails, its own message has already been shown, and the error raised here only
 * has to say that it did.
 */
export function buildPatchTools({ buildScriptPath, toolsDir, force }: BuildPatchToolsOptions): void {
    const result = spawnSync(buildScriptPath, force ? ['--force'] : [], {
        stdio: 'inherit',
        env: { ...process.env, [TOOLS_DIR_ENV_NAME]: toolsDir },
    });

    if (result.error) {
        throw new Error(`failed to run ${buildScriptPath}: ${result.error.message}`);
    }
    if (result.status !== 0) {
        const reason = result.status === null ? `signal ${result.signal}` : `exit code ${result.status}`;
        throw new Error(`${path.basename(buildScriptPath)} failed with ${reason}`);
    }
}

/**
 * SHA-256 of the build script's bytes, for keying a CI cache of the installed tools. The
 * script pins the sources and the build flags, so it changes whenever the tools it would
 * build do.
 */
export function hashBuildScript(buildScriptPath: string): string {
    return crypto.createHash('sha256').update(fs.readFileSync(buildScriptPath)).digest('hex');
}
