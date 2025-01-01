const { program, Option } = require("commander");
const { findAndReadConfigFile } = require("../../utils/fsUtils");
const { updateReleaseHistory } = require("./updateReleaseHistory");

program.command('update-history')
    .requiredOption('-v, --app-version <string>', 'The app version for which update information is to be modified.')
    .requiredOption('-b, --binary-version <string>', 'The target binary version of the app for which update information is to be modified.')
    .addOption(new Option('-p, --platform <type>', 'platform').choices(['ios', 'android']).default('ios'))
    .option('-i, --identifier <string>', 'additional characters to identify the release')
    .option('-c, --config <path>', 'set config file name (JS/TS)', 'code-push.config.ts')
    .option('-m, --mandatory <bool>', 'make the release to be mandatory', parseBoolean, undefined)
    .option('-e, --enable <bool>', 'make the release to be enabled', parseBoolean, undefined)
    /**
     * @param {Object} options
     * @param {string} options.appVersion
     * @param {string} options.binaryVersion
     * @param {string} options.platform
     * @param {string} options.identifier
     * @param {string} options.config
     * @param {string} options.mandatory
     * @param {string} options.enable
     * @return {void}
     */
    .action(async (options) => {
        const config = findAndReadConfigFile(process.cwd(), options.config);

        if (typeof options.mandatory !== "boolean" && typeof options.enable !== "boolean") {
            console.error('No options specified. Exiting the program.')
            process.exit(1)
        }

        await updateReleaseHistory(
            options.appVersion,
            options.binaryVersion,
            config.getReleaseHistory,
            config.setReleaseHistory,
            options.platform,
            options.identifier,
            options.mandatory,
            options.enable,
        )
    });

function parseBoolean(value) {
    if (value === 'true') return true;
    if (value === 'false') return false;
    else return undefined;
}
