import { Command } from "commander";
import fs from "fs";
import path from "path";
import semver from "semver";
import { spawn } from "child_process";
import ts from "typescript";

type ExpoPluginConfigEntry = string | [string, Record<string, unknown>];

interface SetupCliOptions {
  sdk?: string;
  beta?: boolean;
  projectName?: string;
  workingDir: string;
  iosMinVersion?: string;
}

interface SetupContext {
  sdkVersion: number;
  projectName: string;
  workingDirectory: string;
  projectPath: string;
  iosMinVersion: string;
}

interface TemplatePackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  [key: string]: unknown;
}

interface ExpoAppConfigJson {
  expo?: Record<string, unknown>;
  [key: string]: unknown;
}

type SetupStep = {
  name: string;
  description: string;
  run: (context: SetupContext) => Promise<void>;
};

const NPX_BINARY = "npx";
const NPM_BINARY = "npm";
const DEFAULT_IOS_MIN_VERSION = "16.0";
const DEFAULT_WORKING_DIR = path.resolve(process.cwd(), "Examples");
const TEMPLATE_SYNC_SCRIPT_NAME = "sync-local-library";
const EXPO_LOCAL_RELEASE_IOS_SCRIPT_NAME = "release:ios-local";
const EXPO_LOCAL_RELEASE_ANDROID_SCRIPT_NAME = "release:android-local";
const APP_TEMPLATE_IDENTIFIER_PLACEHOLDER = "__IDENTIFIER__";

const REQUIRED_DEV_DEPENDENCIES: Array<{name: string; version?: string}> = [
  {name: "ts-node"},
  {name: "axios"},
  {name: "@types/node", version: "^22"},
  {name: "@supabase/supabase-js"}
];

const program = new Command()
  .name("setup-expo-example-app")
  .description("Expo CodePush test app setup automation")
  .requiredOption(
    "--sdk <version>",
    "Expo SDK major version (e.g. 54, 55)"
  )
  .option(
    "--beta",
    "Append Beta suffix to the generated app name",
    false
  )
  .option(
    "--project-name <name>",
    "Override generated project name"
  )
  .option(
    "-w, --working-dir <path>",
    "Directory where the template app will be created",
    DEFAULT_WORKING_DIR
  )
  .option(
    "--ios-min-version <version>",
    "Minimum iOS deployment target",
    DEFAULT_IOS_MIN_VERSION
  );

const setupSteps: SetupStep[] = [
  {
    name: "create-expo-template",
    description: "Create Expo template app",
    run: createExpoTemplateApp
  },
  {
    name: "configure-expo-app-config",
    description: "Configure Expo app.json for CodePush and local dev build",
    run: configureExpoAppConfig
  },
  {
    name: "configure-local-code-link",
    description: "Configure local library link",
    run: configureLocalCodeLink
  },
  {
    name: "configure-ts-node",
    description: "Configure ts-node runtime options",
    run: configureTsNodeOptions
  },
  {
    name: "create-code-push-config",
    description: "Apply code-push config template",
    run: createCodePushConfigFile
  },
  {
    name: "apply-app-template",
    description: "Replace App.tsx with test template",
    run: applyAppTemplate
  },
  {
    name: "wire-home-route-to-app",
    description: "Make Expo home route render App.tsx",
    run: wireHomeRouteToApp
  },
  {
    name: "install-dependencies",
    description: "Run npm install inside template app",
    run: installDependencies
  },
  {
    name: "prebuild-expo-native-projects",
    description: "Generate native iOS/Android projects for local dev build",
    run: prebuildExpoNativeProjects
  },
  {
    name: "configure-ios-min-deployment-target",
    description: "Raise iOS minimum deployment target",
    run: configureIosMinDeploymentTarget
  }
];

async function main() {
  const options = program.parse(process.argv).opts<SetupCliOptions>();

  try {
    const context = buildSetupContext(options);
    await runSetup(context);

    console.log(`\n✅ Expo template app created successfully: ${context.projectPath}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n❌ Expo setup automation failed: ${message}`);
    process.exitCode = 1;
  }
}

function buildSetupContext(options: SetupCliOptions): SetupContext {
  const workingDir = path.resolve(options.workingDir);
  const sdkVersion = normalizeSdkVersion(options.sdk);
  const isBeta = options.beta ?? false;
  const iosMinVersion = normalizeIosVersion(options.iosMinVersion);

  const projectName = options.projectName ?? buildExpoProjectName(sdkVersion, isBeta);
  const projectPath = path.join(workingDir, projectName);

  return {
    sdkVersion,
    projectName,
    workingDirectory: workingDir,
    projectPath,
    iosMinVersion
  };
}

