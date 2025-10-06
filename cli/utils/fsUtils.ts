import fs from "fs";
import path from "path";
import { createRequire } from "module";
import type { CliConfigInterface } from "../../typings/react-native-code-push.d.ts";

const nodeRequire = createRequire(import.meta.url);

/**
 * allows to require a config file with .ts extension
 */
function requireConfig(filePath: string): CliConfigInterface {
  const ext = path.extname(filePath);

  if (ext === '.ts') {
    try {
      nodeRequire('ts-node/register');
    } catch {
      console.error('ts-node not found. Please install ts-node as a devDependency.');
      process.exit(1);
    }
  } else if (ext === '.js') {
    // do nothing
  } else {
    throw new Error(`Unsupported file extension: ${ext}`);
  }

  return nodeRequire(filePath) as CliConfigInterface;
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
