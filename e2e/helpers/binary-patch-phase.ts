/**
 * Installs binary patch updates on a device, and every way a patch can go wrong.
 *
 * A release published with a binary patch offers two archives of the same update, and a
 * client that cannot use the patch has to end up with exactly the update it would have
 * downloaded in full. The two are indistinguishable on screen, so what each scenario
 * asserts is which archives the app asked the server for, on top of the update it ended
 * up running.
 */

import path from "path";
import { WORK_DIR } from "../config";
import { assertArtifactStorageLayout } from "./artifact-storage";
import {
  assertPatchArchiveCarriesAssets,
  assertReleaseOffersNoPatch,
  assertReleaseOffersPatch,
  assertSameReleasedPackage,
  breakRestoredBundleExpectation,
  corruptPatchBody,
  corruptPatchHeader,
  extractBinaryBundle,
  extractBundleFromArchive,
  findFullArchive,
  findPatchArchive,
  getJsBundleName,
  retargetPatchArchiveToOtherPlatform,
  serveReleaseHistoryOf,
  sha256OfFile,
} from "./binary-patch-fixtures";
import {
  assertDownloadedArchives,
  startRecordingDownloads,
  type DownloadedArchive,
} from "./download-order";
import {
  type AssetMarker,
  clearReleaseMarker,
  getCodePushReleaseArgs,
  prepareBundle,
  runCodePushCommand,
  setReleaseMarker,
  setReleasingBundle,
} from "./prepare-bundle";

/** Binary version every example app release targets, and the name of its history file. */
const BINARY_VERSION = "1.0.0";

export interface BinaryPatchPhaseContext {
  appPath: string;
  platform: "ios" | "android";
  framework?: "expo";
  /** Identifier the app reads its release history under. */
  releaseIdentifier: string;
  /** Android package name or iOS bundle identifier of the installed app. */
  appId: string;
  excludeTimingSensitive: boolean;
  /** Empties the served mock data, so each scenario starts from an empty server. */
  cleanMockData: () => void;
  runMaestro: (flowPath: string, flowEnv: Record<string, string>) => Promise<void>;
  withRetry: (label: string, action: () => Promise<void>) => Promise<void>;
}

interface BinaryPatchScenario {
  name: string;
  releaseVersion: string;
  flowPath: string;
  /** Publishes the release this scenario installs, and breaks it where the scenario needs it broken. */
  prepare: () => Promise<void>;
  /** The archives the app is expected to download, in order. */
  expectedDownloads: DownloadedArchive[];
  /** Only meaningful while the update is still being installed, so it is excluded with the other timing-sensitive scenarios. */
  timingSensitive?: boolean;
}