function normalizeSdkVersion(input?: string): number {
  if (!input || !/^\d+$/.test(input)) {
    throw new Error(`Invalid Expo SDK version: ${input ?? "undefined"}`);
  }
  return Number(input);
}

function normalizeIosVersion(input?: string): string {
  if (!input) {
    return DEFAULT_IOS_MIN_VERSION;
  }

  const minimumVersion = semver.minVersion(input);
  if (!minimumVersion) {
    throw new Error(`Invalid iOS version: ${input}`);
  }

  return `${minimumVersion.major}.${minimumVersion.minor}`;
}

function buildExpoProjectName(sdkVersion: number, isBeta: boolean): string {
  return `Expo${sdkVersion}${isBeta ? "Beta" : ""}`;
}

async function runSetup(context: SetupContext) {
  for (const step of setupSteps) {
    console.log(`\n[${step.name}] ${step.description}`);
    await step.run(context);
  }
}

async function createExpoTemplateApp(context: SetupContext): Promise<void> {
  ensureDirectory(context.workingDirectory);

  if (fs.existsSync(context.projectPath)) {
    throw new Error(`Target directory already exists: ${context.projectPath}`);
  }

  const template = `default@sdk-${context.sdkVersion}`;
  const args = [
    "create-expo-app@latest",
    context.projectName,
    "--template",
    template,
    "--yes"
  ];
  console.log(`[command] npx ${args.join(" ")} (cwd: ${context.workingDirectory})`);
  await executeCommand(NPX_BINARY, args, context.workingDirectory);
}

async function configureExpoAppConfig(context: SetupContext): Promise<void> {
  const appJsonPath = path.join(context.projectPath, "app.json");
  if (!fs.existsSync(appJsonPath)) {
    throw new Error(`Cannot find app.json: ${appJsonPath}`);
  }

  const originalContent = fs.readFileSync(appJsonPath, "utf8");
  const appJson = JSON.parse(originalContent) as ExpoAppConfigJson;
  const expoConfig = toRecord(appJson.expo);

  const plugins = Array.isArray(expoConfig.plugins)
    ? [...(expoConfig.plugins as ExpoPluginConfigEntry[])]
    : [];
  ensureExpoPlugin(plugins, "@bravemobile/react-native-code-push");

  const bundleIdentifier = buildExpoBundleIdentifier(context.projectName);
  const iosConfig = toRecord(expoConfig.ios);
  iosConfig.bundleIdentifier = bundleIdentifier;
  iosConfig.deploymentTarget = context.iosMinVersion;
  expoConfig.ios = iosConfig;

  const androidConfig = toRecord(expoConfig.android);
  androidConfig.package = bundleIdentifier;
  androidConfig.usesCleartextTraffic = true;
  expoConfig.android = androidConfig;

  expoConfig.plugins = plugins;
  appJson.expo = expoConfig;

  const serialized = `${JSON.stringify(appJson, null, 2)}\n`;
  if (serialized !== originalContent) {
    fs.writeFileSync(appJsonPath, serialized, "utf8");
  }
}

async function configureLocalCodeLink(context: SetupContext): Promise<void> {
  const packageJsonPath = path.join(context.projectPath, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`Cannot find package.json: ${packageJsonPath}`);
  }

  const originalContent = fs.readFileSync(packageJsonPath, "utf8");
  const packageJson = JSON.parse(originalContent) as TemplatePackageJson;
  packageJson.dependencies = packageJson.dependencies ?? {};
  packageJson.dependencies["@bravemobile/react-native-code-push"] = "latest";

  ensureScripts(packageJson, context);

  const serialized = `${JSON.stringify(packageJson, null, 2)}\n`;
  if (serialized !== originalContent) {
    fs.writeFileSync(packageJsonPath, serialized, "utf8");
  }

  await ensureRequiredDevDependencies(context);
}

