/**
 * Binary patch codec for CodePush updates.
 *
 * A binary patch update carries only the difference between the bundle that is
 * already inside the app binary and the bundle a release wants to run, instead of
 * the whole bundle. Patches are produced by HDiffPatch's `hdiffz` and applied on
 * device by the native appliers; `hpatchz` is the reference applier used here so a
 * patch can be verified right after it is produced.
 *
 * The tool options below are part of the format contract, not tuning knobs:
 *   -m-6            the base bundle is held in memory while patching, which is what
 *                   the native appliers do, and match score 6 suits bytecode
 *   -c-zstd-21-24   zstd is the only decompressor the native appliers link
 *   -f              overwrite the output file if it already exists
 * Changing them produces patches the native appliers cannot read.
 *
 * A patch contains no checksum of the base data, and its zstd streams carry no
 * content checksums, so a successful apply is not proof of a correct result: a base
 * of the right size but the wrong content, or a corrupted patch body, can both apply
 * "successfully" and yield wrong bytes. Callers must verify the base and target
 * hashes themselves.
 */

import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

/**
 * Identifies the patch format so a client can refuse a patch it cannot apply.
 * Bump the format version whenever the tool options above change.
 */
export const BINARY_PATCH_ALGORITHM = 'hdiffpatch-m-zstd';
export const BINARY_PATCH_FORMAT_VERSION = 1;

export type BinaryPatchTool = 'hdiffz' | 'hpatchz';

const HDIFFZ_OPTIONS = ['-f', '-m-6', '-c-zstd-21-24'];
const HPATCHZ_OPTIONS = ['-f', '-m'];

export const TOOLS_DIR_ENV_NAME = 'HDIFFPATCH_TOOLS_DIR';
export const TOOLS_DIR_NAME = '.hdiffpatch-tools';
const BUILD_SCRIPT_PATH = 'scripts/binary-patch/build-hdiffpatch.sh';

/**
 * Finds the hdiffz/hpatchz executable, looking at `HDIFFPATCH_TOOLS_DIR` first and
 * then at a `.hdiffpatch-tools` directory in the working directory or any directory
 * above it. The tools are built from source rather than installed as a package
 * dependency, so the error explains how to get them.
 */
export function resolveBinaryPatchTool(tool: BinaryPatchTool): string {
    const configuredDir = process.env[TOOLS_DIR_ENV_NAME];
    if (configuredDir) {
        const configured = path.join(configuredDir, tool);
        if (fs.existsSync(configured)) {
            return configured;
        }
        throw new Error(
            `${TOOLS_DIR_ENV_NAME} is set to '${configuredDir}' but it does not contain '${tool}'. ` +
                `Build the tools with '${BUILD_SCRIPT_PATH}'.`,
        );
    }

    let directory = path.resolve(process.cwd());
    for (;;) {
        const candidate = path.join(directory, TOOLS_DIR_NAME, tool);
        if (fs.existsSync(candidate)) {
            return candidate;
        }
        const parent = path.dirname(directory);
        if (parent === directory) {
            break;
        }
        directory = parent;
    }

    throw new Error(
        `'${tool}' not found in any '${TOOLS_DIR_NAME}' directory at or above '${process.cwd()}'. ` +
            `Build it with '${BUILD_SCRIPT_PATH}', or set ${TOOLS_DIR_ENV_NAME} to a directory that contains it.`,
    );
}

/** Writes the patch that turns the bundle at `basePath` into the one at `targetPath`. */
export function generatePatch(basePath: string, targetPath: string, patchPath: string): void {
    runTool('hdiffz', [...HDIFFZ_OPTIONS, basePath, targetPath, patchPath]);
}

/** Writes the bundle that `patchPath` produces from the bundle at `basePath`. */
export function applyPatch(basePath: string, patchPath: string, outputPath: string): void {
    runTool('hpatchz', [...HPATCHZ_OPTIONS, basePath, patchPath, outputPath]);
}

function runTool(tool: BinaryPatchTool, args: string[]): void {
    const executable = resolveBinaryPatchTool(tool);
    const result = spawnSync(executable, args, { encoding: 'utf8' });

    if (result.error) {
        throw new Error(`failed to run ${tool}: ${result.error.message}`);
    }
    if (result.status !== 0) {
        const reason = result.status === null ? `signal ${result.signal}` : `exit code ${result.status}`;
        throw new Error(`${tool} failed with ${reason}\n${result.stdout ?? ''}${result.stderr ?? ''}`);
    }
}
