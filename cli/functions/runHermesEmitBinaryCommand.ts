/**
 * code based on appcenter-cli
 */

import childProcess from "child_process";
import fs from "fs";
import path from "path";
import { createRequire } from "node:module";
import shell from "shelljs";

/**
 * Run Hermes compile CLI command
 *
 * @param bundleName {string} JS bundle file name
 * @param outputPath {string} Path to output .hbc file
 * @param sourcemapOutput {string} Path to output sourcemap file (Warning: if sourcemapOutput points to the outputPath, the sourcemap will be included in the CodePush bundle and increase the deployment size)
 * @param extraHermesFlags {string[]} Additional options to pass to `hermesc` command
 * @param projectRoot {string} Root directory of the target app project used to resolve the app's React Native module and locate the matching Hermes compiler. Defaults to the current working directory.
 * @return {Promise<void>}
 */
export async function runHermesEmitBinaryCommand(
    bundleName: string,
    outputPath: string,
    sourcemapOutput: string,
    extraHermesFlags: string[] = [],
    projectRoot: string = process.cwd(),
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
            const hermesCommand = getHermesCommand(projectRoot);

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
        const composeSourceMapsPath = getComposeSourceMapsPath(projectRoot);
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

function getHermesCommand(projectRoot: string): string {
    const fileExists = (file: string): boolean => {
        try {
            return fs.statSync(file).isFile();
        } catch (e) {
            return false;
        }
    };

    const hermescExecutable = path.join(getHermesCompilerPath(projectRoot), getHermesOSBin(), getHermesOSExe());
    if (fileExists(hermescExecutable)) {
        return hermescExecutable;
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

function getComposeSourceMapsPath(projectRoot: string): string | null {
    // detect if compose-source-maps.js script exists
    const composeSourceMaps = path.join(getReactNativePackagePath(projectRoot), 'scripts', 'compose-source-maps.js');
    if (fs.existsSync(composeSourceMaps)) {
        return composeSourceMaps;
    }
    return null;
}

function getReactNativePackagePath(projectRoot: string): string {
    const packagePath = resolvePackageRoot(projectRoot, 'react-native');
    if (packagePath !== null) {
        return packagePath;
    }

    return path.join(projectRoot, 'node_modules', 'react-native');
}

function getHermescDirPathInHermesCompilerPackage(projectRoot: string) {
    const reactNativePackagePath = getReactNativePackagePath(projectRoot);
    const hermescDirPath = path.join(path.dirname(reactNativePackagePath), 'hermes-compiler', 'hermesc');

    if (directoryExistsSync(hermescDirPath)) {
        return hermescDirPath;
    }

    return null;
}

function getHermesCompilerPath(projectRoot: string) {
    const hermescDirPath = getHermescDirPathInHermesCompilerPackage(projectRoot);
    if (hermescDirPath) {
        // Since react-native 0.83, Hermes compiler executables are in 'hermes-compiler' package
        return hermescDirPath
    } else {
        return path.join(getReactNativePackagePath(projectRoot), 'sdks', 'hermesc');
    }
}

function resolvePackageRoot(projectRoot: string, packageName: string): string | null {
    try {
        const projectRequire = createRequire(path.join(projectRoot, 'package.json'));
        const resolvedPath = projectRequire.resolve(packageName);
        return findPackageRoot(packageName, resolvedPath);
    } catch {
        return null;
    }
}

function findPackageRoot(packageName: string, resolvedPath: string): string | null {
    let currentPath = path.dirname(resolvedPath);

    while (true) {
        const packageJsonPath = path.join(currentPath, 'package.json');

        try {
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { name?: string };
            if (packageJson.name === packageName) {
                return currentPath;
            }
        } catch {
            // Continue traversing upward until the package root is found.
        }

        const parentPath = path.dirname(currentPath);
        if (parentPath === currentPath) {
            return null;
        }
        currentPath = parentPath;
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
