/**
 * A binary patch is announced in the release history and consumed by the native side,
 * which only ever sees the object handed to `downloadUpdate`. These cases pin that path:
 * what the release history says, what `checkForUpdate` resolves to, what the native
 * module is given when the update is downloaded, and what an app that asked to hear how
 * the patch went is told about it.
 */

jest.mock('react-native', () => ({
  Alert: { alert: jest.fn() },
  AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
  NativeEventEmitter: class NativeEventEmitter {
    addListener() {
      return { remove: jest.fn() };
    }
  },
  NativeModules: {},
  Platform: { OS: 'ios' },
  TurboModuleRegistry: { get: () => null },
}));

// The install modes are the ones of the native module the bridge below stands in for.
const { InstallMode } = require('./native/NativeCodePush');

const BINARY_VERSION = '1.0.0';
const LABEL = '1.0.1';
const PACKAGE_HASH = 'a'.repeat(64);
const DOWNLOAD_URL = 'https://cdn.example.com/full.zip';
const BINARY_PATCH_DOWNLOAD_URL = 'https://cdn.example.com/full.zip-patch.zip';
const DIFF_URL = 'https://cdn.example.com/diff-from-base.zip';
const INSTALLED_HASH = 'base-package-hash';

/** The release the CLI writes when only the full bundle was published. */
function fullOnlyRelease() {
  return {
    [LABEL]: {
      enabled: true,
      mandatory: false,
      downloadUrl: DOWNLOAD_URL,
      packageHash: PACKAGE_HASH,
    },
  };
}

/** The release the CLI writes when the update was published with a binary patch too. */
function patchedRelease() {
  return {
    [LABEL]: {
      ...fullOnlyRelease()[LABEL],
      binaryPatchDownloadUrl: BINARY_PATCH_DOWNLOAD_URL,
    },
  };
}

/** The release the CLI writes when the update also has a diff archive against an earlier one. */
function diffRelease() {
  const history = patchedRelease();
  history[LABEL].diffPackages = { [INSTALLED_HASH]: DIFF_URL };
  return history;
}

/**
 * @param updateArchiveResult what the native side reports the archive attempts ended in,
 *        which only a download that had an archive to try comes back with.
 * @param installedPackage the CodePush update the app is running, if any.
 */
function createNativeBridge({ updateArchiveResult, installedPackage } = {}) {
  return {
    addDownloadProgressListener: jest.fn(() => ({ remove: jest.fn() })),
    downloadUpdate: jest.fn(async (updatePackage) => ({
      ...updatePackage,
      ...(updateArchiveResult ? { updateArchiveResult } : {}),
    })),
    // Without an installed CodePush update, the app runs the bundle of its binary.
    getUpdateMetadata: jest.fn(async () => installedPackage ?? null),
    isFailedUpdate: jest.fn(async () => false),
    isFirstRun: jest.fn(async () => false),
    // The rest of what a full `sync()` reaches for.
    InstallMode,
    clearPendingRestart: jest.fn(),
    getNewStatusReport: jest.fn(async () => null),
    installUpdate: jest.fn(async () => {}),
    notifyApplicationReady: jest.fn(async () => {}),
  };
}

/**
 * Loads a fresh copy of the module - the options passed to `codePush()` and the injected
 * native bridge live on the module itself - configured the way an app configures it: the
 * decorator registers the app-wide options, and every sync below is one the app asks for.
 *
 * @param onUpdateArchiveResult a callback the app registers on the decorator, as opposed to
 *        one it passes to a single `sync()` call.
 */
function loadCodePush({ releaseHistory = {}, updateChecker, updateArchiveResult, onUpdateArchiveResult, installedPackage } = {}) {
  jest.resetModules();
  const CodePush = require('./CodePush');
  const nativeBridge = createNativeBridge({ updateArchiveResult, installedPackage });

  CodePush.setUpTestDependencies(
    null,
    { appVersion: BINARY_VERSION, clientUniqueId: 'test-client-id' },
    nativeBridge,
  );
  CodePush({
    checkFrequency: CodePush.CheckFrequency.MANUAL,
    releaseHistoryFetcher: async () => releaseHistory,
    updateChecker,
    onUpdateArchiveResult,
  });

  return { CodePush, nativeBridge };
}

