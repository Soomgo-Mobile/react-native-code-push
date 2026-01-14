import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";

const PACKAGE_NAME = "@bravemobile/react-native-code-push";
const REPO_ROOT = path.resolve(__dirname, "../..");
const TEMPLATE_ROOT = process.cwd();
const LOCAL_NPM_CACHE = path.join(REPO_ROOT, ".npm-cache");

ensureDirectory(LOCAL_NPM_CACHE);

async function main() {
  try {
    await syncLocalLibrary();
    console.log(`✅ Synced ${PACKAGE_NAME} from ${REPO_ROOT}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ Failed to sync local library: ${message}`);
    process.exitCode = 1;
  } finally {
    fs.rmSync(LOCAL_NPM_CACHE, { recursive: true, force: true });
  }
}

async function syncLocalLibrary(): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "code-push-sync-"));
  try {
    await runCommand(
      "npm",
      ["pack", "--pack-destination", tempDir],
      REPO_ROOT,
      { npm_config_cache: LOCAL_NPM_CACHE }
    );
    const tarball = findTarball(tempDir);
    const extractDir = path.join(tempDir, "extract");
    fs.mkdirSync(extractDir, { recursive: true });
    await runCommand("tar", ["-xzf", tarball, "-C", extractDir], REPO_ROOT);
    const packageSource = path.join(extractDir, "package");
    if (!fs.existsSync(packageSource)) {
      throw new Error("Failed to extract npm pack output.");
    }

    const targetDir = getNodeModulesPath();
    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
    fs.cpSync(packageSource, targetDir, { recursive: true });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function getNodeModulesPath(): string {
  const segments = PACKAGE_NAME.split("/");
  return path.join(TEMPLATE_ROOT, "node_modules", ...segments);
}

function findTarball(tempDir: string): string {
  const files = fs.readdirSync(tempDir).filter((file) => file.endsWith(".tgz"));
  if (files.length === 0) {
    throw new Error("npm pack did not produce a tarball.");
  }
  if (files.length > 1) {
    throw new Error("Multiple tarballs found. Clean temp directory and retry.");
  }
  return path.join(tempDir, files[0]);
}

function runCommand(
  command: string,
  args: string[],
  cwd: string,
  extraEnv?: Record<string, string>
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      env: {
        ...process.env,
        ...extraEnv
      }
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} command failed (exit code: ${code})`));
      }
    });
  });
}

function ensureDirectory(targetDir: string) {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
}

void main();
