const { program, Option } = require("commander");
const { findAndReadConfigFile } = require("../../utils/fsUtils");
const { release } = require("./release");

program.command('release')
    .requiredOption('-b, --binary-version <string>', 'target app binary version')
    .requiredOption('-v, --app-version <string>', 'The app version to be released')
    .addOption(new Option('-p, --platform <type>', 'platform').choices(['ios', 'android']).default('ios'))
    .option('-i, --identifier <string>', 'additional characters to identify the release')
    .option('-c, --config <path>', 'set config file name (JS/TS)', 'code-push.config.ts')
    .option('-o, --output-path <string>', 'path to output root directory', 'build')
    .option('-e, --entry-file <string>', 'path to JS/TS entry file', 'index.ts')
    .option('-j, --js-bundle-name <string>', 'JS bundle file name (default-ios: "main.jsbundle" / default-android: "index.android.bundle")')
    .requiredOption('-d, --destination-path <string>', 'CodePush bundle upload destination path')
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
     * @param {string} options.destinationPath
     * @param {string} options.mandatory
     * @param {string} options.enable
     * @return {void}
     */
    .action(async (options) => {
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
