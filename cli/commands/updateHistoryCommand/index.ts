import { program, Option } from "commander";
import { findAndReadConfigFile } from "../../utils/fsUtils.js";
import { updateReleaseHistory } from "./updateReleaseHistory.js";
import { CONFIG_FILE_NAME } from "../../constant.js";

type Options = {
    appVersion: string;
    binaryVersion: string;
    platform: 'ios' | 'android';
    identifier?: string;
    config: string;
    mandatory?: boolean;
    enable?: boolean;
    rollout?: number;
}

program.command('update-history')
    .description('Updates the release history for a specific binary version.\n`getReleaseHistory`, `setReleaseHistory` functions should be implemented in the config file.')
    .requiredOption('-v, --app-version <string>', '(Required) The app version for which update information is to be modified.')
    .requiredOption('-b, --binary-version <string>', '(Required) The target binary version of the app for which update information is to be modified.')
    .addOption(new Option('-p, --platform <type>', 'platform').choices(['ios', 'android']).default('ios'))
    .option('-i, --identifier <string>', 'reserved characters to distinguish the release.')
    .option('-c, --config <path>', 'set config file name (JS/TS)', CONFIG_FILE_NAME)
    .option('-m, --mandatory <bool>', 'make the release to be mandatory', parseBoolean, undefined)
    .option('-e, --enable <bool>', 'make the release to be enabled', parseBoolean, undefined)
    .option('--rollout <number>', 'rollout percentage (0-100)', parseFloat, undefined)
    .action(async (options: Options) => {
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
            options.rollout
        )
    });

function parseBoolean(value: string) {
    if (value === 'true') return true;
    if (value === 'false') return false;
    else return undefined;
}
