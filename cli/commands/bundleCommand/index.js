const { program, Option } = require("commander");
const { bundleCodePush } = require("./bundleCodePush");
const { OUTPUT_BUNDLE_DIR, ROOT_OUTPUT_DIR, ENTRY_FILE } = require('../../constant');

program.command('bundle')
    .description('Creates a CodePush bundle file (assumes Hermes is enabled).')
    .addOption(new Option('-p, --platform <type>', 'platform').choices(['ios', 'android']).default('ios'))
    .option('-o, --output-path <string>', 'path to output root directory', ROOT_OUTPUT_DIR)
    .option('-e, --entry-file <string>', 'path to JS/TS entry file', ENTRY_FILE)
    .option('-b, --bundle-name <string>', 'bundle file name (default-ios: "main.jsbundle" / default-android: "index.android.bundle")')
    .option('--output-bundle-dir <string>', 'name of directory containing the bundle file created by the "bundle" command', OUTPUT_BUNDLE_DIR)
    /**
     * @param {Object} options
     * @param {string} options.platform
     * @param {string} options.outputPath
     * @param {string} options.entryFile
     * @param {string} options.bundleName
     * @param {string} options.outputBundleDir
     * @return {void}
     */
    .action((options) => {
        bundleCodePush(
            options.platform,
            options.outputPath,
            options.entryFile,
            options.bundleName,
            `${options.outputPath}/${options.outputBundleDir}`,
        )
    });