/** The metadata the native module is given, without the functions mixed into the package. */
function downloadedPackageMetadata(nativeBridge) {
  expect(nativeBridge.downloadUpdate).toHaveBeenCalledTimes(1);
  return nativeBridge.downloadUpdate.mock.calls[0][0];
}

describe('checkForUpdate with a binary patch in the release history', () => {
  it('carries the patch url into the update and on to the native module', async () => {
    const { CodePush, nativeBridge } = loadCodePush({ releaseHistory: patchedRelease() });

    const remotePackage = await CodePush.checkForUpdate();

    expect(remotePackage.downloadUrl).toBe(DOWNLOAD_URL);
    expect(remotePackage.binaryPatchDownloadUrl).toBe(BINARY_PATCH_DOWNLOAD_URL);

    await remotePackage.download();

    expect(downloadedPackageMetadata(nativeBridge)).toMatchObject({
      downloadUrl: DOWNLOAD_URL,
      binaryPatchDownloadUrl: BINARY_PATCH_DOWNLOAD_URL,
      label: LABEL,
      packageHash: PACKAGE_HASH,
    });
  });

  it('reads the patch url of the release being installed, not of another one', async () => {
    const { CodePush } = loadCodePush({
      releaseHistory: {
        '1.0.1': {
          enabled: true,
          mandatory: false,
          downloadUrl: 'https://cdn.example.com/older.zip',
          binaryPatchDownloadUrl: 'https://cdn.example.com/older.zip-patch.zip',
          packageHash: 'b'.repeat(64),
        },
        '1.0.2': {
          enabled: true,
          mandatory: false,
          downloadUrl: DOWNLOAD_URL,
          binaryPatchDownloadUrl: BINARY_PATCH_DOWNLOAD_URL,
          packageHash: PACKAGE_HASH,
        },
      },
    });

    const remotePackage = await CodePush.checkForUpdate();

    expect(remotePackage.label).toBe('1.0.2');
    expect(remotePackage.binaryPatchDownloadUrl).toBe(BINARY_PATCH_DOWNLOAD_URL);
  });
});

describe('checkForUpdate without a binary patch in the release history', () => {
  it('leaves the patch url out of the update and of the native metadata', async () => {
    const { CodePush, nativeBridge } = loadCodePush({ releaseHistory: fullOnlyRelease() });

    const remotePackage = await CodePush.checkForUpdate();

    expect(remotePackage.downloadUrl).toBe(DOWNLOAD_URL);
    expect(remotePackage).not.toHaveProperty('binaryPatchDownloadUrl');

    await remotePackage.download();

    expect(downloadedPackageMetadata(nativeBridge)).not.toHaveProperty('binaryPatchDownloadUrl');
  });

  it('serves a release history written before binary patches existed', async () => {
    const { CodePush } = loadCodePush({
      releaseHistory: {
        [BINARY_VERSION]: {
          enabled: true,
          mandatory: false,
          downloadUrl: 'https://cdn.example.com/binary.zip',
          packageHash: 'c'.repeat(64),
        },
        [LABEL]: {
          enabled: true,
          mandatory: true,
          downloadUrl: DOWNLOAD_URL,
          packageHash: PACKAGE_HASH,
          rollout: 100,
        },
      },
    });

    const remotePackage = await CodePush.checkForUpdate();

    expect(remotePackage).toMatchObject({
      label: LABEL,
      appVersion: BINARY_VERSION,
      downloadUrl: DOWNLOAD_URL,
      packageHash: PACKAGE_HASH,
      isMandatory: true,
    });
    expect(remotePackage).not.toHaveProperty('binaryPatchDownloadUrl');
  });
});

/**
 * A diff archive only applies to the one release it was computed against, so whether the
 * diff url is handed to the native side at all depends on what the app is running right
 * now. The patch url is always handed over with it, because the diff falling back to the
 * patch archive is the native side's decision to make.
 */
