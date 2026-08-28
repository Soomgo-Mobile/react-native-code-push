import path from "path";
import { fileURLToPath } from "url";
import { program } from "commander";
import { TOOLS_DIR_ENV_NAME, TOOLS_DIR_NAME } from "../../utils/binaryPatch.js";
import { buildPatchTools, hashBuildScript } from "./buildPatchTools.js";

type Options = {
    toolsDir: string;
    force: boolean;
    printHash: boolean;
}

/**
 * The CLI runs compiled, from `cli/dist/commands/buildPatchToolsCommand/`, which puts the
 * package root - and the script shipped under it - four levels up.
 */
const BUILD_SCRIPT_PATH = fileURLToPath(
    new URL("../../../../scripts/binary-patch/build-hdiffpatch.sh", import.meta.url),
);

/**
 * Installs where `release` will look: `HDIFFPATCH_TOOLS_DIR` when it is set, and otherwise
 * a `.hdiffpatch-tools` directory in the working directory, the first place the lookup
 * checks before walking up.
 */
const DEFAULT_TOOLS_DIR = process.env[TOOLS_DIR_ENV_NAME] || path.resolve(process.cwd(), TOOLS_DIR_NAME);

program.command('build-patch-tools')
    .description('Builds hdiffz and hpatchz from source and installs them where `release --binary-bundle-path` looks for them.\nThe build clones the pinned HDiffPatch sources, so it needs git, make, a C/C++ compiler and network access. It does nothing when the tools are already installed.')
    .option('--tools-dir <path>', 'directory to install the tools into', DEFAULT_TOOLS_DIR)
    .option('--force', 'rebuild even when the tools are already installed', false)
    .option('--print-hash', 'print a hash of the build script, for keying a CI cache of the tools, and exit without building', false)
    .action((options: Options) => {
        if (options.printHash) {
            console.log(hashBuildScript(BUILD_SCRIPT_PATH));
            return;
        }

        buildPatchTools({
            buildScriptPath: BUILD_SCRIPT_PATH,
            toolsDir: path.resolve(options.toolsDir),
            force: options.force,
        });
    });
