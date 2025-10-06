import fs from "fs";
import { prepareToBundleJS } from "../../functions/prepareToBundleJS.js";
import { runReactNativeBundleCommand } from "../../functions/runReactNativeBundleCommand.js";
import { runExpoBundleCommand } from "../../functions/runExpoBundleCommand.js";
import { getReactTempDir } from "../../functions/getReactTempDir.js";
import { runHermesEmitBinaryCommand } from "../../functions/runHermesEmitBinaryCommand.js";
import { makeCodePushBundle } from "../../functions/makeCodePushBundle.js";
import { ROOT_OUTPUT_DIR, ENTRY_FILE } from "../../constant.js";

/**
 * @return {Promise<string>} CodePush bundle file name (equals to packageHash)
 */
export async function bundleCodePush(
  framework: 'expo' | undefined,
  platform: 'ios' | 'android' = 'ios',
  outputRootPath: string = ROOT_OUTPUT_DIR,
  entryFile: string = ENTRY_FILE,
  jsBundleName: string, // JS bundle file name (not CodePush bundle file)
  bundleDirectory: string, // CodePush bundle output directory
): Promise<string> {
    if (fs.existsSync(outputRootPath)) {
        fs.rmSync(outputRootPath, { recursive: true });
    }

    const OUTPUT_CONTENT_PATH = `${outputRootPath}/CodePush`;
    const DEFAULT_JS_BUNDLE_NAME = platform === 'ios' ? 'main.jsbundle' : 'index.android.bundle';
    const _jsBundleName = jsBundleName || DEFAULT_JS_BUNDLE_NAME; // react-native JS bundle output name
    const SOURCEMAP_OUTPUT = `${outputRootPath}/${_jsBundleName}.map`;

    prepareToBundleJS({ deleteDirs: [outputRootPath, getReactTempDir()], makeDir: OUTPUT_CONTENT_PATH });

    if (framework === 'expo') {
      runExpoBundleCommand(
        _jsBundleName,
        OUTPUT_CONTENT_PATH,
        platform,
        SOURCEMAP_OUTPUT,
        entryFile,
      );
    } else {
      runReactNativeBundleCommand(
        _jsBundleName,
        OUTPUT_CONTENT_PATH,
        platform,
        SOURCEMAP_OUTPUT,
        entryFile,
      );
    }

    console.log('log: JS bundling complete');

    await runHermesEmitBinaryCommand(
      _jsBundleName,
      OUTPUT_CONTENT_PATH,
      SOURCEMAP_OUTPUT,
    );
    console.log('log: Hermes compilation complete');

    const { bundleFileName: codePushBundleFileName } = await makeCodePushBundle(OUTPUT_CONTENT_PATH, bundleDirectory);
    console.log(`log: CodePush bundle created (file path: ./${bundleDirectory}/${codePushBundleFileName})`);

    return codePushBundleFileName;
}