function ensureScripts(packageJson: TemplatePackageJson, context: SetupContext) {
  const scripts = packageJson.scripts ?? {};
  const syncScriptPath = path.resolve(__dirname, "../setupExampleApp/syncLocalLibrary.ts");
  const tsNodeProjectPath = path.resolve(__dirname, "../setupExampleApp/tsconfig.json");
  const relativeScriptPath = path.relative(context.projectPath, syncScriptPath);
  const relativeTsNodeProjectPath = path.relative(context.projectPath, tsNodeProjectPath);
  const normalizedPath = relativeScriptPath.split(path.sep).join(path.posix.sep);
  const normalizedProjectPath = relativeTsNodeProjectPath
    .split(path.sep)
    .join(path.posix.sep);
  scripts[TEMPLATE_SYNC_SCRIPT_NAME] =
    `ts-node --project ${JSON.stringify(normalizedProjectPath)} ${JSON.stringify(normalizedPath)}`;
  scripts[EXPO_LOCAL_RELEASE_IOS_SCRIPT_NAME] =
    "npx expo run:ios --configuration Release --no-bundler";
  scripts[EXPO_LOCAL_RELEASE_ANDROID_SCRIPT_NAME] =
    "npx expo run:android --variant release --no-bundler";

  const postInstallCommand = `npm run ${TEMPLATE_SYNC_SCRIPT_NAME}`;
  if (!scripts.postinstall) {
    scripts.postinstall = postInstallCommand;
  } else if (!scripts.postinstall.includes(postInstallCommand)) {
    scripts.postinstall = `${scripts.postinstall} && ${postInstallCommand}`;
  }

  packageJson.scripts = scripts;
}

async function configureTsNodeOptions(context: SetupContext): Promise<void> {
  const tsconfigPath = path.join(context.projectPath, "tsconfig.json");
  if (!fs.existsSync(tsconfigPath)) {
    fs.writeFileSync(
      tsconfigPath,
      `${JSON.stringify({ extends: "expo/tsconfig.base", compilerOptions: {} }, null, 2)}\n`,
      "utf8"
    );
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
      compilerOptions?: { module?: string; moduleResolution?: string; types?: string[] };
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
      moduleResolution: "Node",
      types: ["node"]
    }
  };

  const serialized = `${JSON.stringify(tsconfig, null, 2)}\n`;
  if (serialized !== originalContent) {
    fs.writeFileSync(tsconfigPath, serialized, "utf8");
  }
}

async function ensureRequiredDevDependencies(context: SetupContext): Promise<void> {
  const packageJsonPath = path.join(context.projectPath, "package.json");
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
    "--ignore-scripts",
    ...getPeerResolutionInstallArgs(context),
    ...missing.map((pkg) => (pkg.version ? `${pkg.name}@${pkg.version}` : pkg.name))
  ];
  console.log(`[command] npm ${installArgs.join(" ")} (cwd: ${context.projectPath})`);
  await executeCommand(NPM_BINARY, installArgs, context.projectPath);
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

