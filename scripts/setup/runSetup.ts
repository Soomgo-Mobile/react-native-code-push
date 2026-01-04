import { Command } from "commander";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import semver from "semver";
import ts from "typescript";

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

const NPX_BINARY = "npx";
const NPM_BINARY = "npm";
const REPO_ROOT = path.resolve(__dirname, "../..");

const program = new Command()
  .name("setup-automation")
  .description("React Native CodePush test app setup automation")
  .requiredOption("-v, --rn-version <version>", "React Native version to test (e.g. 0.83.1)")
  .option(
    "-w, --working-dir <path>",
    "Directory where the template app will be created",
    path.resolve(process.cwd(), "Examples")
  );

const setupSteps: SetupStep[] = [
  {
    name: "create-react-native-template",
    description: "Create RN template app",
    run: createReactNativeTemplateApp
  },
  {
    name: "configure-ios-versioning",
    description: "Configure iOS versioning and minimum OS",
    run: configureIosVersioning
  },
  {
    name: "configure-android-versioning",
    description: "Configure Android version information",
    run: configureAndroidVersioning
  },
  {
    name: "configure-local-code-link",
    description: "Configure local library link and Metro",
    run: configureLocalCodeLink
  },
  {
    name: "create-code-push-config",
    description: "Apply code-push config template",
    run: createCodePushConfigFile
  },
  {
    name: "configure-ts-node",
    description: "Configure ts-node runtime options",
    run: configureTsNodeOptions
  },
  {
    name: "apply-app-template",
    description: "Replace App.tsx with test template",
    run: applyAppTemplate
  },
  {
    name: "install-dependencies",
    description: "Run npm install inside template app",
    run: installDependencies
  },
  {
    name: "build-code-push-cli",
    description: "Build code-push CLI workspace",
    run: buildCodePushCli
  },
  {
    name: "initialize-code-push",
    description: "Initialize code-push in native projects",
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
    console.log(`\n✅ Template app created successfully: ${context.projectPath}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n❌ Setup automation failed: ${message}`);
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
    throw new Error(`Invalid React Native version: ${input}`);
  }

  return parsed;
}

function buildProjectName(version: string): string {
  const versionFragment = version.replace(/\./g, "");
  return `RN${versionFragment}`;
}

async function createReactNativeTemplateApp(context: SetupContext): Promise<void> {
  ensureDirectory(context.workingDirectory);

  if (fs.existsSync(context.projectPath)) {
    throw new Error(`Target directory already exists: ${context.projectPath}`);
  }

  const initArgs = [
    "@react-native-community/cli@latest",
    "init",
    context.projectName,
    "--version",
    context.rnVersion,
    "--skip-install",
    "--install-pods",
    "false",
    "--skip-git-init"
  ];

  console.log(
    `[command] npx ${initArgs.join(" ")} (cwd: ${context.workingDirectory})`
  );

  await executeCommand(NPX_BINARY, initArgs, context.workingDirectory);
}

function ensureDirectory(targetDir: string) {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
}

async function configureIosVersioning(context: SetupContext): Promise<void> {
  const pbxprojPath = path.join(
    context.projectPath,
    "ios",
    `${context.projectName}.xcodeproj`,
    "project.pbxproj"
  );
  const podfilePath = path.join(context.projectPath, "ios", "Podfile");
  updateTextFile(pbxprojPath, (content) => {
    let nextContent = replaceAllOrThrow(
      content,
      /MARKETING_VERSION = [^;]+;/g,
      "MARKETING_VERSION = 1.0.0;",
      "MARKETING_VERSION"
    );
    nextContent = replaceAllOrThrow(
      nextContent,
      /IPHONEOS_DEPLOYMENT_TARGET = [^;]+;/g,
      "IPHONEOS_DEPLOYMENT_TARGET = 16.0;",
      "IPHONEOS_DEPLOYMENT_TARGET"
    );
    return nextContent;
  });

  updateTextFile(podfilePath, (content) =>
    replaceAllOrThrow(
      content,
      /platform :ios,.*\n/,
      "platform :ios, '16.0'\n",
      "Podfile platform"
    )
  );
}

async function configureAndroidVersioning(context: SetupContext): Promise<void> {
  const buildGradlePath = path.join(
    context.projectPath,
    "android",
    "app",
    "build.gradle"
  );

  updateTextFile(buildGradlePath, (content) => {
    let next = replaceAllOrThrow(
      content,
      /versionName\s+"[^"]+"/g,
      "versionName \"1.0.0\"",
      "versionName"
    );
    next = replaceAllOrThrow(
      next,
      /def\s+enableProguardInReleaseBuilds\s*=\s*false/g,
      "def enableProguardInReleaseBuilds = true",
      "enableProguardInReleaseBuilds flag"
    );
    return next;
  });
}

async function configureLocalCodeLink(context: SetupContext): Promise<void> {
  applyLocalPackageDependency(context);
  copyMetroConfigTemplate(context);
  await ensureRequiredDevDependencies(context);
}

const REQUIRED_DEV_DEPENDENCIES: Array<{name: string; version?: string}> = [
  {name: "ts-node"},
  {name: "axios"},
  {name: "@types/node", version: "^22"},
  {name: "@supabase/supabase-js"}
];

interface TemplatePackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [key: string]: unknown;
}

const APP_TEMPLATE_IDENTIFIER_PLACEHOLDER = "__IDENTIFIER__";

