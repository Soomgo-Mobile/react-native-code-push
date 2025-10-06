import path from "path";
import shell from "shelljs";

/**
 * Run `expo bundle` CLI command
 *
 * @param bundleName {string} JS bundle file name
 * @param entryFile {string} App code entry file name (default: index.ts)
 * @param outputPath {string} Path to output JS bundle file and assets
 * @param platform {string} Platform (ios | android)
 * @param sourcemapOutput {string} Path to output sourcemap file (Warning: if sourcemapOutput points to the outputPath, the sourcemap will be included in the CodePush bundle and increase the deployment size)
 * @return {void}
 */
export function runExpoBundleCommand(
    bundleName: string,
    outputPath: string,
    platform: string,
    sourcemapOutput: string,
    entryFile: string,
): void {
    function getCliPath(): string {
        return path.join('node_modules', '.bin', 'expo');
    }

    const expoBundleArgs: string[] = [
        'export:embed',
        '--assets-dest',
        outputPath,
        '--bundle-output',
        path.join(outputPath, bundleName),
        '--dev',
        'false',
        '--entry-file',
        entryFile,
        '--platform',
        platform,
        '--sourcemap-output',
        sourcemapOutput,
        '--reset-cache',
    ];

    console.log('Running "expo export:embed" command:\n');

    shell.exec(`${getCliPath()} ${expoBundleArgs.join(' ')}`);
}
