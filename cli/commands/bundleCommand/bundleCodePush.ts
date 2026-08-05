import fs from "fs";
import path from "path";
import { prepareToBundleJS } from "../../functions/prepareToBundleJS.js";
import { runReactNativeBundleCommand } from "../../functions/runReactNativeBundleCommand.js";
import { runExpoBundleCommand } from "../../functions/runExpoBundleCommand.js";
import { getReactTempDir } from "../../functions/getReactTempDir.js";
import { resolveBaseBytecodeHermesFlags, runHermesEmitBinaryCommand } from "../../functions/runHermesEmitBinaryCommand.js";
import { makeCodePushBundle } from "../../functions/makeCodePushBundle.js";
import { hashBundleFile, writeBinaryPatchBaseRecord } from "../../functions/makeBinaryPatchBundle.js";
import { ROOT_OUTPUT_DIR, ENTRY_FILE } from "../../constant.js";

export type CodePushBundleResult = {
  /** CodePush bundle file name (equals to packageHash) */
  bundleFileName: string;
  /** Directory holding the files that were packed into the CodePush bundle file */
  contentsPath: string;
  /** JS bundle file name inside the contents directory */
  jsBundleName: string;
};

/**
 * JS bundle file name react-native writes, which is also the name the app looks for
 * inside an update, so it has to be decided the same way everywhere.
 */
export function resolveJsBundleName(platform: 'ios' | 'android', jsBundleName?: string): string {
  const DEFAULT_JS_BUNDLE_NAME = platform === 'ios' ? 'main.jsbundle' : 'index.android.bundle';
  return jsBundleName || DEFAULT_JS_BUNDLE_NAME;
}

/**
 * @param baseBundlePath {string} JS bundle from the target binary. When given, the compilation is aligned with it and the base is recorded for a later `release`.
 * @return {Promise<CodePushBundleResult>} CodePush bundle file name (equals to packageHash) and the contents it was made of
 */
export async function bundleCodePush(
  framework: 'expo' | undefined,
  platform: 'ios' | 'android' = 'ios',
  outputRootPath: string = ROOT_OUTPUT_DIR,
  entryFile: string = ENTRY_FILE,
  jsBundleName: string | undefined, // JS bundle file name (not CodePush bundle file)
  bundleDirectory: string, // CodePush bundle output directory
  outputMetroDir?: string,
  baseBundlePath?: string,
): Promise<CodePushBundleResult> {
    if (fs.existsSync(outputRootPath)) {
        fs.rmSync(outputRootPath, { recursive: true });
    }

    const OUTPUT_CONTENT_PATH = `${outputRootPath}/CodePush`;
    const _jsBundleName = resolveJsBundleName(platform, jsBundleName); // react-native JS bundle output name
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

    copyMetroOutputsIfNeeded(outputRootPath, outputMetroDir, OUTPUT_CONTENT_PATH, _jsBundleName, SOURCEMAP_OUTPUT);

    await runHermesEmitBinaryCommand(
      _jsBundleName,
      OUTPUT_CONTENT_PATH,
      SOURCEMAP_OUTPUT,
      baseBundlePath ? resolveBaseBytecodeHermesFlags(baseBundlePath) : [],
    );
    console.log('log: Hermes compilation complete');

    const { bundleFileName: codePushBundleFileName } = await makeCodePushBundle(OUTPUT_CONTENT_PATH, bundleDirectory);
    console.log(`log: CodePush bundle created (file path: ./${bundleDirectory}/${codePushBundleFileName})`);

    if (baseBundlePath) {
      // Written after the bundle file, and to the output root instead of the update
      // contents, so recording the base cannot change what was just packed or its hash.
      const recordPath = writeBinaryPatchBaseRecord(outputRootPath, hashBundleFile(baseBundlePath));
      console.log(`log: Binary patch base recorded (file path: ${recordPath})`);
    }

    return {
      bundleFileName: codePushBundleFileName,
      contentsPath: OUTPUT_CONTENT_PATH,
      jsBundleName: _jsBundleName,
    };
}

function copyMetroOutputsIfNeeded(
  outputRootPath: string,
  outputMetroDir: string | undefined,
  outputContentPath: string,
  jsBundleName: string,
  sourceMapOutputPath: string,
) {
    if (!outputMetroDir) {
        return;
    }

    const resolvedOutputMetroDir = path.join(outputRootPath, outputMetroDir);

    fs.mkdirSync(resolvedOutputMetroDir, { recursive: true });
    fs.copyFileSync(
        path.join(outputContentPath, jsBundleName),
        path.join(resolvedOutputMetroDir, jsBundleName),
    );
    fs.copyFileSync(
        sourceMapOutputPath,
        path.join(resolvedOutputMetroDir, path.basename(sourceMapOutputPath)),
    );
    console.log(`log: Metro outputs copied to: ${resolvedOutputMetroDir}`);
}
