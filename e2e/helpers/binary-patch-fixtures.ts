import { execFileSync } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { MOCK_DATA_DIR, WORK_DIR } from "../config";

/**
 * Fixtures for the binary patch scenarios: the base bundle a patch is computed against,
 * and the broken patch archives a client has to survive.
 *
 * The base bundle is taken out of the app that is installed on the device rather than
 * out of a build directory. A patch only applies to the exact bytes that shipped in the
 * binary, so taking them from anywhere else would test a patch against a bundle no user
 * is running.
 *
 * The broken archives are built by rewriting a real patch archive, so everything except
 * the one fault under test is exactly what the CLI produces.
 */

/** Manifest a patch archive carries so a client knows how to rebuild the JS bundle. */
const PATCH_MANIFEST_NAME = "codepush-binary-patch.json";

export interface BinaryPatchManifest {
  formatVersion: number;
  algorithm: string;
  bundlePath: string;
  patchFile: string;
  baseBundleHash: string;
  targetBundleHash: string;
  targetBundleSize: number;
}

export type Platform = "ios" | "android";

/** JS bundle name react-native writes, and the name a client looks for in an update. */
export function getJsBundleName(platform: Platform): string {
  return platform === "ios" ? "main.jsbundle" : "index.android.bundle";
}

export function getOtherPlatform(platform: Platform): Platform {
  return platform === "ios" ? "android" : "ios";
}

export function sha256OfFile(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

/**
 * Copies the JS bundle out of the app binary that is installed on the device.
 *
 * @param appId {string} Android package name or iOS bundle identifier
 * @return path to the extracted bundle, ready to pass to `--binary-bundle-path`
 */
export function extractBinaryBundle(platform: Platform, appId: string): string {
  const bundleName = getJsBundleName(platform);
  const destDir = path.join(WORK_DIR, "binary-bundle", platform);
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });
  const destPath = path.join(destDir, bundleName);

  if (platform === "android") {
    extractAndroidBinaryBundle(appId, bundleName, destPath, destDir);
  } else {
    extractIosBinaryBundle(appId, bundleName, destPath);
  }

  const size = fs.statSync(destPath).size;
  if (size === 0) {
    throw new Error(`The JS bundle extracted from the installed ${platform} app is empty`);
  }
  console.log(`[binary-patch] base bundle extracted from the installed app: ${destPath} (${size} bytes)`);

  return destPath;
}

