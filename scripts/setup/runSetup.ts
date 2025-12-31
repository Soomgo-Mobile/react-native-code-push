import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import semver from 'semver';

interface SetupCliOptions {
  rnVersion: string;
  workingDir: string;
}

interface SetupContext {
  rnVersion: string;
  projectName: string;
  workingDirectory: string;
  projectPath: string;
}

type SetupStep = {
  name: string;
  description: string;
  run: (context: SetupContext) => Promise<void>;
};

const program = new Command()
  .name('setup-automation')
  .description('React Native CodePush 테스트 앱 셋업 자동화')
  .requiredOption('-v, --rn-version <version>', '테스트할 React Native 버전 (예: 0.83.1)')
  .option(
    '-w, --working-dir <path>',
    '템플릿 앱을 생성할 경로',
    path.resolve(process.cwd(), 'Examples')
  );

const setupSteps: SetupStep[] = [
  {
    name: 'create-react-native-template',
    description: 'RN 템플릿 앱 생성',
    run: createReactNativeTemplateApp
  }
];

async function main() {
  const options = program.parse(process.argv).opts<SetupCliOptions>();

  try {
    const normalizedVersion = normalizeVersion(options.rnVersion);
    const workingDir = path.resolve(options.workingDir);
    const projectName = buildProjectName(normalizedVersion);
    const projectPath = path.join(workingDir, projectName);

    const context: SetupContext = {
      rnVersion: normalizedVersion,
      projectName,
      workingDirectory: workingDir,
      projectPath
    };

    await runSetup(context);
    console.log(`\n✅ 템플릿 앱 생성이 완료되었습니다: ${context.projectPath}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n❌ 셋업 자동화에 실패했습니다: ${message}`);
    process.exitCode = 1;
  }
}

async function runSetup(context: SetupContext) {
  for (const step of setupSteps) {
    console.log(`\n[${step.name}] ${step.description}`);
    await step.run(context);
  }
}

function normalizeVersion(input: string): string {
  const parsed =
    semver.valid(input) ??
    semver.valid(semver.coerce(input) ?? undefined);

  if (!parsed) {
    throw new Error(`유효하지 않은 React Native 버전입니다: ${input}`);
  }

  return parsed;
}

function buildProjectName(version: string): string {
  const versionFragment = version.replace(/\./g, '');
  return `RN${versionFragment}`;
}

async function createReactNativeTemplateApp(context: SetupContext): Promise<void> {
  ensureDirectory(context.workingDirectory);

  if (fs.existsSync(context.projectPath)) {
    throw new Error(`이미 동일한 폴더가 존재합니다: ${context.projectPath}`);
  }

  const initArgs = [
    '@react-native-community/cli@latest',
    'init',
    context.projectName,
    '--version',
    context.rnVersion,
    '--skip-install',
    '--install-pods',
    'false',
    '--skip-git-init'
  ];

  console.log(
    `[command] npx ${initArgs.join(' ')} (cwd: ${context.workingDirectory})`
  );

  await executeCommand(getNpxBinary(), initArgs, context.workingDirectory);
}

function ensureDirectory(targetDir: string) {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
}

function executeCommand(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit'
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} 명령이 실패했습니다 (exit code: ${code})`));
      }
    });
  });
}

function getNpxBinary(): string {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

void main();
