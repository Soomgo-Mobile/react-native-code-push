import fs from "fs";
import path from "path";
import { createRequire } from "module";
import type { CliConfigInterface } from "../../typings/react-native-code-push.d.ts";

/**
 * allows to require a config file with .ts extension
 */
function requireConfig(filePath: string): CliConfigInterface {
  const ext = path.extname(filePath);
  // Resolve the loader from the project the config file lives in, not from the CLI install.
  const projectRequire = createRequire(filePath);

  if (ext === '.ts') {
    return unwrapDefaultExport(requireTsConfig(projectRequire, filePath));
  } else if (ext === '.js') {
    // do nothing
  } else {
    throw new Error(`Unsupported file extension: ${ext}`);
  }

  return unwrapDefaultExport(projectRequire(filePath));
}

/**
 * tsx is preferred: it needs no tsconfig setup and resolves tsconfig `paths` aliases on its own.
 * ts-node keeps working for projects that already have it configured.
 */
function requireTsConfig(projectRequire: NodeRequire, filePath: string): { default?: unknown } {
  if (canResolve(projectRequire, 'tsx/cjs/api')) {
    const { require: tsxRequire } = projectRequire('tsx/cjs/api') as {
      require: (id: string, fromFile: string) => { default?: unknown };
    };
    return tsxRequire(filePath, filePath);
  }

  if (canResolve(projectRequire, 'ts-node/register')) {
    projectRequire('ts-node/register');
    return projectRequire(filePath);
  }

  console.error('A TypeScript config file needs a loader. Please install tsx as a devDependency (`npm i -D tsx`).');
  process.exit(1);
}

function canResolve(projectRequire: NodeRequire, id: string): boolean {
  try {
    projectRequire.resolve(id);
    return true;
  } catch {
    return false;
  }
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