function extractAndroidBinaryBundle(
  appId: string,
  bundleName: string,
  destPath: string,
  workDir: string,
): void {
  const paths = execFileSync("adb", ["shell", "pm", "path", appId], { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("package:"))
    .map((line) => line.slice("package:".length));

  const apkPath = paths.find((candidate) => candidate.endsWith("base.apk")) ?? paths[0];
  if (!apkPath) {
    throw new Error(`Could not find the installed APK of "${appId}". Install the app before running this phase.`);
  }

  const localApkPath = path.join(workDir, "installed.apk");
  execFileSync("adb", ["pull", apkPath, localApkPath], { stdio: "ignore" });
  try {
    const bundle = execFileSync("unzip", ["-p", localApkPath, `assets/${bundleName}`], {
      maxBuffer: 512 * 1024 * 1024,
    });
    fs.writeFileSync(destPath, bundle);
  } finally {
    fs.rmSync(localApkPath, { force: true });
  }
}

function extractIosBinaryBundle(appId: string, bundleName: string, destPath: string): void {
  const appContainer = execFileSync("xcrun", ["simctl", "get_app_container", "booted", appId, "app"], {
    encoding: "utf8",
  }).trim();

  const bundlePath = path.join(appContainer, bundleName);
  if (!fs.existsSync(bundlePath)) {
    throw new Error(`The installed app at "${appContainer}" does not contain "${bundleName}"`);
  }

  fs.copyFileSync(bundlePath, destPath);
}

export function getHistoryFilePath(platform: Platform, identifier: string, binaryVersion: string): string {
  return path.join(MOCK_DATA_DIR, "histories", platform, identifier, `${binaryVersion}.json`);
}

export function readReleaseHistory(
  platform: Platform,
  identifier: string,
  binaryVersion: string,
): Record<string, {
  downloadUrl: string;
  packageHash: string;
  binaryPatchDownloadUrl?: string;
  diffPackages?: Record<string, string>;
}> {
  return JSON.parse(fs.readFileSync(getHistoryFilePath(platform, identifier, binaryVersion), "utf8"));
}

/**
 * Asserts that a release offers a binary patch, and returns the patch download URL.
 *
 * A patch is only published when it is smaller than the full archive, so a release that
 * was meant to exercise the patch path but silently went out without one would otherwise
 * turn into a scenario that quietly tests nothing.
 */
export function assertReleaseOffersPatch(
  scenario: string,
  platform: Platform,
  identifier: string,
  binaryVersion: string,
  releaseVersion: string,
): string {
  const release = readReleaseHistory(platform, identifier, binaryVersion)[releaseVersion];
  if (!release) {
    throw new Error(`${scenario}: v${releaseVersion} is missing from the "${identifier}" release history`);
  }

  const patchDownloadUrl = release.binaryPatchDownloadUrl;
  if (!patchDownloadUrl) {
    throw new Error(
      `${scenario}: v${releaseVersion} was published without a binary patch (binaryPatchDownloadUrl: ${String(patchDownloadUrl)})`,
    );
  }

  console.log(`[assert] ${scenario}: v${releaseVersion} offers a binary patch (${patchDownloadUrl})`);
  return patchDownloadUrl;
}

/** Asserts that a release says nothing about a binary patch, so a client downloads it in full. */
export function assertReleaseOffersNoPatch(
  scenario: string,
  platform: Platform,
  identifier: string,
  binaryVersion: string,
  releaseVersion: string,
): void {
  const release = readReleaseHistory(platform, identifier, binaryVersion)[releaseVersion];
  if (!release) {
    throw new Error(`${scenario}: v${releaseVersion} is missing from the "${identifier}" release history`);
  }

  if ("binaryPatchDownloadUrl" in release) {
    throw new Error(
      `${scenario}: v${releaseVersion} carries a binaryPatchDownloadUrl (${String(release.binaryPatchDownloadUrl)}), but it was released without a base bundle`,
    );
  }

  console.log(`[assert] ${scenario}: v${releaseVersion} offers the full archive only`);
}

/**
 * Asserts that two releases published the same update.
 *
 * Releasing one pre-built bundle twice is only a fair comparison of the two histories if
 * both of them describe the same package: the difference between them then has to be the
 * base bundle that was passed to one release and not the other.
 */
export function assertSameReleasedPackage(
  scenario: string,
  platform: Platform,
  identifier: string,
  otherIdentifier: string,
  releaseVersion: string,
): void {
  const packageHash = readReleaseHistory(platform, identifier, "1.0.0")[releaseVersion]?.packageHash;
  const otherPackageHash = readReleaseHistory(platform, otherIdentifier, "1.0.0")[releaseVersion]?.packageHash;

  if (!packageHash || packageHash !== otherPackageHash) {
    throw new Error(
      `${scenario}: "${identifier}" released ${String(packageHash)} but "${otherIdentifier}" released ${String(otherPackageHash)}`,
    );
  }

  console.log(`[assert] ${scenario}: both releases published ${packageHash}`);
}

/**
 * Serves one identifier's release history to the app, which reads only its own.
 *
 * This is how a single installed binary gets to install the same pre-built bundle twice:
 * once from a history that carries a patch URL and once from a history that does not.
 */
export function serveReleaseHistoryOf(
  platform: Platform,
  fromIdentifier: string,
  toIdentifier: string,
  binaryVersion: string,
): void {
  const source = getHistoryFilePath(platform, fromIdentifier, binaryVersion);
  const destination = getHistoryFilePath(platform, toIdentifier, binaryVersion);

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  console.log(`[binary-patch] serving the "${fromIdentifier}" release history as "${toIdentifier}"`);
}

export function findPatchArchive(platform: Platform, identifier: string): string {
  return findArchive(platform, identifier, "binary-patch");
}

/** The full archive of a release is stored under its full-bundle artifact type. */
export function findFullArchive(platform: Platform, identifier: string): string {
  return findArchive(platform, identifier, "full-bundle");
}

/** The one asset diff archive in the served data, stored under its asset-diff artifact type. */
export function findAssetDiffArchive(platform: Platform, identifier: string): string {
  return findArchive(platform, identifier, "asset-diff");
}

function findArchive(
  platform: Platform,
  identifier: string,
  artifactType: "full-bundle" | "binary-patch" | "asset-diff",
): string {
  const bundleDir = path.join(MOCK_DATA_DIR, "bundles", platform, identifier);
  const archivePaths = findFiles(bundleDir)
    .filter((filePath) => path.relative(bundleDir, filePath).split(path.sep).includes(artifactType));

  if (archivePaths.length !== 1) {
    throw new Error(
      `Expected exactly one ${artifactType} archive in "${bundleDir}", found ${archivePaths.length}: ` +
      `[${archivePaths.map((filePath) => path.relative(bundleDir, filePath)).join(", ")}]`,
    );
  }

  return archivePaths[0];
}

export function findFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    return entry.isDirectory() ? findFiles(entryPath) : [entryPath];
  });
}

