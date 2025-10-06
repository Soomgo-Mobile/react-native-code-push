import { program, Option } from "commander";
import { findAndReadConfigFile } from "../../utils/fsUtils.js";
import { createReleaseHistory } from "./createReleaseHistory.js";
import { CONFIG_FILE_NAME } from "../../constant.js";

type Options = {
    binaryVersion: string;
    platform: 'ios' | 'android';
    identifier?: string;
    config: string;
}

program.command('create-history')
    .description('Creates a new release history for the binary app.')
    .requiredOption('-b, --binary-version <string>', '(Required) The target binary version')
    .addOption(new Option('-p, --platform <type>', 'platform').choices(['ios', 'android']).default('ios'))
    .option('-i, --identifier <string>', 'reserved characters to distinguish the release.')
    .option('-c, --config <path>', 'set config file name (JS/TS)', CONFIG_FILE_NAME)
    .action(async (options: Options) => {
        const config = findAndReadConfigFile(process.cwd(), options.config);

        await createReleaseHistory(
            options.binaryVersion,
            config.setReleaseHistory,
            options.platform,
            options.identifier
        );
    });
