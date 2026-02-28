const fs = require("fs");

const pluginName = "expo-build-properties";
const enabled = process.env.E2E_EXPO_ANDROID_OVERRIDE_ENABLED === "true";
const appJsonPath = process.env.E2E_EXPO_ANDROID_APP_JSON_PATH;

if (!enabled) {
  console.log("[e2e-ci] skip Expo Android CI overrides");
  process.exit(0);
}

if (!appJsonPath) {
  throw new Error("E2E_EXPO_ANDROID_APP_JSON_PATH is required when override is enabled");
}

if (!fs.existsSync(appJsonPath)) {
  throw new Error(`Cannot find app.json: ${appJsonPath}`);
}

const appJson = JSON.parse(fs.readFileSync(appJsonPath, "utf8"));
appJson.expo ??= {};
if (!Array.isArray(appJson.expo.plugins)) {
  appJson.expo.plugins = [];
}
const plugins = appJson.expo.plugins;

const pluginIndex = plugins.findIndex((plugin) => {
  if (typeof plugin === "string") {
    return plugin === pluginName;
  }
  return Array.isArray(plugin) && plugin[0] === pluginName;
});

const existingEntry = pluginIndex >= 0 ? plugins[pluginIndex] : null;
const existingConfig = Array.isArray(existingEntry) ? (existingEntry[1] ?? {}) : {};
const nextPluginEntry = [
  pluginName,
  {
    ...existingConfig,
    android: {
      ...(existingConfig.android ?? {}),
      buildArchs: ["x86_64"],
    },
  },
];

if (pluginIndex === -1) plugins.push(nextPluginEntry);
else plugins[pluginIndex] = nextPluginEntry;

fs.writeFileSync(appJsonPath, `${JSON.stringify(appJson, null, 2)}\n`, "utf8");

console.log(
  `[e2e-ci] patched ${appJsonPath}: expo-build-properties.android.buildArchs=[x86_64]`
);
