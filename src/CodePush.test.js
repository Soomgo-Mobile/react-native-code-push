/**
 * A binary patch is announced in the release history and consumed by the native side,
 * which only ever sees the object handed to `downloadUpdate`. These cases pin that path:
 * what the release history says, what `checkForUpdate` resolves to, and what the native
 * module is given when the update is downloaded.
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

function createNativeBridge() {
  return {
    addDownloadProgressListener: jest.fn(() => ({ remove: jest.fn() })),
    downloadUpdate: jest.fn(async (updatePackage) => ({ ...updatePackage })),
    // No CodePush update is installed, so the app runs the bundle of its binary.
    getUpdateMetadata: jest.fn(async () => null),
    isFailedUpdate: jest.fn(async () => false),
    isFirstRun: jest.fn(async () => false),
  };
}

/**
 * Loads a fresh copy of the module - the options passed to `codePush()` and the injected
 * native bridge live on the module itself - configured the way an app configures it.
 */
function loadCodePush({ releaseHistory = {}, updateChecker } = {}) {
  jest.resetModules();
  const CodePush = require('./CodePush');
  const nativeBridge = createNativeBridge();

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
    const { CodePush, nativeBridge } = loadCodePush({
      releaseHistory: {
        [LABEL]: {
          ...fullOnlyRelease()[LABEL],
          binaryPatchDownloadUrl: BINARY_PATCH_DOWNLOAD_URL,
        },
      },
    });

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
