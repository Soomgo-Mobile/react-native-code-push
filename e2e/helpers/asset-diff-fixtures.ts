import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import {
  type Platform,
  findFiles,
  readReleaseHistory,
  rewriteArchive,
} from "./binary-patch-fixtures";

/**
 * Fixtures for the asset diff scenarios: what a published diff archive has to carry, and
 * the corruption a client has to survive.
 *
 * A diff archive is the patch archive with everything the base package already holds
 * taken out, plus a manifest naming what the base holds that the update dropped. Whether
 * a client merged its three sources back together correctly is guarded by the package
 * hash the merged contents have to reproduce, so what these fixtures inspect is the
 * published artifact - and what they corrupt is aimed at exactly that guard.
 */

/** Deletion manifest an asset diff archive carries at its root. */
const ASSET_DIFF_MANIFEST_NAME = "hotcodepush.json";

/**
 * Collapses an archive entry path and an asset label onto the characters the platforms
 * agree on. The same source image lands as `assets/e2e-asset-shared.png` on iOS and as
 * `drawable-mdpi/assets_e2eassetshared.png` on Android, whose resource naming strips
 * everything outside [a-z0-9_].
 */
function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function assetToken(label: string): string {
  return normalizeForMatch(`e2e-asset-${label}`);
}

/** Raw entry names of an archive, exactly as stored, directories excluded. */
function listRawArchiveEntries(archivePath: string): string[] {
  return execFileSync("unzip", ["-Z", "-1", archivePath], { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.endsWith("/"));
}

/**
 * Asserts that a release publishes an asset diff archive against the package another
 * release published, and returns the diff download URL.
 *
 * A diff is only published when it is smaller than the patch archive it derives from,
 * so a scenario that quietly went out without one would install through the patch and
 * test nothing of the diff path.
 */
export function assertReleaseOffersDiff(
  scenario: string,
  platform: Platform,
  identifier: string,
  binaryVersion: string,
  releaseVersion: string,
  baseReleaseVersion: string,
): string {
  const history = readReleaseHistory(platform, identifier, binaryVersion);
  for (const version of [releaseVersion, baseReleaseVersion]) {
    if (!history[version]) {
      throw new Error(`${scenario}: v${version} is missing from the "${identifier}" release history`);
    }
  }

  const basePackageHash = history[baseReleaseVersion].packageHash;
  const diffDownloadUrl = history[releaseVersion].diffPackages?.[basePackageHash];
  if (!diffDownloadUrl) {
    throw new Error(
      `${scenario}: v${releaseVersion} publishes no asset diff against v${baseReleaseVersion} (${basePackageHash}) ` +
      `(diffPackages: ${JSON.stringify(history[releaseVersion].diffPackages)})`,
    );
  }

  console.log(`[assert] ${scenario}: v${releaseVersion} offers an asset diff against v${baseReleaseVersion} (${diffDownloadUrl})`);
  return diffDownloadUrl;
}

/**
 * Asserts that the diff archive is genuinely a diff of the two releases it stands
 * between: the asset both releases share stayed out, the asset only the update ships
 * travels in it, and the manifest names the base's dropped asset for deletion.
 */
export function assertDiffArchiveShape(
  scenario: string,
  archivePath: string,
  labels: { sharedAssetLabel: string; addedAssetLabel: string; deletedAssetLabel: string },
): void {
  const entries = listRawArchiveEntries(archivePath).map(normalizeForMatch);

  if (entries.some((entry) => entry.includes(assetToken(labels.sharedAssetLabel)))) {
    throw new Error(
      `${scenario}: the diff archive carries the "${labels.sharedAssetLabel}" asset its base already holds`,
    );
  }
  if (!entries.some((entry) => entry.includes(assetToken(labels.addedAssetLabel)))) {
    throw new Error(
      `${scenario}: the diff archive is missing the "${labels.addedAssetLabel}" asset only this update ships`,
    );
  }

  const manifest = JSON.parse(
    execFileSync("unzip", ["-p", archivePath, ASSET_DIFF_MANIFEST_NAME], { encoding: "utf8" }),
  ) as { deletedFiles: string[] };
  if (!manifest.deletedFiles.some((file) => normalizeForMatch(file).includes(assetToken(labels.deletedAssetLabel)))) {
    throw new Error(
      `${scenario}: the diff manifest does not delete the base's "${labels.deletedAssetLabel}" asset ` +
      `(deletedFiles: [${manifest.deletedFiles.join(", ")}])`,
    );
  }

  console.log(`[assert] ${scenario}: diff archive omits the shared asset and deletes the base's dropped asset`);
}

/**
 * Corrupts the marker asset the diff archive ships, leaving everything else as
 * published.
 *
 * Assets are copied, never decoded, so the download, the unzip and the merge all
 * succeed over the corrupted bytes. The only thing standing between them and the app is
 * the package hash the merged contents have to reproduce - which is the verification
 * this corruption isolates, together with the fallback to the full archive behind it.
 */
export function corruptDiffArchiveAsset(archivePath: string): void {
  rewriteArchive(archivePath, (contentsDir) => {
    const assetPath = findFiles(contentsDir)
      .find((filePath) => normalizeForMatch(path.basename(filePath)).includes(normalizeForMatch("e2e-asset")));
    if (!assetPath) {
      throw new Error(`The diff archive at "${archivePath}" carries no marker asset to corrupt`);
    }

    const asset = fs.readFileSync(assetPath);
    for (let offset = 0; offset < asset.length; offset += 1) {
      asset[offset] = asset[offset] ^ 0xff;
    }
    fs.writeFileSync(assetPath, asset);
  });
}
