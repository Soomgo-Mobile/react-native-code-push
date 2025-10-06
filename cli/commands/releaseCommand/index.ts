import { program, Option } from "commander";
import { findAndReadConfigFile } from "../../utils/fsUtils.js";
import { release } from "./release.js";
import { OUTPUT_BUNDLE_DIR, CONFIG_FILE_NAME, ROOT_OUTPUT_DIR, ENTRY_FILE } from "../../constant.js";

type Options = {
    binaryVersion: string;
    appVersion: string;
    framework: 'expo' | undefined;
    platform: 'ios' | 'android';
    identifier?: string;
    config: string;
    outputPath: string;
    entryFile: string;
    bundleName: string;
    mandatory: boolean;
    enable: boolean;
    rollout?: number;
    skipBundle: boolean;
    skipCleanup: boolean;
    outputBundleDir: string;
}

program.command('release')
    .description('Deploys a new CodePush update for a target binary app.\nAfter creating the CodePush bundle, it uploads the file and updates the ReleaseHistory information.\n`bundleUploader`, `getReleaseHistory`, and `setReleaseHistory` functions should be implemented in the config file.')
    .requiredOption('-b, --binary-version <string>', '(Required) The target binary version')
    .requiredOption('-v, --app-version <string>', '(Required) The app version to be released. It must be greater than the binary version.')
    .addOption(new Option('-f, --framework <type>', 'framework type (expo)').choices(['expo']))
    .addOption(new Option('-p, --platform <type>', 'platform').choices(['ios', 'android']).default('ios'))
    .option('-i, --identifier <string>', 'reserved characters to distinguish the release.')
    .option('-c, --config <path>', 'set config file name (JS/TS)', CONFIG_FILE_NAME)
    .option('-o, --output-path <string>', 'path to output root directory', ROOT_OUTPUT_DIR)
    .option('-e, --entry-file <string>', 'path to JS/TS entry file', ENTRY_FILE)
    .option('-j, --js-bundle-name <string>', 'JS bundle file name (default-ios: "main.jsbundle" / default-android: "index.android.bundle")')
    .option('-m, --mandatory <bool>', 'make the release to be mandatory', parseBoolean, false)
    .option('--enable <bool>', 'make the release to be enabled', parseBoolean, true)
    .option('--rollout <number>', 'rollout percentage (0-100)', parseFloat)
    .option('--skip-bundle <bool>', 'skip bundle process', parseBoolean, false)
    .option('--skip-cleanup <bool>', 'skip cleanup process', parseBoolean, false)
    .option('--output-bundle-dir <string>', 'name of directory containing the bundle file created by the "bundle" command', OUTPUT_BUNDLE_DIR)
    .action(async (options: Options) => {
        const config = findAndReadConfigFile(process.cwd(), options.config);

        if (typeof options.rollout === 'number' && (options.rollout < 0 || options.rollout > 100)) {
            console.error('Rollout percentage number must be between 0 and 100 (inclusive).');
            process.exit(1);
        }

        await release(
            config.bundleUploader,
            config.getReleaseHistory,
            config.setReleaseHistory,
            options.binaryVersion,
            options.appVersion,
            options.framework,
            options.platform,
            options.identifier,
            options.outputPath,
            options.entryFile,
            options.bundleName,
            options.mandatory,
            options.enable,
            options.rollout,
            options.skipBundle,
            options.skipCleanup,
            `${options.outputPath}/${options.outputBundleDir}`,
        )

        console.log('🚀 Release completed.')
    });

function parseBoolean(value: string): boolean | undefined {
    if (value === 'true') return true;
    if (value === 'false') return false;
    else return undefined;
}