describe('checkForUpdate with asset diff packages in the release history', () => {
  it('carries the diff url next to the patch url when the installed update matches a diff base', async () => {
    const { CodePush, nativeBridge } = loadCodePush({
      releaseHistory: diffRelease(),
      installedPackage: { packageHash: INSTALLED_HASH },
    });

    const remotePackage = await CodePush.checkForUpdate();
    await remotePackage.download();

    expect(downloadedPackageMetadata(nativeBridge)).toMatchObject({
      downloadUrl: DOWNLOAD_URL,
      binaryPatchDownloadUrl: BINARY_PATCH_DOWNLOAD_URL,
      assetDiffDownloadUrl: DIFF_URL,
    });
  });

  it('leaves the diff url out when the installed update matches no diff base', async () => {
    const { CodePush, nativeBridge } = loadCodePush({
      releaseHistory: diffRelease(),
      installedPackage: { packageHash: 'other-hash' },
    });

    const remotePackage = await CodePush.checkForUpdate();
    await remotePackage.download();

    const metadata = downloadedPackageMetadata(nativeBridge);
    expect(metadata).toMatchObject({ binaryPatchDownloadUrl: BINARY_PATCH_DOWNLOAD_URL });
    expect(metadata).not.toHaveProperty('assetDiffDownloadUrl');
  });

  it('leaves the diff url out when no update is installed', async () => {
    const { CodePush, nativeBridge } = loadCodePush({ releaseHistory: diffRelease() });

    const remotePackage = await CodePush.checkForUpdate();
    await remotePackage.download();

    const metadata = downloadedPackageMetadata(nativeBridge);
    expect(metadata).toMatchObject({ binaryPatchDownloadUrl: BINARY_PATCH_DOWNLOAD_URL });
    expect(metadata).not.toHaveProperty('assetDiffDownloadUrl');
  });

  it('does not send the diff package map across the bridge', async () => {
    const { CodePush, nativeBridge } = loadCodePush({
      releaseHistory: diffRelease(),
      installedPackage: { packageHash: INSTALLED_HASH },
    });

    const remotePackage = await CodePush.checkForUpdate();
    expect(remotePackage).not.toHaveProperty('diffPackages');

    await remotePackage.download();

    expect(downloadedPackageMetadata(nativeBridge)).not.toHaveProperty('diffPackages');
  });
});

describe('checkForUpdate through the deprecated updateChecker', () => {
  it('carries the patch url of the update check response', async () => {
    const { CodePush } = loadCodePush({
      updateChecker: async () => ({
        update_info: {
          is_available: true,
          download_url: DOWNLOAD_URL,
          binary_patch_download_url: BINARY_PATCH_DOWNLOAD_URL,
          target_binary_range: BINARY_VERSION,
          label: LABEL,
          package_hash: PACKAGE_HASH,
        },
      }),
    });

    const remotePackage = await CodePush.checkForUpdate();

    expect(remotePackage.binaryPatchDownloadUrl).toBe(BINARY_PATCH_DOWNLOAD_URL);
  });

  it('leaves it out when the update check response has none', async () => {
    const { CodePush } = loadCodePush({
      updateChecker: async () => ({
        update_info: {
          is_available: true,
          download_url: DOWNLOAD_URL,
          target_binary_range: BINARY_VERSION,
          label: LABEL,
          package_hash: PACKAGE_HASH,
        },
      }),
    });

    const remotePackage = await CodePush.checkForUpdate();

    expect(remotePackage).not.toHaveProperty('binaryPatchDownloadUrl');
  });
});

/**
 * How the archive attempts went is reported to the app that asked to hear about it, and to
 * nobody else: it is not part of the update, and an app that asked for nothing gets the
 * install it always got.
 */
