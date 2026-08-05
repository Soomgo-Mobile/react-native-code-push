/**
 * code based on appcenter-cli
 */

import childProcess from "child_process";
import fs from "fs";
import path from "path";
import { createRequire } from "node:module";
import shell from "shelljs";

/**
 * Tells Hermes to lay the compiled bytecode out like an existing bundle's, which keeps
 * the binary patch between the two small. Older compilers do not have the flag.
 */
const BASE_BYTECODE_FLAG = '-base-bytecode';

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
            const compileResult = shell.exec(`${hermesCommand} ${hermesArgs.join(' ')} ${disableAllWarningsArg}`);
            if (compileResult.code !== 0) {
                // Reported here rather than left to the missing .hbc file, so a rejected
                // flag - a base bundle that is not Hermes bytecode, for instance - fails
                // the release instead of silently producing an unaligned bundle.
                const extraFlagsHint = extraHermesFlags.length > 0
                    ? ` Additional options: ${extraHermesFlags.join(' ')}`
                    : '';
                throw new Error(`"hermesc" command failed (exitCode=${compileResult.code}).${extraFlagsHint}`);
            }

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

/**
 * Builds the flags that align a compilation with the bundle already inside the app
 * binary, so the binary patch between them stays small.
 *
 * When the app's Hermes compiler predates the flag the release still goes ahead
 * without it: the patch is then computed against unaligned bytecode and is larger, but
 * it is still a valid patch. A compiler that does accept the flag and fails is a
 * different matter and fails the release, because the base input is then wrong.
 *
 * @param baseBundlePath {string} JS bundle from the target binary to align against
 * @param projectRoot {string} Root directory of the target app project, used to locate its Hermes compiler
 * @return {string[]} Flags to pass to `runHermesEmitBinaryCommand` as `extraHermesFlags`
 */
export function resolveBaseBytecodeHermesFlags(baseBundlePath: string, projectRoot: string = process.cwd()): string[] {
    if (!hermesSupportsBaseBytecode(projectRoot)) {
        console.warn(
            `warn: The Hermes compiler of this app does not support "${BASE_BYTECODE_FLAG}". ` +
                'Compiling without it, which makes the binary patch larger.',
        );
        return [];
    }

    return [BASE_BYTECODE_FLAG, baseBundlePath];
}

/** Whether a `hermesc --help` output advertises the base bytecode flag. */
export function helpOutputSupportsBaseBytecode(helpOutput: string): boolean {
    return helpOutput.includes(BASE_BYTECODE_FLAG);
}

function hermesSupportsBaseBytecode(projectRoot: string): boolean {
    const hermesCommand = getHermesCommand(projectRoot);
    const result = childProcess.spawnSync(hermesCommand, ['--help'], { encoding: 'utf8' });

    if (result.error) {
        throw new Error(`failed to run "${hermesCommand} --help": ${result.error.message}`);
    }

    return helpOutputSupportsBaseBytecode(`${result.stdout ?? ''}${result.stderr ?? ''}`);
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
