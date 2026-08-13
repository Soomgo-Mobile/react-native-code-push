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

/**
 * @param binaryPatchResult what the native side reports the patch attempt ended in, which
 *        only a download that had a patch to try comes back with.
 */
function createNativeBridge({ binaryPatchResult } = {}) {
  return {
    addDownloadProgressListener: jest.fn(() => ({ remove: jest.fn() })),
    downloadUpdate: jest.fn(async (updatePackage) => ({
      ...updatePackage,
      ...(binaryPatchResult ? { binaryPatchResult } : {}),
    })),
    // No CodePush update is installed, so the app runs the bundle of its binary.
    getUpdateMetadata: jest.fn(async () => null),
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
 * native bridge live on the module itself - configured the way an app configures it.
 */
function loadCodePush({ releaseHistory = {}, updateChecker, binaryPatchResult } = {}) {
  jest.resetModules();
  const CodePush = require('./CodePush');
  const nativeBridge = createNativeBridge({ binaryPatchResult });

  CodePush.setUpTestDependencies(
    null,
    { appVersion: BINARY_VERSION, clientUniqueId: 'test-client-id' },
    nativeBridge,
  );
  CodePush({
    releaseHistoryFetcher: async () => releaseHistory,
    updateChecker,
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
 * How a patch attempt went is reported to the app that asked to hear about it, and to
 * nobody else: it is not part of the update, and an app that asked for nothing gets the
 * install it always got.
 */
describe('the binary patch result of a sync', () => {
  const APPLIED = { status: 'applied', applyDurationMs: 812 };
  const FELL_BACK = { status: 'fallback', fallbackReason: 'base_hash_mismatch', applyDurationMs: 1503 };

  /** The metadata the update is installed from, as the native module is given it. */
  function installedPackageMetadata(nativeBridge) {
    expect(nativeBridge.installUpdate).toHaveBeenCalledTimes(1);
    return nativeBridge.installUpdate.mock.calls[0][0];
  }

  it('tells the app the update was installed from its patch, and how long that took', async () => {
    const { CodePush, nativeBridge } = loadCodePush({
      releaseHistory: patchedRelease(),
      binaryPatchResult: APPLIED,
    });
    const onBinaryPatchResult = jest.fn();

    const syncStatus = await CodePush.sync({ onBinaryPatchResult });

    expect(syncStatus).toBe(CodePush.SyncStatus.UPDATE_INSTALLED);
    expect(onBinaryPatchResult).toHaveBeenCalledTimes(1);
    expect(onBinaryPatchResult).toHaveBeenCalledWith(LABEL, APPLIED);
    expect(nativeBridge.installUpdate).toHaveBeenCalledTimes(1);
  });

  it('tells the app why the update came from the full archive instead', async () => {
    const { CodePush } = loadCodePush({
      releaseHistory: patchedRelease(),
      binaryPatchResult: FELL_BACK,
    });
    const onBinaryPatchResult = jest.fn();

    // A patch that could not be applied is not a failed update: the full archive installs.
    const syncStatus = await CodePush.sync({ onBinaryPatchResult });

    expect(syncStatus).toBe(CodePush.SyncStatus.UPDATE_INSTALLED);
    expect(onBinaryPatchResult).toHaveBeenCalledWith(LABEL, FELL_BACK);
  });

  it('says nothing about a download that had no patch to try', async () => {
    const { CodePush } = loadCodePush({ releaseHistory: fullOnlyRelease() });
    const onBinaryPatchResult = jest.fn();

    const syncStatus = await CodePush.sync({ onBinaryPatchResult });

    expect(syncStatus).toBe(CodePush.SyncStatus.UPDATE_INSTALLED);
    expect(onBinaryPatchResult).not.toHaveBeenCalled();
  });

  it('installs the update even when the callback throws', async () => {
    const { CodePush, nativeBridge } = loadCodePush({
      releaseHistory: patchedRelease(),
      binaryPatchResult: APPLIED,
    });
    const onBinaryPatchResult = jest.fn(() => {
      throw new Error('the telemetry the app sends the result to is down');
    });

    const syncStatus = await CodePush.sync({ onBinaryPatchResult });

    expect(syncStatus).toBe(CodePush.SyncStatus.UPDATE_INSTALLED);
    expect(onBinaryPatchResult).toHaveBeenCalledTimes(1);
    expect(nativeBridge.installUpdate).toHaveBeenCalledTimes(1);
  });

  it('keeps the result out of the package the update is installed from', async () => {
    const { CodePush, nativeBridge } = loadCodePush({
      releaseHistory: patchedRelease(),
      binaryPatchResult: APPLIED,
    });

    await CodePush.sync({ onBinaryPatchResult: jest.fn() });

    const installedPackage = installedPackageMetadata(nativeBridge);
    expect(installedPackage).toMatchObject({ label: LABEL, packageHash: PACKAGE_HASH });
    expect(installedPackage).not.toHaveProperty('binaryPatchResult');
  });

  it('installs the same update, without the result, when no callback is registered', async () => {
    const { CodePush, nativeBridge } = loadCodePush({
      releaseHistory: patchedRelease(),
      binaryPatchResult: FELL_BACK,
    });

    const syncStatus = await CodePush.sync();

    expect(syncStatus).toBe(CodePush.SyncStatus.UPDATE_INSTALLED);
    expect(installedPackageMetadata(nativeBridge)).not.toHaveProperty('binaryPatchResult');
  });

  it('leaves the result off the package a download resolves with', async () => {
    const { CodePush } = loadCodePush({
      releaseHistory: patchedRelease(),
      binaryPatchResult: APPLIED,
    });

    const remotePackage = await CodePush.checkForUpdate();
    const localPackage = await remotePackage.download();

    expect(localPackage).toMatchObject({ label: LABEL, packageHash: PACKAGE_HASH });
    expect(localPackage).not.toHaveProperty('binaryPatchResult');
  });
});