describe('the update archive result of a sync', () => {
  const APPLIED = {
    status: 'applied',
    archive: 'binary-patch',
    totalDurationMs: 812,
    attempts: [{ archive: 'binary-patch', durationMs: 812, applyDurationMs: 64 }],
  };
  const FELL_BACK = {
    status: 'fallback',
    archive: 'binary-patch',
    fallbackReason: 'base_hash_mismatch',
    totalDurationMs: 1503,
    attempts: [{ archive: 'binary-patch', fallbackReason: 'base_hash_mismatch', durationMs: 1503 }],
  };
  const APPLIED_AFTER_DIFF_FELL_BACK = {
    status: 'applied',
    archive: 'binary-patch',
    totalDurationMs: 1503,
    attempts: [
      { archive: 'asset-diff', fallbackReason: 'asset_merge_failed', durationMs: 690, applyDurationMs: 41 },
      { archive: 'binary-patch', durationMs: 813, applyDurationMs: 58 },
    ],
  };

  /** The metadata the update is installed from, as the native module is given it. */
  function installedPackageMetadata(nativeBridge) {
    expect(nativeBridge.installUpdate).toHaveBeenCalledTimes(1);
    return nativeBridge.installUpdate.mock.calls[0][0];
  }

  it('tells the app the update was installed from its patch, and how long that took', async () => {
    const { CodePush, nativeBridge } = loadCodePush({
      releaseHistory: patchedRelease(),
      updateArchiveResult: APPLIED,
    });
    const onUpdateArchiveResult = jest.fn();

    const syncStatus = await CodePush.sync({ onUpdateArchiveResult });

    expect(syncStatus).toBe(CodePush.SyncStatus.UPDATE_INSTALLED);
    expect(onUpdateArchiveResult).toHaveBeenCalledTimes(1);
    expect(onUpdateArchiveResult).toHaveBeenCalledWith(LABEL, APPLIED);
    expect(nativeBridge.installUpdate).toHaveBeenCalledTimes(1);
  });

  it('tells the app why the update came from the full archive instead', async () => {
    const { CodePush } = loadCodePush({
      releaseHistory: patchedRelease(),
      updateArchiveResult: FELL_BACK,
    });
    const onUpdateArchiveResult = jest.fn();

    // A patch that could not be applied is not a failed update: the full archive installs.
    const syncStatus = await CodePush.sync({ onUpdateArchiveResult });

    expect(syncStatus).toBe(CodePush.SyncStatus.UPDATE_INSTALLED);
    expect(onUpdateArchiveResult).toHaveBeenCalledWith(LABEL, FELL_BACK);
  });

  it("the app is handed each archive's apply time and the whole path's total", async () => {
    const { CodePush } = loadCodePush({
      releaseHistory: diffRelease(),
      installedPackage: { packageHash: INSTALLED_HASH },
      updateArchiveResult: APPLIED_AFTER_DIFF_FELL_BACK,
    });
    const onUpdateArchiveResult = jest.fn();

    await CodePush.sync({ onUpdateArchiveResult });

    expect(onUpdateArchiveResult).toHaveBeenCalledWith(LABEL, APPLIED_AFTER_DIFF_FELL_BACK);
    const [, result] = onUpdateArchiveResult.mock.calls[0];
    expect(result.totalDurationMs).toBe(1503);
    expect(result.attempts.map((attempt) => attempt.applyDurationMs)).toEqual([41, 58]);
  });

  it('tells the app that registered the callback on the decorator, even about a sync it asked for itself', async () => {
    const onUpdateArchiveResult = jest.fn();
    const { CodePush } = loadCodePush({
      releaseHistory: patchedRelease(),
      updateArchiveResult: APPLIED,
      onUpdateArchiveResult,
    });

    // The decorator checks nothing on its own, so this sync is the app's own call.
    const syncStatus = await CodePush.sync();

    expect(syncStatus).toBe(CodePush.SyncStatus.UPDATE_INSTALLED);
    expect(onUpdateArchiveResult).toHaveBeenCalledTimes(1);
    expect(onUpdateArchiveResult).toHaveBeenCalledWith(LABEL, APPLIED);
  });

  it('tells only the callback of the sync call when one was passed to it', async () => {
    const registeredOnTheDecorator = jest.fn();
    const passedToTheSyncCall = jest.fn();
    const { CodePush } = loadCodePush({
      releaseHistory: patchedRelease(),
      updateArchiveResult: APPLIED,
      onUpdateArchiveResult: registeredOnTheDecorator,
    });

    const syncStatus = await CodePush.sync({ onUpdateArchiveResult: passedToTheSyncCall });

    expect(syncStatus).toBe(CodePush.SyncStatus.UPDATE_INSTALLED);
    expect(passedToTheSyncCall).toHaveBeenCalledTimes(1);
    expect(passedToTheSyncCall).toHaveBeenCalledWith(LABEL, APPLIED);
    expect(registeredOnTheDecorator).not.toHaveBeenCalled();
  });

  it('says nothing about a download that had no patch to try', async () => {
    const { CodePush } = loadCodePush({ releaseHistory: fullOnlyRelease() });
    const onUpdateArchiveResult = jest.fn();

    const syncStatus = await CodePush.sync({ onUpdateArchiveResult });

    expect(syncStatus).toBe(CodePush.SyncStatus.UPDATE_INSTALLED);
    expect(onUpdateArchiveResult).not.toHaveBeenCalled();
  });

  it('installs the update even when the callback throws', async () => {
    const { CodePush, nativeBridge } = loadCodePush({
      releaseHistory: patchedRelease(),
      updateArchiveResult: APPLIED,
    });
    const onUpdateArchiveResult = jest.fn(() => {
      throw new Error('the telemetry the app sends the result to is down');
    });

    const syncStatus = await CodePush.sync({ onUpdateArchiveResult });

    expect(syncStatus).toBe(CodePush.SyncStatus.UPDATE_INSTALLED);
    expect(onUpdateArchiveResult).toHaveBeenCalledTimes(1);
    expect(nativeBridge.installUpdate).toHaveBeenCalledTimes(1);
  });

  it('keeps the result out of the package the update is installed from', async () => {
    const { CodePush, nativeBridge } = loadCodePush({
      releaseHistory: patchedRelease(),
      updateArchiveResult: APPLIED,
    });

    await CodePush.sync({ onUpdateArchiveResult: jest.fn() });

    const installedPackage = installedPackageMetadata(nativeBridge);
    expect(installedPackage).toMatchObject({ label: LABEL, packageHash: PACKAGE_HASH });
    expect(installedPackage).not.toHaveProperty('updateArchiveResult');
  });

  it('installs the same update, without the result, when no callback is registered', async () => {
    const { CodePush, nativeBridge } = loadCodePush({
      releaseHistory: patchedRelease(),
      updateArchiveResult: FELL_BACK,
    });

    const syncStatus = await CodePush.sync();

    expect(syncStatus).toBe(CodePush.SyncStatus.UPDATE_INSTALLED);
    expect(installedPackageMetadata(nativeBridge)).not.toHaveProperty('updateArchiveResult');
  });

  it('resolves a direct download even when the callback passed to it throws', async () => {
    const { CodePush } = loadCodePush({
      releaseHistory: patchedRelease(),
      updateArchiveResult: APPLIED,
    });
    const onUpdateArchiveResult = jest.fn(() => {
      throw new Error('the telemetry the app sends the result to is down');
    });

    const remotePackage = await CodePush.checkForUpdate();
    const localPackage = await remotePackage.download(undefined, onUpdateArchiveResult);

    expect(onUpdateArchiveResult).toHaveBeenCalledTimes(1);
    expect(localPackage).toMatchObject({ label: LABEL, packageHash: PACKAGE_HASH });
  });

  it('leaves the result off the package a download resolves with', async () => {
    const { CodePush } = loadCodePush({
      releaseHistory: patchedRelease(),
      updateArchiveResult: APPLIED,
    });

    const remotePackage = await CodePush.checkForUpdate();
    const localPackage = await remotePackage.download();

    expect(localPackage).toMatchObject({ label: LABEL, packageHash: PACKAGE_HASH });
    expect(localPackage).not.toHaveProperty('updateArchiveResult');
  });
});