export function readPatchManifest(archivePath: string): BinaryPatchManifest {
  const manifest = execFileSync("unzip", ["-p", archivePath, `*/${PATCH_MANIFEST_NAME}`], { encoding: "utf8" });
  return JSON.parse(manifest) as BinaryPatchManifest;
}

/** Every file inside an archive, relative to the directory the archive wraps them in. */
export function listArchiveContents(archivePath: string): string[] {
  return execFileSync("unzip", ["-Z", "-1", archivePath], { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.endsWith("/"))
    .map((line) => line.split("/").slice(1).join("/"));
}

/** Copies the JS bundle out of a full update archive, without installing anything. */
export function extractBundleFromArchive(archivePath: string, bundleName: string, destPath: string): void {
  const bundle = execFileSync("unzip", ["-p", archivePath, `*/${bundleName}`], {
    maxBuffer: 512 * 1024 * 1024,
  });

  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, bundle);
}

/**
 * Rewrites an archive in place, leaving its name - and so the download URL the release
 * history already points at - untouched.
 */
export function rewriteArchive(archivePath: string, mutate: (contentsDir: string) => void): void {
  fs.mkdirSync(WORK_DIR, { recursive: true });
  const stagingDir = fs.mkdtempSync(path.join(WORK_DIR, "archive-"));

  try {
    execFileSync("unzip", ["-q", "-o", archivePath, "-d", stagingDir]);
    mutate(resolveContentsDir(stagingDir));

    fs.rmSync(archivePath);
    // Archives are stored under their extensionless package hash, and zip appends ".zip"
    // to a target without an extension - so the archive is written under a name zip will
    // leave alone, then moved onto the name the download URL points at.
    const rezipPath = `${archivePath}.rezip.zip`;
    execFileSync("zip", ["-q", "-r", "-X", rezipPath, ...fs.readdirSync(stagingDir)], { cwd: stagingDir });
    fs.renameSync(rezipPath, archivePath);
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

/** An archive wraps its files in a single directory, and that directory is the contents root. */
function resolveContentsDir(extractDir: string): string {
  const entries = fs.readdirSync(extractDir, { withFileTypes: true });
  if (entries.length === 1 && entries[0].isDirectory()) {
    return path.join(extractDir, entries[0].name);
  }
  return extractDir;
}

function readManifestFile(contentsDir: string): BinaryPatchManifest {
  return JSON.parse(fs.readFileSync(path.join(contentsDir, PATCH_MANIFEST_NAME), "utf8")) as BinaryPatchManifest;
}

function writeManifestFile(contentsDir: string, manifest: BinaryPatchManifest): void {
  fs.writeFileSync(path.join(contentsDir, PATCH_MANIFEST_NAME), JSON.stringify(manifest, null, 2));
}

/**
 * Corrupts the compressed data of the patch, leaving its header intact.
 *
 * Whether body corruption is reported depends on where it lands: these last bytes are the
 * tail of the zstd stream, so the decoder rejects them and the apply fails outright, while
 * a flip inside a literals block would decode to different bytes with no error at all.
 * What the scenario pins down is what holds in both cases - an archive whose patch data is
 * not the data that was published never installs an update. The defence for the half the
 * codec cannot see, the hash of the restored bundle, is exercised by the "restored bundle
 * that the manifest does not describe" scenario instead.
 */
export function corruptPatchBody(archivePath: string): void {
  rewriteArchive(archivePath, (contentsDir) => {
    const patchPath = path.join(contentsDir, readManifestFile(contentsDir).patchFile);
    const patch = fs.readFileSync(patchPath);

    if (patch.length < 32) {
      throw new Error(`The patch at "${patchPath}" is too small to corrupt without touching its header`);
    }

    for (let offset = patch.length - 4; offset < patch.length; offset += 1) {
      patch[offset] = patch[offset] ^ 0xff;
    }
    fs.writeFileSync(patchPath, patch);
  });
}

/**
 * Leaves the patch intact but makes the manifest describe a different bundle than the one
 * it restores.
 *
 * Applying a patch is not self-verifying: the applier reports success over whatever bytes
 * it produced. This isolates the check that stands behind it - the hash of the restored
 * bundle - by giving it a bundle that applies cleanly and still is not the promised one.
 */
export function breakRestoredBundleExpectation(archivePath: string): void {
  rewriteArchive(archivePath, (contentsDir) => {
    const manifest = readManifestFile(contentsDir);
    writeManifestFile(contentsDir, { ...manifest, targetBundleHash: manifest.baseBundleHash });
  });
}

/** Corrupts the header of the patch, so the applier cannot even read what it is. */
export function corruptPatchHeader(archivePath: string): void {
  rewriteArchive(archivePath, (contentsDir) => {
    const patchPath = path.join(contentsDir, readManifestFile(contentsDir).patchFile);
    const patch = fs.readFileSync(patchPath);

    patch.fill(0, 0, Math.min(8, patch.length));
    fs.writeFileSync(patchPath, patch);
  });
}

/**
 * Turns a patch archive into the archive the other platform's release would have
 * published: the patch entry is renamed to the other platform's bundle path and the
 * manifest is restamped to describe that bundle, against a base hash the running binary
 * does not carry - the caller passes the hash of a stale bundle.
 *
 * Leaving the patch data itself untouched still models a crossed artifact faithfully,
 * because the client compares the base hash against the bundle inside its own binary
 * before it ever uses the path the manifest names: a genuine other-platform archive is
 * refused at exactly that check, and nothing beyond it is ever reached.
 *
 * Serving it to this platform is the mistake a release pipeline makes when the two
 * platforms' artifacts are crossed, and the client has to refuse it and download the
 * full archive instead.
 */
export function retargetPatchArchiveToOtherPlatform(
  archivePath: string,
  platform: Platform,
  otherPlatformBaseBundleHash: string,
): void {
  const otherBundleName = getJsBundleName(getOtherPlatform(platform));

  rewriteArchive(archivePath, (contentsDir) => {
    const manifest = readManifestFile(contentsDir);
    const otherPatchFile = `${otherBundleName}.patch`;

    fs.renameSync(path.join(contentsDir, manifest.patchFile), path.join(contentsDir, otherPatchFile));
    writeManifestFile(contentsDir, {
      ...manifest,
      bundlePath: otherBundleName,
      patchFile: otherPatchFile,
      baseBundleHash: otherPlatformBaseBundleHash,
    });
  });
}

/**
 * Asserts that the patch archive carries the update's assets as they are.
 *
 * Only the JS bundle is sent as a patch; everything else in an update travels in the
 * patch archive untouched, which is what lets the restored contents hash to the same
 * package as the full archive.
 */
export function assertPatchArchiveCarriesAssets(scenario: string, archivePath: string): void {
  const contents = listArchiveContents(archivePath);
  const assets = contents.filter((entry) => /(^|\/)(assets|drawable[^/]*|raw)\//.test(entry));

  if (assets.length === 0) {
    throw new Error(
      `${scenario}: the patch archive carries no assets, so this release does not exercise them. Contents: [${contents.join(", ")}]`,
    );
  }

  console.log(`[assert] ${scenario}: patch archive carries ${assets.length} asset file(s)`);
}