export async function runBinaryPatchPhase(context: BinaryPatchPhaseContext): Promise<void> {
  const { appPath, platform, framework, releaseIdentifier, appId } = context;

  const installUpdateFlow = path.resolve(__dirname, "../flows-binary-patch/01-install-update.yaml");
  const uiResponsiveFlow = path.resolve(__dirname, "../flows-binary-patch/02-ui-responsive-during-install.yaml");
  const jsBundleName = getJsBundleName(platform);

  // A patch only applies to the exact bundle that shipped inside the app binary, so the
  // base is taken out of the app that is installed on the device rather than out of a
  // build directory.
  const binaryBundlePath = extractBinaryBundle(platform, appId);
  // Filled in by the first scenario: a real JS bundle of this app that is not the one in
  // the binary, which is what a release built against a stale binary patches against.
  const staleBaseBundlePath = path.join(WORK_DIR, "stale-base", jsBundleName);

  const releasePatchUpdate = (
    releaseVersion: string,
    extraOptions: { assetMarkers?: AssetMarker[]; mandatory?: boolean; binaryBundlePath?: string } = {},
  ) => prepareBundle(appPath, platform, releaseIdentifier, framework, {
    releaseVersion,
    releaseMarkerVersion: releaseVersion,
    binaryBundlePath,
    ...extraOptions,
  });

  const installUpdate = (
    scenarioName: string,
    flowPath: string,
    releaseVersion: string,
    expectedDownloads: DownloadedArchive[],
  ) => context.withRetry(`run-maestro: binary patch (${scenarioName})`, async () => {
    startRecordingDownloads();
    await context.runMaestro(flowPath, { RELEASE_LABEL: releaseVersion });
    assertDownloadedArchives(scenarioName, expectedDownloads);
  });

  const scenarios: BinaryPatchScenario[] = [
    {
      name: "patch update installs on top of the app binary",
      releaseVersion: "1.3.1",
      flowPath: installUpdateFlow,
      expectedDownloads: ["binary-patch"],
      prepare: async () => {
        await releasePatchUpdate("1.3.1");
        // The bundle this release ships is a real bundle of this app that is not the one
        // in the binary, which is exactly what a later scenario needs as a stale base.
        extractBundleFromArchive(findFullArchive(platform, releaseIdentifier), jsBundleName, staleBaseBundlePath);
      },
    },
    {
      name: "patch update carrying assets installs",
      releaseVersion: "1.3.2",
      flowPath: installUpdateFlow,
      expectedDownloads: ["binary-patch"],
      prepare: async () => {
        await releasePatchUpdate("1.3.2", { assetMarkers: [{ label: "1.3.2" }] });
        assertPatchArchiveCarriesAssets(
          "patch update carrying assets installs",
          findPatchArchive(platform, releaseIdentifier),
        );
      },
    },
    {
      name: "patch against a stale base bundle falls back to the full update",
      releaseVersion: "1.3.3",
      flowPath: installUpdateFlow,
      expectedDownloads: ["binary-patch", "full"],
      prepare: () => releasePatchUpdate("1.3.3", { binaryBundlePath: staleBaseBundlePath }),
    },
    {
      name: "corrupt patch body falls back to the full update",
      releaseVersion: "1.3.4",
      flowPath: installUpdateFlow,
      expectedDownloads: ["binary-patch", "full"],
      prepare: async () => {
        await releasePatchUpdate("1.3.4");
        corruptPatchBody(findPatchArchive(platform, releaseIdentifier));
      },
    },
    {
      name: "restored bundle that the manifest does not describe falls back to the full update",
      releaseVersion: "1.3.9",
      flowPath: installUpdateFlow,
      expectedDownloads: ["binary-patch", "full"],
      prepare: async () => {
        await releasePatchUpdate("1.3.9");
        breakRestoredBundleExpectation(findPatchArchive(platform, releaseIdentifier));
      },
    },
    {
      name: "corrupt patch header falls back to the full update",
      releaseVersion: "1.3.5",
      flowPath: installUpdateFlow,
      expectedDownloads: ["binary-patch", "full"],
      prepare: async () => {
        await releasePatchUpdate("1.3.5");
        corruptPatchHeader(findPatchArchive(platform, releaseIdentifier));
      },
    },
    {
      name: "patch archive of the other platform falls back to the full update",
      releaseVersion: "1.3.6",
      flowPath: installUpdateFlow,
      expectedDownloads: ["binary-patch", "full"],
      prepare: async () => {
        await releasePatchUpdate("1.3.6");
        retargetPatchArchiveToOtherPlatform(
          findPatchArchive(platform, releaseIdentifier),
          platform,
          sha256OfFile(staleBaseBundlePath),
        );
      },
    },
    {
      name: "app stays responsive while a patch update installs",
      releaseVersion: "1.3.8",
      flowPath: uiResponsiveFlow,
      expectedDownloads: ["binary-patch"],
      timingSensitive: true,
      prepare: () => releasePatchUpdate("1.3.8", { mandatory: false }),
    },
  ];

  for (const scenario of scenarios) {
    if (scenario.timingSensitive && context.excludeTimingSensitive) {
      console.log(`\n=== [phase 6] skipping timing-sensitive scenario (${scenario.name}) ===`);
      continue;
    }

    console.log(`\n=== [prepare-bundle: binary patch ${scenario.releaseVersion} (${scenario.name})] ===`);
    context.cleanMockData();
    await scenario.prepare();
    assertArtifactStorageLayout(scenario.name);
    assertReleaseOffersPatch(scenario.name, platform, releaseIdentifier, BINARY_VERSION, scenario.releaseVersion);

    await installUpdate(scenario.name, scenario.flowPath, scenario.releaseVersion, scenario.expectedDownloads);
  }

  await runPublishedTwiceScenario(context, binaryBundlePath, installUpdateFlow, installUpdate);
}

