/**
 * Installs updates through their asset diff archives, and what happens to the clients a
 * diff cannot serve.
 *
 * A release published with asset diffs offers up to three archives of the same update. A
 * client whose installed update is a base the release was diffed against downloads the
 * diff archive alone, and a client the diff cannot serve keeps the patch archive. A diff
 * that fails is fallen back from by where it failed: a failure on its asset side - the
 * one part the patch archive does not share - moves on to the patch archive, and a
 * failure in the bundle patch both archives carry skips the patch for the full one.
 * All of them end up running identical contents, so - as with the binary patch phase -
 * what tells the cases apart is which archives the app asked the mock server for,
 * together with the result the app's own callback reported.
 */

import path from "path";
import { assertArtifactStorageLayout } from "./artifact-storage";
import {
  assertDiffArchiveShape,
  assertReleaseOffersDiff,
  corruptDiffArchiveAsset,
  dropDiffArchiveManifestDeletions,
} from "./asset-diff-fixtures";
import {
  assertReleaseOffersPatch,
  breakRestoredBundleExpectation,
  extractBinaryBundle,
  findAssetDiffArchive,
} from "./binary-patch-fixtures";
import {
  assertDownloadedArchives,
  assertReportedArchiveResult,
  startRecordingDownloads,
  type DownloadedArchive,
} from "./download-order";
import { prepareBundle } from "./prepare-bundle";

/** Binary version every example app release targets, and the name of its history file. */
const BINARY_VERSION = "1.0.0";

/**
 * Size of the asset the base and the update share. A diff is only published when it is
 * smaller than the patch archive, and leaving this asset out is the diff's whole
 * saving - so it has to dwarf what the diff adds over the patch contents, the deletion
 * manifest and the zip bookkeeping around it.
 */
const SHARED_ASSET_BYTES = 64 * 1024;
const SHARED_ASSET_LABEL = "shared";

export interface AssetDiffPhaseContext {
  appPath: string;
  platform: "ios" | "android";
  framework?: "expo";
  /** Identifier the app reads its release history under. */
  releaseIdentifier: string;
  /** Android package name or iOS bundle identifier of the installed app. */
  appId: string;
  /** Empties the served mock data, so each scenario starts from an empty server. */
  cleanMockData: () => void;
  runMaestro: (flowPath: string, flowEnv: Record<string, string>) => Promise<void>;
  withRetry: (label: string, action: () => Promise<void>) => Promise<void>;
}

interface AssetDiffScenario {
  name: string;
  /** Release the device installs first, and the base the diff is then built against. */
  baseVersion: string;
  /** Release published on top of the base, carrying the diff archive under test. */
  updateVersion: string;
  /** Breaks the published diff where the scenario needs it broken. */
  breakDiff?: () => void;
  /** The archives the app is expected to download installing the update. */
  expectedDownloads: DownloadedArchive[];
  /** The result the app's callback is expected to report, as one `status:archive:attempts` line. */
  expectedArchiveResult: string;
}

