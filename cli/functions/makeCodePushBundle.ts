import path from "path";
import shell from "shelljs";
import { zip } from "../utils/zip.js";
import { generatePackageHashFromDirectory } from "../utils/hash-utils.js";

/**
 * Create a CodePush bundle file and return the information.
 *
 * @param contentsPath {string} The directory path containing the contents to be made into a CodePush bundle (usually the 'build/CodePush' directory))
 * @param bundleDirectory {string} The directory path to save the CodePush bundle file
 * @return {Promise<{ bundleFileName: string }>}
 */
export async function makeCodePushBundle(contentsPath: string, bundleDirectory: string): Promise<{ bundleFileName: string }> {
    const updateContentsZipPath = await zip(contentsPath);

    const packageHash = await generatePackageHashFromDirectory(contentsPath, path.join(contentsPath, '..'));

    shell.mkdir('-p', `./${bundleDirectory}`);
    shell.mv(updateContentsZipPath, `./${bundleDirectory}/${packageHash}`);

    return {
        // To allow the "release" command to get the file and hash value from the result of the "bundle" command,
        // use the hash value as the name of the file.
        bundleFileName: packageHash,
    };
}
