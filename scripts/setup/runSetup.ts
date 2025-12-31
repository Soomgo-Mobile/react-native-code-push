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
  },
  {
    name: 'configure-ios-versioning',
    description: 'iOS 버전 및 최소 지원 버전 설정',
    run: configureIosVersioning
  },
  {
    name: 'configure-android-versioning',
    description: 'Android 버전 정보 설정',
    run: configureAndroidVersioning
  },
  {
    name: 'configure-local-code-link',
    description: '로컬 라이브러리 및 Metro 설정',
    run: configureLocalCodeLink
  },
  {
    name: 'install-dependencies',
    description: '템플릿 앱 npm install 실행',
    run: installDependencies
  },
  {
    name: 'initialize-code-push',
    description: 'code-push 초기 설정',
    run: initializeCodePush
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

async function configureIosVersioning(context: SetupContext): Promise<void> {
  const pbxprojPath = path.join(
    context.projectPath,
    'ios',
    `${context.projectName}.xcodeproj`,
    'project.pbxproj'
  );
  const podfilePath = path.join(context.projectPath, 'ios', 'Podfile');
  updateTextFile(pbxprojPath, (content) => {
    let nextContent = replaceAllOrThrow(
      content,
      /MARKETING_VERSION = [^;]+;/g,
      'MARKETING_VERSION = 1.0.0;',
      'MARKETING_VERSION'
    );
    nextContent = replaceAllOrThrow(
      nextContent,
      /IPHONEOS_DEPLOYMENT_TARGET = [^;]+;/g,
      'IPHONEOS_DEPLOYMENT_TARGET = 16.0;',
      'IPHONEOS_DEPLOYMENT_TARGET'
    );
    return nextContent;
  });

  updateTextFile(podfilePath, (content) =>
    replaceAllOrThrow(
      content,
      /platform :ios,.*\n/,
      "platform :ios, '16.0'\n",
      'Podfile platform'
    )
  );
}

async function configureAndroidVersioning(context: SetupContext): Promise<void> {
  const buildGradlePath = path.join(
    context.projectPath,
    'android',
    'app',
    'build.gradle'
  );

  updateTextFile(buildGradlePath, (content) =>
    replaceAllOrThrow(
      content,
      /versionName\s+"[^"]+"/g,
      'versionName "1.0.0"',
      'versionName'
    )
  );
}

async function configureLocalCodeLink(context: SetupContext): Promise<void> {
  applyLocalPackageDependency(context);
  copyMetroConfigTemplate(context);
}

function applyLocalPackageDependency(context: SetupContext) {
  const packageJsonPath = path.join(context.projectPath, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`package.json을 찾을 수 없습니다: ${packageJsonPath}`);
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
    dependencies?: Record<string, string>;
    [key: string]: unknown;
  };

  packageJson.dependencies = packageJson.dependencies ?? {};
  packageJson.dependencies['@bravemobile/react-native-code-push'] = 'file:../..';

  fs.writeFileSync(
    packageJsonPath,
    JSON.stringify(packageJson, null, 2) + '\n',
    'utf8'
  );
}

function copyMetroConfigTemplate(context: SetupContext) {
  const templatePath = path.resolve(
    __dirname,
    '../../Examples/CodePushDemoApp/metro.config.js'
  );
  const destinationPath = path.join(context.projectPath, 'metro.config.js');

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Metro 템플릿 파일이 없습니다: ${templatePath}`);
  }

  fs.copyFileSync(templatePath, destinationPath);
}

async function installDependencies(context: SetupContext): Promise<void> {
  const installArgs = ['install', '--quiet', '--no-progress'];
  console.log(
    `[command] ${getNpmBinary()} ${installArgs.join(' ')} (cwd: ${context.projectPath})`
  );
  await executeCommand(getNpmBinary(), installArgs, context.projectPath);
}

async function initializeCodePush(context: SetupContext): Promise<void> {
  const args = ['code-push', 'init'];
  console.log(
    `[command] npx ${args.join(' ')} (cwd: ${context.projectPath})`
  );
  await executeCommand(getNpxBinary(), args, context.projectPath);
}

function updateTextFile(
  filePath: string,
  mutator: (original: string) => string
) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`파일을 찾을 수 없습니다: ${filePath}`);
  }
  const original = fs.readFileSync(filePath, 'utf8');
  const mutated = mutator(original);
  if (original !== mutated) {
    fs.writeFileSync(filePath, mutated);
  }
}

function replaceAllOrThrow(
  input: string,
  matcher: RegExp,
  replacement: string,
  label: string
): string {
  const replaced = input.replace(matcher, (match) => {
    void match;
    return replacement;
  });

  if (replaced === input) {
    throw new Error(`${label} 업데이트 패턴과 일치하는 내용이 없습니다.`);
  }

  return replaced;
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

function getNpmBinary(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

void main();
