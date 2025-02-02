const { program, Option } = require("commander");
const SemVer = require('semver');
const { findAndReadConfigFile } = require("../../utils/fsUtils");
const { release } = require("./release");

program.command('release')
    .description('Deploys a new CodePush update for a target binary app.\nAfter creating the CodePush bundle, it uploads the file and updates the ReleaseHistory information.\n`bundleUploader`, `getReleaseHistory`, and `setReleaseHistory` functions should be implemented in the config file.')
    .requiredOption('-v, --app-version <string>', '(Required) The app version to be released. It must be greater than the binary version.')
    .addOption(new Option('-p, --platform <type>', 'platform').choices(['ios', 'android']).default('ios'))
    .option('-i, --identifier <string>', 'reserved characters to distinguish the release.')
    .option('-c, --config <path>', 'set config file name (JS/TS)', 'code-push.config.ts')
    .option('-o, --output-path <string>', 'path to output root directory', 'build')
    .option('-e, --entry-file <string>', 'path to JS/TS entry file', 'index.ts')
    .option('-j, --js-bundle-name <string>', 'JS bundle file name (default-ios: "main.jsbundle" / default-android: "index.android.bundle")')
    .option('-m, --mandatory <bool>', 'make the release to be mandatory', parseBoolean, false)
    .option('--enable <bool>', 'make the release to be enabled', parseBoolean, true)
    /**
     * @param {Object} options
     * @param {string} options.binaryVersion
     * @param {string} options.appVersion
     * @param {string} options.platform
     * @param {string} options.identifier
     * @param {string} options.config
     * @param {string} options.outputPath
     * @param {string} options.entryFile
     * @param {string} options.bundleName
     * @param {string} options.mandatory
     * @param {string} options.enable
     * @return {void}
     */
    .action(async (options) => {
        if (SemVer.lte(options.appVersion, options.binaryVersion)) {
            console.error('The app version must be greater than the binary version.');
            process.exit(1);
        }

        const config = findAndReadConfigFile(process.cwd(), options.config);

        await release(
            config.bundleUploader,
            config.getReleaseHistory,
            config.setReleaseHistory,
            options.binaryVersion,
            options.appVersion,
            options.platform,
            options.identifier,
            options.outputPath,
            options.entryFile,
            options.bundleName,
            options.mandatory,
            options.enable,
        )

        console.log('🚀 Release completed.')
    });

function parseBoolean(value) {
    if (value === 'true') return true;
    if (value === 'false') return false;
    else return undefined;
}