async function applyAppTemplate(context: SetupContext): Promise<void> {
  const templatePath = path.resolve(
    __dirname,
    "../setupExampleApp/templates/App.tsx.txt"
  );
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

async function wireHomeRouteToApp(context: SetupContext): Promise<void> {
  const candidateEntryFiles = [
    "src/app/(tabs)/index.tsx",
    "app/(tabs)/index.tsx",
    "src/app/index.tsx",
    "app/index.tsx"
  ];

  const targetEntries = candidateEntryFiles
    .map((relativePath) => path.join(context.projectPath, relativePath))
    .filter((absolutePath) => fs.existsSync(absolutePath));

  if (targetEntries.length === 0) {
    console.log("[skip] No Expo home route entry file found");
    return;
  }

  for (const entryPath of targetEntries) {
    const appTsxPath = path.join(context.projectPath, "App.tsx");
    const importPath = toRelativeImportPath(path.dirname(entryPath), appTsxPath);
    const content =
      `import App from ${JSON.stringify(importPath)};\n\n` +
      "export default App;\n";
    fs.writeFileSync(entryPath, content, "utf8");
  }
}

async function installDependencies(context: SetupContext): Promise<void> {
  const args = [
    "install",
    "--quiet",
    "--no-progress",
    ...getPeerResolutionInstallArgs(context)
  ];
  console.log(`[command] npm ${args.join(" ")} (cwd: ${context.projectPath})`);
  await executeCommand(NPM_BINARY, args, context.projectPath);
}

function getPeerResolutionInstallArgs(context: SetupContext): string[] {
  if (isExpoPrereleaseVersion(context)) {
    return ["--legacy-peer-deps"];
  }
  return [];
}

function isExpoPrereleaseVersion(context: SetupContext): boolean {
  const packageJsonPath = path.join(context.projectPath, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return false;
  }
  const packageJson = JSON.parse(
    fs.readFileSync(packageJsonPath, "utf8")
  ) as TemplatePackageJson;
  const expoVersionRange = packageJson.dependencies?.expo
    ?? packageJson.devDependencies?.expo;
  if (typeof expoVersionRange !== "string") {
    return false;
  }
  const minimumVersion = semver.minVersion(expoVersionRange);
  if (!minimumVersion) {
    return false;
  }
  return semver.prerelease(minimumVersion.version) !== null;
}

async function prebuildExpoNativeProjects(context: SetupContext): Promise<void> {
  const args = [
    "expo",
    "prebuild",
    "--platform",
    "all",
    "--clean",
    "--no-install"
  ];
  console.log(`[command] npx ${args.join(" ")} (cwd: ${context.projectPath})`);
  await executeCommand(NPX_BINARY, args, context.projectPath);
}

async function configureIosMinDeploymentTarget(context: SetupContext): Promise<void> {
  const iosPath = path.join(context.projectPath, "ios");
  if (!fs.existsSync(iosPath)) {
    console.log("[skip] iOS directory does not exist");
    return;
  }

  const podfilePropertiesPath = path.join(iosPath, "Podfile.properties.json");
  const podfileProperties = fs.existsSync(podfilePropertiesPath)
    ? JSON.parse(fs.readFileSync(podfilePropertiesPath, "utf8")) as Record<string, unknown>
    : {};
  podfileProperties["ios.deploymentTarget"] = context.iosMinVersion;
  fs.writeFileSync(
    podfilePropertiesPath,
    `${JSON.stringify(podfileProperties, null, 2)}\n`,
    "utf8"
  );

  const podfilePath = path.join(iosPath, "Podfile");
  if (fs.existsSync(podfilePath)) {
    const originalContent = fs.readFileSync(podfilePath, "utf8");
    let updatedContent = originalContent.replace(
      /platform :ios,\s*['"][^'"]+['"]/,
      `platform :ios, '${context.iosMinVersion}'`
    );
    updatedContent = updatedContent.replace(
      /platform :ios,\s*podfile_properties\['ios\.deploymentTarget'\]\s*\|\|\s*'[^']+'/,
      `platform :ios, podfile_properties['ios.deploymentTarget'] || '${context.iosMinVersion}'`
    );
    if (originalContent !== updatedContent) {
      fs.writeFileSync(podfilePath, updatedContent, "utf8");
    }
  }

  const xcodeProjPath = findFirstXcodeProjProjectPath(iosPath);
  if (!xcodeProjPath) {
    console.log("[skip] No .xcodeproj/project.pbxproj found");
    return;
  }

  const projectContent = fs.readFileSync(xcodeProjPath, "utf8");
  const updatedProjectContent = projectContent.replace(
    /IPHONEOS_DEPLOYMENT_TARGET = [^;]+;/g,
    `IPHONEOS_DEPLOYMENT_TARGET = ${context.iosMinVersion};`
  );
  if (projectContent !== updatedProjectContent) {
    fs.writeFileSync(xcodeProjPath, updatedProjectContent, "utf8");
  }
}

function findFirstXcodeProjProjectPath(iosPath: string): string | null {
  const entries = fs.readdirSync(iosPath);
  const xcodeProj = entries.find((entry) => entry.endsWith(".xcodeproj"));
  if (!xcodeProj) {
    return null;
  }
  const projectPath = path.join(iosPath, xcodeProj, "project.pbxproj");
  return fs.existsSync(projectPath) ? projectPath : null;
}

function toRecord(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return { ...(input as Record<string, unknown>) };
  }
  return {};
}

function ensureExpoPlugin(
  plugins: ExpoPluginConfigEntry[],
  pluginName: string
) {
  const alreadyExists = plugins.some((plugin) => {
    if (typeof plugin === "string") {
      return plugin === pluginName;
    }
    return Array.isArray(plugin) && plugin[0] === pluginName;
  });
  if (!alreadyExists) {
    plugins.push(pluginName);
  }
}

function buildExpoBundleIdentifier(projectName: string): string {
  const normalized = projectName.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (normalized.length === 0) {
    throw new Error(`Invalid project name for bundle identifier: ${projectName}`);
  }
  return `com.codepush.${normalized}`;
}

function ensureDirectory(targetDir: string) {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
}

function toRelativeImportPath(fromDir: string, toFilePath: string): string {
  const fromToTarget = path.relative(fromDir, toFilePath);
  const normalized = fromToTarget.split(path.sep).join(path.posix.sep);
  const withoutExtension = normalized.replace(/\.[^.]+$/, "");
  if (withoutExtension.startsWith(".")) {
    return withoutExtension;
  }
  return `./${withoutExtension}`;
}

function executeCommand(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit"
    });
    child.on("error", reject);
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