function applyLocalPackageDependency(context: SetupContext) {
  const packageJsonPath = path.join(context.projectPath, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`Cannot find package.json: ${packageJsonPath}`);
  }

  const originalContent = fs.readFileSync(packageJsonPath, "utf8");
  const packageJson = JSON.parse(originalContent) as TemplatePackageJson;

  packageJson.dependencies = packageJson.dependencies ?? {};
  packageJson.dependencies["@bravemobile/react-native-code-push"] = "file:../..";

  const serialized = `${JSON.stringify(packageJson, null, 2)}\n`;
  if (serialized !== originalContent) {
    fs.writeFileSync(packageJsonPath, serialized, "utf8");
  }
}

async function ensureRequiredDevDependencies(context: SetupContext): Promise<void> {
  const packageJsonPath = path.join(context.projectPath, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`Cannot find package.json: ${packageJsonPath}`);
  }

  const packageJson = JSON.parse(
    fs.readFileSync(packageJsonPath, "utf8")
  ) as TemplatePackageJson;
  const existing = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {})
  };

  const missing = REQUIRED_DEV_DEPENDENCIES.filter(
    (pkg) => existing[pkg.name] === undefined
  );
  if (missing.length === 0) {
    return;
  }

  const installArgs = [
    "install",
    "--save-dev",
    "--quiet",
    "--no-progress",
    ...missing.map((pkg) => (pkg.version ? `${pkg.name}@${pkg.version}` : pkg.name))
  ];
  console.log(
    `[command] ${NPM_BINARY} ${installArgs.join(" ")} (cwd: ${context.projectPath})`
  );
  await executeCommand(NPM_BINARY, installArgs, context.projectPath);
}

function copyMetroConfigTemplate(context: SetupContext) {
  const templatePath = path.resolve(
    __dirname,
    "../../Examples/CodePushDemoApp/metro.config.js"
  );
  const destinationPath = path.join(context.projectPath, "metro.config.js");

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Metro template file does not exist: ${templatePath}`);
  }

  fs.copyFileSync(templatePath, destinationPath);
}

async function createCodePushConfigFile(context: SetupContext): Promise<void> {
  const templatePath = path.resolve(
    __dirname,
    "../../Examples/CodePushDemoApp/code-push.config.example.supabase.ts"
  );
  const destinationPath = path.join(context.projectPath, "code-push.config.ts");

  if (!fs.existsSync(templatePath)) {
    throw new Error(`code-push config template file does not exist: ${templatePath}`);
  }

  fs.copyFileSync(templatePath, destinationPath);
}

async function configureTsNodeOptions(context: SetupContext): Promise<void> {
  const tsconfigPath = path.join(context.projectPath, "tsconfig.json");
  if (!fs.existsSync(tsconfigPath)) {
    throw new Error(`Cannot find tsconfig.json: ${tsconfigPath}`);
  }

  const originalContent = fs.readFileSync(tsconfigPath, "utf8");
  const parsed = ts.parseConfigFileTextToJson(tsconfigPath, originalContent);
  if (parsed.error || !parsed.config) {
    const message = parsed.error
      ? ts.flattenDiagnosticMessageText(parsed.error.messageText, "\n")
      : "Failed to read tsconfig.json for an unknown reason.";
    throw new Error(`Failed to parse tsconfig.json: ${message}`);
  }

  const tsconfig = parsed.config as {
    include?: string[];
    ["ts-node"]?: {
      compilerOptions?: { module?: string; types?: string[] };
    };
    [key: string]: unknown;
  };

  const includeEntries = tsconfig.include ?? [];
  const requiredIncludes = ["**/*.ts", "**/*.tsx", "code-push.config.ts"];
  for (const entry of requiredIncludes) {
    if (!includeEntries.includes(entry)) {
      includeEntries.push(entry);
    }
  }
  tsconfig.include = includeEntries;

  tsconfig["ts-node"] = {
    compilerOptions: {
      module: "CommonJS",
      types: ["node"]
    }
  };

  const serialized = `${JSON.stringify(tsconfig, null, 2)}\n`;
  if (serialized !== originalContent) {
    fs.writeFileSync(tsconfigPath, serialized, "utf8");
  }
}

async function applyAppTemplate(context: SetupContext): Promise<void> {
  const templatePath = path.resolve(__dirname, "./templates/App.tsx.txt");
  const destinationPath = path.join(context.projectPath, "App.tsx");

  if (!fs.existsSync(templatePath)) {
    throw new Error(`App template file does not exist: ${templatePath}`);
  }

  const template = fs.readFileSync(templatePath, "utf8");
  const replaced = template
    .split(APP_TEMPLATE_IDENTIFIER_PLACEHOLDER)
    .join(context.projectName);
  fs.writeFileSync(destinationPath, replaced, "utf8");
}

async function installDependencies(context: SetupContext): Promise<void> {
  const installArgs = ["install", "--quiet", "--no-progress"];
  console.log(
    `[command] ${NPM_BINARY} ${installArgs.join(" ")} (cwd: ${context.projectPath})`
  );
  await executeCommand(NPM_BINARY, installArgs, context.projectPath);
}

async function buildCodePushCli(_context: SetupContext): Promise<void> {
  const args = ["run", "build:cli"];
  console.log(
    `[command] ${NPM_BINARY} ${args.join(" ")} (cwd: ${REPO_ROOT})`
  );
  await executeCommand(NPM_BINARY, args, REPO_ROOT);
}

async function initializeCodePush(context: SetupContext): Promise<void> {
  const args = ["code-push", "init"];
  console.log(
    `[command] npx ${args.join(" ")} (cwd: ${context.projectPath})`
  );
  await executeCommand(NPX_BINARY, args, context.projectPath);
}

function updateTextFile(
  filePath: string,
  mutator: (original: string) => string
) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Cannot find file: ${filePath}`);
  }
  const original = fs.readFileSync(filePath, "utf8");
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
    throw new Error(`No matches found for ${label} update pattern.`);
  }

  return replaced;
}

function executeCommand(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit"
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

void main();
