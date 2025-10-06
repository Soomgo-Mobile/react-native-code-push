import { program, Option } from "commander";
import { findAndReadConfigFile } from "../../utils/fsUtils.js";
import { CONFIG_FILE_NAME } from "../../constant.js";

type Options = {
    binaryVersion: string;
    platform: 'ios' | 'android';
    identifier?: string;
    config: string;
}

program.command('show-history')
    .description('Retrieves and prints the release history of a specific binary version.\n`getReleaseHistory` function should be implemented in the config file.')
    .requiredOption('-b, --binary-version <string>', '(Required) The target binary version for retrieving the release history.')
    .addOption(new Option('-p, --platform <type>', 'platform').choices(['ios', 'android']).default('ios'))
    .option('-i, --identifier <string>', 'reserved characters to distinguish the release.')
    .option('-c, --config <path>', 'configuration file name (JS/TS)', CONFIG_FILE_NAME)
    .action(async (options: Options) => {
        const config = findAndReadConfigFile(process.cwd(), options.config);

        const releaseHistory = await config.getReleaseHistory(
            options.binaryVersion,
            options.platform,
            options.identifier
        );

        console.log(JSON.stringify(releaseHistory, null, 2));
    });
