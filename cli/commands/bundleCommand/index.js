const { program, Option } = require("commander");
const { bundleCodePush } = require("./bundleCodePush");

program.command('bundle')
    .description('Creates a CodePush bundle file (assumes Hermes is enabled).')
    .addOption(new Option('-p, --platform <type>', 'platform').choices(['ios', 'android']).default('ios'))
    .option('-o, --output-path <string>', 'path to output root directory', 'build')
    .option('-e, --entry-file <string>', 'path to JS/TS entry file', 'index.ts')
    .option('-b, --bundle-name <string>', 'bundle file name (default-ios: "main.jsbundle" / default-android: "index.android.bundle")')
    /**
     * @param {Object} options
     * @param {string} options.platform
     * @param {string} options.outputPath
     * @param {string} options.entryFile
     * @param {string} options.bundleName
     * @return {void}
     */
    .action((options) => {
        bundleCodePush(
            options.platform,
            options.outputPath,
            options.entryFile,
            options.bundleName,
        )
    });
