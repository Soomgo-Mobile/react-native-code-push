/**
 * code based on appcenter-cli
 */

import os from "os";

/**
 * Return the path of the temporary directory for react-native bundling
 */
export function getReactTempDir(): string {
    return `${os.tmpdir()}/react-*`;
}