/**
 * One pre-built bundle, released twice with the base bundle passed to only one of the two
 * releases, so only one of the two histories carries a patch URL.
 *
 * The releases are told apart by identifier rather than by binary version: a second binary
 * version would need a second app binary, while a second identifier is the same release
 * axis - it stores its own history under `{platform}/{identifier}` - and can be installed
 * by the binary that is already on the device. The app reads the history of its own
 * identifier, so each of the two is served to it in turn.
 */
async function runPublishedTwiceScenario(
  context: BinaryPatchPhaseContext,
  binaryBundlePath: string,
  installUpdateFlow: string,
  installUpdate: (
    scenarioName: string,
    flowPath: string,
    releaseVersion: string,
    expectedDownloads: DownloadedArchive[],
  ) => Promise<void>,
): Promise<void> {
  const { appPath, platform, framework, releaseIdentifier } = context;
  const scenario = "one pre-built bundle released with and without a patch";
  const releaseVersion = "1.3.7";
  const fullOnlyIdentifier = `${releaseIdentifier}-full-only`;

  console.log(`\n=== [prepare-bundle: binary patch ${releaseVersion} (${scenario})] ===`);
  context.cleanMockData();
  setReleasingBundle(appPath, true);
  const { entryFile, frameworkArgs } = getCodePushReleaseArgs(appPath, framework);
  try {
    setReleaseMarker(appPath, releaseVersion);
    await runCodePushCommand(appPath, platform, [
      "bundle",
      ...frameworkArgs,
      "-p", platform,
      "-e", entryFile,
      "--binary-bundle-path", binaryBundlePath,
    ]);

    for (const identifier of [releaseIdentifier, fullOnlyIdentifier]) {
      await runCodePushCommand(appPath, platform, [
        "create-history",
        "-c", "code-push.config.local.ts",
        "-b", BINARY_VERSION,
        "-p", platform,
        "-i", identifier,
      ]);
    }

    // The bundle is left in place for the second release, which reuses it untouched.
    await runCodePushCommand(appPath, platform, [
      "release",
      "-c", "code-push.config.local.ts",
      "-b", BINARY_VERSION, "-v", releaseVersion,
      ...frameworkArgs,
      "-p", platform, "-i", releaseIdentifier,
      "-e", entryFile, "-m", "true",
      "--skip-bundle", "true",
      "--skip-cleanup", "true",
      "--binary-bundle-path", binaryBundlePath,
    ]);
    await runCodePushCommand(appPath, platform, [
      "release",
      "-c", "code-push.config.local.ts",
      "-b", BINARY_VERSION, "-v", releaseVersion,
      ...frameworkArgs,
      "-p", platform, "-i", fullOnlyIdentifier,
      "-e", entryFile, "-m", "true",
      "--skip-bundle", "true",
    ]);
  } finally {
    clearReleaseMarker(appPath);
    setReleasingBundle(appPath, false);
  }

  assertArtifactStorageLayout(scenario);
  assertReleaseOffersPatch(scenario, platform, releaseIdentifier, BINARY_VERSION, releaseVersion);
  assertReleaseOffersNoPatch(scenario, platform, fullOnlyIdentifier, BINARY_VERSION, releaseVersion);
  assertSameReleasedPackage(scenario, platform, releaseIdentifier, fullOnlyIdentifier, releaseVersion);

  await installUpdate(`${scenario} — history with a patch URL`, installUpdateFlow, releaseVersion, ["binary-patch"]);

  serveReleaseHistoryOf(platform, fullOnlyIdentifier, releaseIdentifier, BINARY_VERSION);
  await installUpdate(`${scenario} — history without a patch URL`, installUpdateFlow, releaseVersion, ["full"]);
}
