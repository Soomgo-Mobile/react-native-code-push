import fs from "fs";
import path from "path";
import { getArtifactLogPath, getMockDataDir } from "../config";

/**
 * What the CLI stored through the local config, read back from the record the config
 * template writes.
 *
 * The point of reading it back is that the storage layout is a contract between the CLI
 * and whatever hosts the artifacts: a full bundle uses its package hash under
 * `{platform}/{identifier}/full-bundle`, while binary patches and asset diffs use their
 * target binary version under `{platform}/{identifier}/{artifactType}`. A release history
 * lives under `{platform}/{identifier}/{binaryVersion}.json`.
 */
export interface StoredBundleArtifact {
  kind: "bundle";
  platform: string;
  identifier: string;
  artifactType: "full-bundle" | "binary-patch" | "asset-diff";
  targetBinaryVersion: string;
  packageHash: string;
  basePackageHash?: string;
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

export function clearArtifactLog(platform: "ios" | "android"): void {
  fs.rmSync(getArtifactLogPath(platform), { force: true });
}

export function readArtifactLog(platform: "ios" | "android"): StoredArtifact[] {
  if (!fs.existsSync(getArtifactLogPath(platform))) {
    return [];
  }

  return fs.readFileSync(getArtifactLogPath(platform), "utf8")
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
export function assertArtifactStorageLayout(scenario: string, platform: "ios" | "android"): StoredArtifact[] {
  const artifacts = readArtifactLog(platform);
  if (artifacts.length === 0) {
    throw new Error(`${scenario}: no artifacts were stored`);
  }

  const bundles = artifacts.filter((artifact): artifact is StoredBundleArtifact => artifact.kind === "bundle");

  for (const artifact of artifacts) {
    const expectedPath = artifact.kind === "bundle"
      ? bundleStoredPath(artifact)
      : path.join("histories", artifact.platform, artifact.identifier, `${artifact.binaryVersion}.json`);

    if (artifact.storedPath !== expectedPath) {
      throw new Error(
        `${scenario}: ${artifact.kind} was stored at "${artifact.storedPath}" instead of "${expectedPath}"`,
      );
    }

    if (!fs.existsSync(path.join(getMockDataDir(platform), artifact.storedPath))) {
      throw new Error(`${scenario}: ${artifact.kind} is missing from the served data at "${artifact.storedPath}"`);
    }
  }

  // Binary patches and full bundles share the same package hash and target binary version.
  for (const patchArchive of bundles.filter((bundle) => bundle.artifactType === "binary-patch")) {
    const fullArchive = bundles.find((bundle) =>
      bundle.platform === patchArchive.platform
      && bundle.identifier === patchArchive.identifier
      && bundle.artifactType === "full-bundle"
      && bundle.targetBinaryVersion === patchArchive.targetBinaryVersion
      && bundle.packageHash === patchArchive.packageHash);

    if (!fullArchive) {
      throw new Error(
        `${scenario}: patch archive "${patchArchive.storedPath}" has no matching full archive`,
      );
    }
  }

  console.log(`[assert] ${scenario}: ${artifacts.length} artifacts stored under metadata-based paths`);
  return artifacts;
}

function bundleStoredPath(artifact: StoredBundleArtifact): string {
  if (artifact.artifactType === "full-bundle") {
    return path.join(
      "bundles",
      artifact.platform,
      artifact.identifier,
      artifact.artifactType,
      artifact.packageHash,
    );
  }

  if (artifact.artifactType === "asset-diff") {
    if (artifact.basePackageHash === undefined) {
      throw new Error(`Asset diff "${artifact.storedPath}" is missing its base package hash`);
    }

    return path.join(
      "bundles",
      artifact.platform,
      artifact.identifier,
      artifact.artifactType,
      artifact.targetBinaryVersion,
      artifact.packageHash,
      artifact.basePackageHash,
    );
  }

  return path.join(
    "bundles",
    artifact.platform,
    artifact.identifier,
    artifact.artifactType,
    artifact.targetBinaryVersion,
    artifact.packageHash,
  );
}
