import { program, Option } from "commander";
import { bundleCodePush } from "./bundleCodePush.js";
import { OUTPUT_BUNDLE_DIR, ROOT_OUTPUT_DIR, ENTRY_FILE } from "../../constant.js";

type Options = {
    framework: 'expo' | undefined;
    platform: 'ios' | 'android';
    outputPath: string;
    entryFile: string;
    bundleName: string;
    outputBundleDir: string;
}

program.command('bundle')
    .description('Creates a CodePush bundle file (assumes Hermes is enabled).')
    .addOption(new Option('-f, --framework <type>', 'framework type (expo)').choices(['expo']))
    .addOption(new Option('-p, --platform <type>', 'platform').choices(['ios', 'android']).default('ios'))
    .option('-o, --output-path <string>', 'path to output root directory', ROOT_OUTPUT_DIR)
    .option('-e, --entry-file <string>', 'path to JS/TS entry file', ENTRY_FILE)
    .option('-b, --bundle-name <string>', 'bundle file name (default-ios: "main.jsbundle" / default-android: "index.android.bundle")')
    .option('--output-bundle-dir <string>', 'name of directory containing the bundle file created by the "bundle" command', OUTPUT_BUNDLE_DIR)
    .action((options: Options) => {
        bundleCodePush(
            options.framework,
            options.platform,
            options.outputPath,
            options.entryFile,
            options.bundleName,
            `${options.outputPath}/${options.outputBundleDir}`,
        )
    });
