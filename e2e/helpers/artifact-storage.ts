import fs from "fs";
import path from "path";
import { ARTIFACT_LOG_PATH, MOCK_DATA_DIR } from "../config";

/**
 * What the CLI stored through the local config, read back from the record the config
 * template writes.
 *
 * The point of reading it back is that the storage layout is a contract between the CLI
 * and whatever hosts the artifacts: bundles live under `{platform}/{identifier}`, and a
 * release history under `{platform}/{identifier}/{binaryVersion}.json`. Publishing a
 * binary patch adds a second archive per release, and it has to land in the same place
 * as the full one rather than somewhere of its own.
 */
export interface StoredBundleArtifact {
  kind: "bundle";
  platform: string;
  identifier: string;
  fileName: string;
  storedPath: string;
  downloadUrl: string;
}

export interface StoredHistoryArtifact {
  kind: "history";
  platform: string;
  identifier: string;
  binaryVersion: string;
  storedPath: string;
}

export type StoredArtifact = StoredBundleArtifact | StoredHistoryArtifact;

/** Appended to the full archive name so the two artifacts of a release stay paired. */
export const PATCH_ARCHIVE_SUFFIX = "-patch.zip";

export function clearArtifactLog(): void {
  fs.rmSync(ARTIFACT_LOG_PATH, { force: true });
}

export function readArtifactLog(): StoredArtifact[] {
  if (!fs.existsSync(ARTIFACT_LOG_PATH)) {
    return [];
  }

  return fs.readFileSync(ARTIFACT_LOG_PATH, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as StoredArtifact);
}

/**
 * Asserts that everything released so far was stored where a client looks for it, and
 * that a release published with a binary patch stored both of its archives together.
 *
 * @return the artifacts that were checked, so a caller can go on to assert something
 * about a specific one.
 */
export function assertArtifactStorageLayout(scenario: string): StoredArtifact[] {
  const artifacts = readArtifactLog();
  if (artifacts.length === 0) {
    throw new Error(`${scenario}: no artifacts were stored`);
  }

  const bundles = artifacts.filter((artifact): artifact is StoredBundleArtifact => artifact.kind === "bundle");

  for (const artifact of artifacts) {
    const expectedPath = artifact.kind === "bundle"
      ? path.join("bundles", artifact.platform, artifact.identifier, artifact.fileName)
      : path.join("histories", artifact.platform, artifact.identifier, `${artifact.binaryVersion}.json`);

    if (artifact.storedPath !== expectedPath) {
      throw new Error(
        `${scenario}: ${artifact.kind} was stored at "${artifact.storedPath}" instead of "${expectedPath}"`,
      );
    }

    if (!fs.existsSync(path.join(MOCK_DATA_DIR, artifact.storedPath))) {
      throw new Error(`${scenario}: ${artifact.kind} is missing from the served data at "${artifact.storedPath}"`);
    }
  }

  // The full archive of a release is stored under its package hash, and the patch archive
  // next to it under the same hash with the patch suffix.
  for (const patchArchive of bundles.filter((bundle) => bundle.fileName.endsWith(PATCH_ARCHIVE_SUFFIX))) {
    const packageHash = patchArchive.fileName.slice(0, -PATCH_ARCHIVE_SUFFIX.length);
    const fullArchive = bundles.find((bundle) =>
      bundle.platform === patchArchive.platform
      && bundle.identifier === patchArchive.identifier
      && bundle.fileName === packageHash);

    if (!fullArchive) {
      throw new Error(
        `${scenario}: patch archive "${patchArchive.storedPath}" has no full archive of the same release beside it`,
      );
    }
  }

  console.log(`[assert] ${scenario}: ${artifacts.length} artifacts stored under {platform}/{identifier}`);
  return artifacts;
}
