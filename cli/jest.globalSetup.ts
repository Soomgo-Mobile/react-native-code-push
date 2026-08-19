import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

/**
 * Builds hdiffz/hpatchz once, before any test worker starts.
 *
 * Several suites generate and apply real patches, which is the only way to prove the
 * committed patch format is what every applier understands. Provisioning the tools here
 * rather than in each suite keeps a clean checkout - and CI - free of a manual setup
 * step, without letting two workers run the same build at the same time.
 *
 * The build script installs into `HDIFFPATCH_TOOLS_DIR` when it is set and into
 * `<repo>/.hdiffpatch-tools` otherwise, which is where the CLI looks for the tools. It
 * is a no-op when they are already there, so the check below only decides whether to
 * warn that this run has a multi-minute build ahead of it.
 *
 * Note that this module is loaded outside the jest module resolver, so it cannot import
 * from the CLI sources.
 */

const REPO_ROOT = path.join(__dirname, '..');
const BUILD_SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'binary-patch', 'build-hdiffpatch.sh');
const DEFAULT_TOOLS_DIR = path.join(REPO_ROOT, '.hdiffpatch-tools');

export default function ensureBinaryPatchTools(): void {
    const toolsDir = process.env.HDIFFPATCH_TOOLS_DIR || DEFAULT_TOOLS_DIR;
    const alreadyInstalled = ['hdiffz', 'hpatchz'].every((tool) => fs.existsSync(path.join(toolsDir, tool)));

    if (!alreadyInstalled) {
        // Announced because a first build clones and compiles HDiffPatch, which takes
        // minutes; a silent wait would look like a hang.
        console.log(`Building hdiffz/hpatchz into ${toolsDir} (first run only)`);
    }

    const result = spawnSync(BUILD_SCRIPT_PATH, { encoding: 'utf8' });
    if (result.error) {
        throw new Error(`failed to run ${BUILD_SCRIPT_PATH}: ${result.error.message}`);
    }
    if (result.status !== 0) {
        throw new Error(`${BUILD_SCRIPT_PATH} failed:\n${result.stdout ?? ''}${result.stderr ?? ''}`);
    }
}
