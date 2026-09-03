import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { require as tsxRequire } from "tsx/cjs/api";
import type { CliConfigInterface } from "../../typings/react-native-code-push.d.ts";

/**
 * allows to require a config file with .ts extension
 */
function requireConfig(filePath: string): CliConfigInterface {
  const ext = path.extname(filePath);

  if (ext === '.ts') {
    // tsx compiles the file and the project files it imports, resolving tsconfig `paths` aliases
    // from the tsconfig.json nearest to the working directory, which is the project root when the CLI runs.
    return unwrapDefaultExport(tsxRequire(filePath, filePath));
  } else if (ext === '.js') {
    // do nothing
  } else {
    throw new Error(`Unsupported file extension: ${ext}`);
  }

  return unwrapDefaultExport(createRequire(filePath)(filePath));
}

// `export default` compiles to `exports.default`; `module.exports =` is returned as is.
function unwrapDefaultExport(loaded: { default?: unknown }): CliConfigInterface {
  return (loaded.default ?? loaded) as CliConfigInterface;
}

export function findAndReadConfigFile(startDir: string, configFileName: string): CliConfigInterface {
  let dir = startDir;

  while (dir !== path.parse(dir).root) {
    const configPath = path.join(dir, configFileName);
    if (fs.existsSync(configPath)) {
      return requireConfig(configPath);
    }
    dir = path.dirname(dir);
  }

  throw new Error(`${configFileName} not found.`);
}