export async function runAssetDiffPhase(context: AssetDiffPhaseContext): Promise<void> {
  const { appPath, platform, framework, releaseIdentifier } = context;

  const installUpdateFlow = path.resolve(__dirname, "../flows-binary-patch/01-install-update.yaml");
  const updateFromInstalledFlow = path.resolve(__dirname, "../flows-asset-diff/01-update-from-installed.yaml");

  // A diff carries the bundle patch of its release, and that patch only applies to the
  // exact bundle that shipped inside the app binary - extracted from the installed app,
  // exactly as the binary patch phase does.
  const binaryBundlePath = extractBinaryBundle(platform, context.appId);

  // Every release of this phase ships the shared asset plus one asset of its own, so a
  // base and its update always share one asset (what makes the diff smaller than the
  // patch archive), differ in one (what the diff has to carry), and drop one (what the
  // deletion manifest has to name).
  const releaseWithAssets = (releaseVersion: string, createHistory: boolean) =>
    prepareBundle(appPath, platform, releaseIdentifier, framework, {
      releaseVersion,
      releaseMarkerVersion: releaseVersion,
      binaryBundlePath,
      assetMarkers: [
        { label: SHARED_ASSET_LABEL, byteSize: SHARED_ASSET_BYTES },
        { label: releaseVersion },
      ],
      createHistory,
    });

  /**
   * Retried as a whole: once the update joins the history, a client syncs to it rather
   * than to the base, so a retry can only rebuild the precondition - the installed base
   * update - by starting the scenario over from an empty server.
   */
  const runDiffScenario = (scenario: AssetDiffScenario) =>
    context.withRetry(`run-maestro: asset diff (${scenario.name})`, async () => {
      console.log(`\n=== [${platform}][prepare-bundle: asset diff ${scenario.baseVersion} (${scenario.name})] ===`);
      context.cleanMockData();
      await releaseWithAssets(scenario.baseVersion, true);
      startRecordingDownloads(platform);
      await context.runMaestro(installUpdateFlow, { RELEASE_LABEL: scenario.baseVersion });
      assertDownloadedArchives(`${scenario.name} — base install`, platform, ["binary-patch"]);
      await assertReportedArchiveResult(`${scenario.name} — base install`, platform, "applied:binary-patch:binary-patch=applied");

      console.log(`\n=== [${platform}][prepare-bundle: asset diff ${scenario.updateVersion} (${scenario.name})] ===`);
      await releaseWithAssets(scenario.updateVersion, false);
      assertArtifactStorageLayout(scenario.name, platform);
      assertReleaseOffersPatch(scenario.name, platform, releaseIdentifier, BINARY_VERSION, scenario.updateVersion);

      assertReleaseOffersDiff(
        scenario.name,
        platform,
        releaseIdentifier,
        BINARY_VERSION,
        scenario.updateVersion,
        scenario.baseVersion,
      );
      assertDiffArchiveShape(scenario.name, findAssetDiffArchive(platform, releaseIdentifier), {
        sharedAssetLabel: SHARED_ASSET_LABEL,
        addedAssetLabel: scenario.updateVersion,
        deletedAssetLabel: scenario.baseVersion,
      });

      scenario.breakDiff?.();

      startRecordingDownloads(platform);
      await context.runMaestro(updateFromInstalledFlow, {
        RELEASE_LABEL: scenario.updateVersion,
        BASE_RELEASE_LABEL: scenario.baseVersion,
      });
      assertDownloadedArchives(scenario.name, platform, scenario.expectedDownloads);
      await assertReportedArchiveResult(scenario.name, platform, scenario.expectedArchiveResult);
    });

  await runDiffScenario({
    name: "asset diff installs on top of the base it was built against",
    baseVersion: "1.4.1",
    updateVersion: "1.4.2",
    expectedDownloads: ["asset-diff"],
    expectedArchiveResult: "applied:asset-diff:asset-diff=applied",
  });

  // The release the last scenario published still stands, diffPackages entry and all,
  // and its diff was built against an installed update this client does not hold: a
  // client starting over from the binary has no installed update at all, so the diff
  // must be passed over for the patch archive exactly as if it had never been published.
  const binaryClientScenario = "client on the binary passes over the diff and installs the patch";
  await context.withRetry(`run-maestro: asset diff (${binaryClientScenario})`, async () => {
    startRecordingDownloads(platform);
    await context.runMaestro(installUpdateFlow, { RELEASE_LABEL: "1.4.2" });
    assertDownloadedArchives(binaryClientScenario, platform, ["binary-patch"]);
    await assertReportedArchiveResult(binaryClientScenario, platform, "applied:binary-patch:binary-patch=applied");
  });

  // The merge completes over the corrupted asset, and what catches it is the package
  // hash the merged contents fail to reproduce - a failure on the asset side of the
  // diff, which the patch archive does not share, so the patch is the next rung.
  await runDiffScenario({
    name: "diff that does not merge back into the released package falls back to the patch archive",
    baseVersion: "1.4.3",
    updateVersion: "1.4.4",
    breakDiff: () => corruptDiffArchiveAsset(findAssetDiffArchive(platform, releaseIdentifier)),
    expectedDownloads: ["asset-diff", "binary-patch"],
    expectedArchiveResult: "applied:binary-patch:asset-diff=package_verification_failed:binary-patch=applied",
  });

  // A diff whose bundle patch restores a bundle its manifest does not promise failed in
  // the one part the patch archive carries byte for byte, so the patch is passed over
  // for the full archive: retrying it could only fail the same way, and a client must
  // never be walked through two doomed downloads on its way to the full one.
  await runDiffScenario({
    name: "diff that fails in the bundle patch both archives carry skips the patch archive",
    baseVersion: "1.4.5",
    updateVersion: "1.4.6",
    breakDiff: () => breakRestoredBundleExpectation(findAssetDiffArchive(platform, releaseIdentifier)),
    expectedDownloads: ["asset-diff", "full"],
    expectedArchiveResult: "fallback:asset-diff:asset-diff=target_verification_failed",
  });

  // A manifest that names no files to delete is not one with nothing to delete - the CLI
  // writes the key on every release, an empty list included. Merging past its absence would
  // keep the asset the update dropped and install contents the release never published, so
  // both clients refuse the merge outright rather than let the package hash speak for it.
  // That verdict is reached after the bundle patch has already been applied, on the asset
  // side the patch archive does not share, so the patch archive is the next rung.
  await runDiffScenario({
    name: "diff whose manifest names no files to delete falls back to the patch archive",
    baseVersion: "1.4.7",
    updateVersion: "1.4.8",
    breakDiff: () => dropDiffArchiveManifestDeletions(findAssetDiffArchive(platform, releaseIdentifier)),
    expectedDownloads: ["asset-diff", "binary-patch"],
    expectedArchiveResult: "applied:binary-patch:asset-diff=asset_merge_failed:binary-patch=applied",
  });
}
