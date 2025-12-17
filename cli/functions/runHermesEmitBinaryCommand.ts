/**
 * code based on appcenter-cli
 */

import childProcess from "child_process";
import fs from "fs";
import path from "path";
import shell from "shelljs";

/**
 * Run Hermes compile CLI command
 *
 * @param bundleName {string} JS bundle file name
 * @param outputPath {string} Path to output .hbc file
 * @param sourcemapOutput {string} Path to output sourcemap file (Warning: if sourcemapOutput points to the outputPath, the sourcemap will be included in the CodePush bundle and increase the deployment size)
 * @param extraHermesFlags {string[]} Additional options to pass to `hermesc` command
 * @return {Promise<void>}
 */
export async function runHermesEmitBinaryCommand(
    bundleName: string,
    outputPath: string,
    sourcemapOutput: string,
    extraHermesFlags: string[] = [],
): Promise<void> {
    const hermesArgs: string[] = [
        '-emit-binary',
        '-out',
        path.join(outputPath, bundleName + '.hbc'),
        path.join(outputPath, bundleName),
        ...extraHermesFlags,
    ];
    if (sourcemapOutput) {
        hermesArgs.push('-output-source-map');
    }

    console.log('Converting JS bundle to byte code via Hermes, running command:\n');

    return new Promise<void>((resolve, reject) => {
        try {
            const hermesCommand = getHermesCommand();

            const disableAllWarningsArg = '-w';
            shell.exec(`${hermesCommand} ${hermesArgs.join(' ')} ${disableAllWarningsArg}`);

            // Copy HBC bundle to overwrite JS bundle
            const source = path.join(outputPath, bundleName + '.hbc');
            const destination = path.join(outputPath, bundleName);
            shell.cp(source, destination);
            shell.rm(source);
            resolve();
        } catch (e) {
            reject(e);
        }
    }).then(() => {
        if (!sourcemapOutput) {
            // skip source map compose if source map is not enabled
            return;
        }

        // compose-source-maps.js file path
        const composeSourceMapsPath = getComposeSourceMapsPath();
        if (composeSourceMapsPath === null) {
            throw new Error('react-native compose-source-maps.js scripts is not found');
        }

        const jsCompilerSourceMapFile = path.join(outputPath, bundleName + '.hbc' + '.map');
        if (!fs.existsSync(jsCompilerSourceMapFile)) {
            throw new Error(`sourcemap file ${jsCompilerSourceMapFile} is not found`);
        }

        return new Promise((resolve, reject) => {
            const composeSourceMapsArgs = [
                composeSourceMapsPath,
                sourcemapOutput,
                jsCompilerSourceMapFile,
                '-o',
                sourcemapOutput,
            ];
            const composeSourceMapsProcess = childProcess.spawn('node', composeSourceMapsArgs);
            console.log(`${composeSourceMapsPath} ${composeSourceMapsArgs.join(' ')}`);

            composeSourceMapsProcess.stdout.on('data', (data) => {
                console.log(data.toString().trim());
            });

            composeSourceMapsProcess.stderr.on('data', (data) => {
                console.error(data.toString().trim());
            });

            composeSourceMapsProcess.on('close', (exitCode, signal) => {
                if (exitCode !== 0) {
                    reject(new Error(`"compose-source-maps" command failed (exitCode=${exitCode}, signal=${signal}).`));
                }

                // Delete the HBC sourceMap, otherwise it will be included in 'code-push' bundle as well
                fs.unlink(jsCompilerSourceMapFile, (err) => {
                    if (err != null) {
                        console.error(err);
                        reject(err);
                    }

                    resolve();
                });
            });
        });
    });
}

function getHermesCommand(): string {
    const fileExists = (file: string): boolean => {
        try {
            return fs.statSync(file).isFile();
        } catch (e) {
            return false;
        }
    };
    const reactNativePath = getReactNativePackagePath();
    const hermesCompilerPath = getHermesCompilerPackagePath();

    // Since react-native 0.83, Hermes compiler in 'hermes-compiler' package
    if (hermesCompilerPath) {
        const engine = path.join(hermesCompilerPath, 'hermesc', getHermesOSBin(), getHermesOSExe());
        if (fileExists(engine)) {
            return engine;
        }
    }

    // Hermes is bundled with react-native since 0.69
    const bundledHermesEngine = path.join(reactNativePath, 'sdks', 'hermesc', getHermesOSBin(), getHermesOSExe());
    // Hermes is bundled with react-native since 0.69
    if (fileExists(bundledHermesEngine)) {
        return bundledHermesEngine;
    }
    throw new Error('Hermes engine binary not found. Please upgrade to react-native 0.69 or later');
}

function getHermesOSBin() {
    switch (process.platform) {
        case 'win32':
            return 'win64-bin';
        case 'darwin':
            return 'osx-bin';
        case 'freebsd':
        case 'linux':
        case 'sunos':
        default:
            return 'linux64-bin';
    }
}

function getHermesOSExe(): string {
    const hermesExecutableName = 'hermesc';
    switch (process.platform) {
        case 'win32':
            return hermesExecutableName + '.exe';
        default:
            return hermesExecutableName;
    }
}

function getComposeSourceMapsPath(): string | null {
    // detect if compose-source-maps.js script exists
    const composeSourceMaps = path.join(getReactNativePackagePath(), 'scripts', 'compose-source-maps.js');
    if (fs.existsSync(composeSourceMaps)) {
        return composeSourceMaps;
    }
    return null;
}

function getReactNativePackagePath(): string {
    const result = childProcess.spawnSync('node', [
        '--print',
        "require.resolve('react-native/package.json')",
    ]);
    const packagePath = path.dirname(result.stdout.toString());
    if (result.status === 0 && directoryExistsSync(packagePath)) {
        return packagePath;
    }

    return path.join('node_modules', 'react-native');
}

function getHermesCompilerPackagePath() {
    try {
        const result = childProcess.spawnSync('node', [
            '--print',
            "require.resolve('hermes-compiler/package.json')",
        ]);
        const packagePath = path.dirname(result.stdout.toString());
        if (result.status === 0 && directoryExistsSync(packagePath)) {
            return packagePath;
        }
        return path.join('node_modules', 'hermes-compiler');
    } catch {
        return null;
    }
}

function directoryExistsSync(dirname: string): boolean {
    try {
        return fs.statSync(dirname).isDirectory();
    } catch (err: unknown) {
        if ((err as any).code !== 'ENOENT') {
            throw err;
        }
    }
    return false;
}
