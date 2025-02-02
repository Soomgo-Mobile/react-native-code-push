const { program, Option } = require("commander");
const { findAndReadConfigFile } = require("../../utils/fsUtils");

program.command('show-history')
    .description('Retrieves and prints the release history of a specific binary version.\n`getReleaseHistory` function should be implemented in the config file.')
    .requiredOption('-b, --binary-version <string>', '(Required) The target binary version for retrieving the release history.')
    .addOption(new Option('-p, --platform <type>', 'platform').choices(['ios', 'android']).default('ios'))
    .option('-i, --identifier <string>', 'reserved characters to distinguish the release.')
    .option('-c, --config <path>', 'configuration file name (JS/TS)', 'code-push.config.ts')
    /**
     * @param {Object} options
     * @param {string} options.binaryVersion
     * @param {string} options.platform
     * @param {string} options.identifier
     * @param {string} options.config
     * @return {void}
     */
    .action(async (options) => {
        const config = findAndReadConfigFile(process.cwd(), options.config);

        const releaseHistory = await config.getReleaseHistory(
            options.binaryVersion,
            options.platform,
            options.identifier
        );

        console.log(JSON.stringify(releaseHistory, null, 2));
    });
