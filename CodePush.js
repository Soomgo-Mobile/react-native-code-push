import { Alert } from "./AlertAdapter";
import { AppState, Platform } from "react-native";
import log from "./logging";
import hoistStatics from 'hoist-non-react-statics';
import { SemverVersioning } from './versioning/SemverVersioning'

let NativeCodePush = require("react-native").NativeModules.CodePush;
const PackageMixins = require("./package-mixins")(NativeCodePush);

const DEPLOYMENT_KEY = 'deprecated_deployment_key';

// TODO: split the rollout decision logic into a separate js module
const RolloutStorage = require("react-native").NativeModules.RolloutStorage;
const ROLLOUT_CACHE_PREFIX = 'CodePushRolloutDecision_';
const ROLLOUT_CACHE_KEY = 'CodePushRolloutKey';

/**
 * @param deviceId {string}
 * @returns {number}
 */
function hashDeviceId(deviceId) {
  let hash = 0;
  for (let i = 0; i < deviceId.length; i++) {
    hash = ((hash << 5) - hash) + deviceId.charCodeAt(i);
    hash |= 0; // Convert to 32bit int
  }
  return Math.abs(hash);
}

/**
 * @param label {string}
 * @param rollout {number|undefined}
 * @returns {string}
 */
function getRolloutKey(label, rollout) {
  return `${ROLLOUT_CACHE_PREFIX}${label}_rollout_${rollout ?? 100}`;
}

/**
 * @param clientId {string}
 * @param packageHash {string}
 * @returns {number}
 */
function getBucket(clientId, packageHash) {
  const hash = hashDeviceId(`${clientId ?? ''}_${packageHash ?? ''}`);
  return (Math.abs(hash) % 100);
}

/**
 * Note that the `clientUniqueId` value may not guarantee the same value if the app is deleted and re-installed.
 * In other words, if a user re-installs the app, the result of this function may change.
 * @returns {Promise<boolean>}
 */
async function decideLatestReleaseIsInRollout(versioning, clientId, onRolloutSkipped) {
  try {
    const [latestVersion, latestReleaseInfo] = versioning.findLatestRelease();

    if (latestReleaseInfo.rollout === undefined || latestReleaseInfo.rollout >= 100) {
      return true;
    }

    const rolloutKey = getRolloutKey(latestVersion, latestReleaseInfo.rollout);
    const cachedDecision = await RolloutStorage.getItem(rolloutKey);

    if (cachedDecision != null) {
      // should apply if cachedDecision is true
      return cachedDecision === 'true';
    }

    const bucket = getBucket(clientId, latestReleaseInfo.packageHash);
    const inRollout = bucket < latestReleaseInfo.rollout;
    const prevRolloutCacheKey = await RolloutStorage.getItem(ROLLOUT_CACHE_KEY);

    log(`Bucket: ${bucket}, rollout: ${latestReleaseInfo.rollout} → ${inRollout ? 'IN' : 'OUT'}`);

    if (prevRolloutCacheKey) {
      await RolloutStorage.removeItem(prevRolloutCacheKey);
    }
    await RolloutStorage.setItem(ROLLOUT_CACHE_KEY, rolloutKey);
    await RolloutStorage.setItem(rolloutKey, inRollout.toString());

    if (!inRollout) {
      log(`Skipping update due to rollout. Bucket ${bucket} is not smaller than rollout range ${latestReleaseInfo.rollout}.`);
      onRolloutSkipped?.(latestVersion);
    }

    return inRollout;
  } catch {
    // If an error occurs while accessing storage, we assume the update is not in the rollout.
    return false;
  }
}

async function checkForUpdate(handleBinaryVersionMismatchCallback = null) {
  /*
   * Before we ask the server if an update exists, we
   * need to retrieve three pieces of information from the
   * native side: deployment key, app version (e.g. 1.0.1)
   * and the hash of the currently running update (if there is one).
   * This allows the client to only receive updates which are targetted
   * for their specific deployment and version and which are actually
   * different from the CodePush update they have already installed.
   */
  const nativeConfig = await getConfiguration();

  // Use dynamically overridden getCurrentPackage() during tests.
  const localPackage = await module.exports.getCurrentPackage();

  /*
   * If the app has a previously installed update, and that update
   * was targetted at the same app version that is currently running,
   * then we want to use its package hash to determine whether a new
   * release has been made on the server. Otherwise, we only need
   * to send the app version to the server, since we are interested
   * in any updates for current binary version, regardless of hash.
   */
  let queryPackage;
  if (localPackage) {
    queryPackage = localPackage;
  } else {
    queryPackage = { appVersion: nativeConfig.appVersion };
    if (Platform.OS === "ios" && nativeConfig.packageHash) {
      queryPackage.packageHash = nativeConfig.packageHash;
    }
  }

  /**
   * @type {RemotePackage|null|undefined}
   */
  const update = await (async () => {
    try {
      const updateRequest = {
        app_version: queryPackage.appVersion,
        package_hash: queryPackage.packageHash,
        is_companion: nativeConfig.ignoreAppVersion,
        label: queryPackage.label,
        client_unique_id: nativeConfig.clientUniqueId,
      };

      /**
       * @type {updateChecker|undefined}
       * @deprecated
       */
      const updateChecker = sharedCodePushOptions.updateChecker;
      if (updateChecker) {
        // We do not provide rollout functionality. This could be implemented in the `updateChecker`.
        const { update_info } = await updateChecker(updateRequest);
        return mapToRemotePackageMetadata(update_info);
      } else {
        /**
         * `releaseHistory`
         * @type {ReleaseHistoryInterface}
         */
        const releaseHistory = await sharedCodePushOptions.releaseHistoryFetcher(updateRequest);

        /**
         * `runtimeVersion`
         * The version of currently running CodePush update. (It can be undefined if the app is running without CodePush update.)
         * @type {string|undefined}
         */
        const runtimeVersion = updateRequest.label;

        const versioning = new SemverVersioning(releaseHistory);

        const isInRollout = await decideLatestReleaseIsInRollout(versioning, nativeConfig.clientUniqueId, sharedCodePushOptions?.onRolloutSkipped);
        versioning.setIsLatestReleaseInRollout(isInRollout);

        const shouldRollbackToBinary = versioning.shouldRollbackToBinary(runtimeVersion)
        if (shouldRollbackToBinary) {
          // Reset to latest major version and restart
          CodePush.clearUpdates();
          CodePush.allowRestart();
          CodePush.restartApp();
        }

        const [latestVersion, latestReleaseInfo] = versioning.findLatestRelease();
        const isMandatory = versioning.checkIsMandatory(runtimeVersion);

        /**
         * Convert the update information decided from `ReleaseHistoryInterface` to be passed to the library core (original CodePush library).
         *
         * @type {UpdateCheckResponse} the interface required by the original CodePush library.
         */
        const updateInfo = {
          download_url: latestReleaseInfo.downloadUrl,
          // (`enabled` will always be true in the release information obtained from the previous process.)
          is_available: latestReleaseInfo.enabled,
          package_hash: latestReleaseInfo.packageHash,
          is_mandatory: isMandatory,
          /**
           * The `ReleaseHistoryInterface` data returned by the `releaseHistoryFetcher` function is
           * based on the assumption that it is compatible with the current runtime binary.
           * (because it is querying the update history deployed for the current binary version)
           * Therefore, the current runtime binary version should be passed as it is.
           */
          target_binary_range: updateRequest.app_version,
          /**
           * Retrieve the update version from the ReleaseHistory and store it in the label.
           * This information can be accessed at runtime through the CodePush bundle metadata.
           */
          label: latestVersion,
          // `false` should be passed to work properly
          update_app_version: false,
          // currently not used.
          description: "",
          // not used at runtime.
          is_disabled: false,
          // not used at runtime.
          package_size: 0,
          // not used at runtime.
          should_run_binary_version: false,
        };

        return mapToRemotePackageMetadata(updateInfo);
      }
    } catch (error) {
      log(`An error has occurred at update checker :`);
      console.error(error)
      // update will not happen
      return undefined;
    }
  })();

  /*
   * There are four cases where checkForUpdate will resolve to null:
   * ----------------------------------------------------------------
   * 1) The server said there isn't an update. This is the most common case.
   * 2) The server said there is an update but it requires a newer binary version.
   *    This would occur when end-users are running an older binary version than
   *    is available, and CodePush is making sure they don't get an update that
   *    potentially wouldn't be compatible with what they are running.
   * 3) The server said there is an update, but the update's hash is the same as
   *    the currently running update. This should _never_ happen, unless there is a
   *    bug in the server, but we're adding this check just to double-check that the
   *    client app is resilient to a potential issue with the update check.
   * 4) The server said there is an update, but the update's hash is the same as that
   *    of the binary's currently running version. This should only happen in Android -
   *    unlike iOS, we don't attach the binary's hash to the updateCheck request
   *    because we want to avoid having to install diff updates against the binary's
   *    version, which we can't do yet on Android.
   */
  if (!update || update.updateAppVersion ||
      localPackage && (update.packageHash === localPackage.packageHash) ||
      (!localPackage || localPackage._isDebugOnly) && nativeConfig.packageHash === update.packageHash) {
    if (update && update.updateAppVersion) {
      log("An update is available but it is not targeting the binary version of your app.");
      if (handleBinaryVersionMismatchCallback && typeof handleBinaryVersionMismatchCallback === "function") {
        handleBinaryVersionMismatchCallback(update)
      }
    }

    return null;
  } else {
    const remotePackage = { ...update, ...PackageMixins.remote() };
    remotePackage.failedInstall = await NativeCodePush.isFailedUpdate(remotePackage.packageHash);
    return remotePackage;
  }
}

/**
 * @param updateInfo {UpdateCheckResponse}
 * @return {RemotePackage | null}
 */
function mapToRemotePackageMetadata(updateInfo) {
  if (!updateInfo) {
    return null;
  } else if (!updateInfo.download_url) {
    log("download_url is missed in the release history.");
    return null;
  } else if (!updateInfo.is_available) {
    return null;
  }

  // refer to `RemotePackage` type inside code-push SDK
  return {
    deploymentKey: DEPLOYMENT_KEY,
    description: updateInfo.description ?? '',
    label: updateInfo.label ?? '',
    appVersion: updateInfo.target_binary_range ?? '',
    isMandatory: updateInfo.is_mandatory ?? false,
    packageHash: updateInfo.package_hash ?? '',
    packageSize: updateInfo.package_size ?? 0,
    downloadUrl: updateInfo.download_url ?? '',
  };
}

const getConfiguration = (() => {
  let config;
  return async function getConfiguration() {
    if (config) {
      return config;
    } else if (testConfig) {
      return testConfig;
    } else {
      config = await NativeCodePush.getConfiguration();
      return config;
    }
  }
})();

async function getCurrentPackage() {
  return await getUpdateMetadata(CodePush.UpdateState.LATEST);
}

async function getUpdateMetadata(updateState) {
  let updateMetadata = await NativeCodePush.getUpdateMetadata(updateState || CodePush.UpdateState.RUNNING);
  if (updateMetadata) {
    updateMetadata = { ...PackageMixins.local, ...updateMetadata };
    updateMetadata.failedInstall = await NativeCodePush.isFailedUpdate(updateMetadata.packageHash);
    updateMetadata.isFirstRun = await NativeCodePush.isFirstRun(updateMetadata.packageHash);
  }
  return updateMetadata;
}

// This ensures that notifyApplicationReadyInternal is only called once
// in the lifetime of this module instance.
const notifyApplicationReady = (() => {
  let notifyApplicationReadyPromise;
  return () => {
    if (!notifyApplicationReadyPromise) {
      notifyApplicationReadyPromise = notifyApplicationReadyInternal();
    }

    return notifyApplicationReadyPromise;
  };
})();

async function notifyApplicationReadyInternal() {
  await NativeCodePush.notifyApplicationReady();
  const statusReport = await NativeCodePush.getNewStatusReport();
  statusReport && tryReportStatus(statusReport); // Don't wait for this to complete.

  return statusReport;
}

async function tryReportStatus(statusReport, retryOnAppResume) {
  try {
    if (statusReport.appVersion) {
      log(`Reporting binary update (${statusReport.appVersion})`);
    } else {
      const label = statusReport.package.label;
      if (statusReport.status === "DeploymentSucceeded") {
        log(`Reporting CodePush update success (${label})`);
        sharedCodePushOptions?.onUpdateSuccess?.(label);
      } else {
        log(`Reporting CodePush update rollback (${label})`);
        await NativeCodePush.setLatestRollbackInfo(statusReport.package.packageHash);
        sharedCodePushOptions?.onUpdateRollback?.(label);
      }
    }

    NativeCodePush.recordStatusReported(statusReport);
    retryOnAppResume && retryOnAppResume.remove();
  } catch (e) {
    log(`${e}`)
    log(`Report status failed: ${JSON.stringify(statusReport)}`);
    NativeCodePush.saveStatusReportForRetry(statusReport);
    // Try again when the app resumes
    if (!retryOnAppResume) {
      const resumeListener = AppState.addEventListener("change", async (newState) => {
        if (newState !== "active") return;
        const refreshedStatusReport = await NativeCodePush.getNewStatusReport();
        if (refreshedStatusReport) {
          tryReportStatus(refreshedStatusReport, resumeListener);
        } else {
          resumeListener && resumeListener.remove();
        }
      });
    }
  }
}

async function shouldUpdateBeIgnored(remotePackage, syncOptions) {
  let { rollbackRetryOptions } = syncOptions;

  const isFailedPackage = remotePackage && remotePackage.failedInstall;
  if (!isFailedPackage || !syncOptions.ignoreFailedUpdates) {
    return false;
  }

  if (!rollbackRetryOptions) {
    return true;
  }

  if (typeof rollbackRetryOptions !== "object") {
    rollbackRetryOptions = CodePush.DEFAULT_ROLLBACK_RETRY_OPTIONS;
  } else {
    rollbackRetryOptions = { ...CodePush.DEFAULT_ROLLBACK_RETRY_OPTIONS, ...rollbackRetryOptions };
  }

  if (!validateRollbackRetryOptions(rollbackRetryOptions)) {
    return true;
  }

  const latestRollbackInfo = await NativeCodePush.getLatestRollbackInfo();
  if (!validateLatestRollbackInfo(latestRollbackInfo, remotePackage.packageHash)) {
    log("The latest rollback info is not valid.");
    return true;
  }

  const { delayInHours, maxRetryAttempts } = rollbackRetryOptions;
  const hoursSinceLatestRollback = (Date.now() - latestRollbackInfo.time) / (1000 * 60 * 60);
  if (hoursSinceLatestRollback >= delayInHours && maxRetryAttempts >= latestRollbackInfo.count) {
    log("Previous rollback should be ignored due to rollback retry options.");
    return false;
  }

  return true;
}

function validateLatestRollbackInfo(latestRollbackInfo, packageHash) {
  return latestRollbackInfo &&
    latestRollbackInfo.time &&
    latestRollbackInfo.count &&
    latestRollbackInfo.packageHash &&
    latestRollbackInfo.packageHash === packageHash;
}

function validateRollbackRetryOptions(rollbackRetryOptions) {
  if (typeof rollbackRetryOptions.delayInHours !== "number") {
    log("The 'delayInHours' rollback retry parameter must be a number.");
    return false;
  }

  if (typeof rollbackRetryOptions.maxRetryAttempts !== "number") {
    log("The 'maxRetryAttempts' rollback retry parameter must be a number.");
    return false;
  }

  if (rollbackRetryOptions.maxRetryAttempts < 1) {
    log("The 'maxRetryAttempts' rollback retry parameter cannot be less then 1.");
    return false;
  }

  return true;
}

let testConfig;

// This function is only used for tests. Replaces the default SDK, configuration and native bridge
function setUpTestDependencies(testSdk, providedTestConfig, testNativeBridge) {
  if (testSdk) module.exports.AcquisitionSdk = testSdk;
  if (providedTestConfig) testConfig = providedTestConfig;
  if (testNativeBridge) NativeCodePush = testNativeBridge;
}

async function restartApp(onlyIfUpdateIsPending = false) {
  NativeCodePush.restartApp(onlyIfUpdateIsPending);
}

// This function allows only one syncInternal operation to proceed at any given time.
// Parallel calls to sync() while one is ongoing yields CodePush.SyncStatus.SYNC_IN_PROGRESS.
const sync = (() => {
  let syncInProgress = false;
  const setSyncCompleted = () => { syncInProgress = false; };

  return (options = {}, syncStatusChangeCallback, downloadProgressCallback, handleBinaryVersionMismatchCallback) => {
    let syncStatusCallbackWithTryCatch, downloadProgressCallbackWithTryCatch;
    if (typeof syncStatusChangeCallback === "function") {
      syncStatusCallbackWithTryCatch = (...args) => {
        try {
          syncStatusChangeCallback(...args);
        } catch (error) {
          log(`An error has occurred : ${error.stack}`);
        }
      }
    }

    if (typeof downloadProgressCallback === "function") {
      downloadProgressCallbackWithTryCatch = (...args) => {
        try {
          downloadProgressCallback(...args);
        } catch (error) {
          log(`An error has occurred: ${error.stack}`);
        }
      }
    }

    if (syncInProgress) {
      typeof syncStatusCallbackWithTryCatch === "function"
        ? syncStatusCallbackWithTryCatch(CodePush.SyncStatus.SYNC_IN_PROGRESS)
        : log("Sync already in progress.");
      return Promise.resolve(CodePush.SyncStatus.SYNC_IN_PROGRESS);
    }

    syncInProgress = true;
    const syncPromise = syncInternal(options, syncStatusCallbackWithTryCatch, downloadProgressCallbackWithTryCatch, handleBinaryVersionMismatchCallback);
    syncPromise
      .then(setSyncCompleted)
      .catch(setSyncCompleted);

    return syncPromise;
  };
})();

/*
 * The syncInternal method provides a simple, one-line experience for
 * incorporating the check, download and installation of an update.
 *
 * It simply composes the existing API methods together and adds additional
 * support for respecting mandatory updates, ignoring previously failed
 * releases, and displaying a standard confirmation UI to the end-user
 * when an update is available.
 */
async function syncInternal(options = {}, syncStatusChangeCallback, downloadProgressCallback, handleBinaryVersionMismatchCallback) {
  let resolvedInstallMode;
  const syncOptions = {
    deploymentKey: null,
    ignoreFailedUpdates: true,
    rollbackRetryOptions: null,
    installMode: CodePush.InstallMode.ON_NEXT_RESTART,
    mandatoryInstallMode: CodePush.InstallMode.IMMEDIATE,
    minimumBackgroundDuration: 0,
    updateDialog: null,
    ...options,
  };

  syncStatusChangeCallback = typeof syncStatusChangeCallback === "function"
    ? syncStatusChangeCallback
    : (syncStatus) => {
      switch (syncStatus) {
        case CodePush.SyncStatus.CHECKING_FOR_UPDATE:
          log("Checking for update.");
          break;
        case CodePush.SyncStatus.AWAITING_USER_ACTION:
          log("Awaiting user action.");
          break;
        case CodePush.SyncStatus.DOWNLOADING_PACKAGE:
          log("Downloading package.");
          break;
        case CodePush.SyncStatus.INSTALLING_UPDATE:
          log("Installing update.");
          break;
        case CodePush.SyncStatus.UP_TO_DATE:
          log("App is up to date.");
          break;
        case CodePush.SyncStatus.UPDATE_IGNORED:
          log("User cancelled the update.");
          break;
        case CodePush.SyncStatus.UPDATE_INSTALLED:
          if (resolvedInstallMode == CodePush.InstallMode.ON_NEXT_RESTART) {
            log("Update is installed and will be run on the next app restart.");
          } else if (resolvedInstallMode == CodePush.InstallMode.ON_NEXT_RESUME) {
            if (syncOptions.minimumBackgroundDuration > 0) {
              log(`Update is installed and will be run after the app has been in the background for at least ${syncOptions.minimumBackgroundDuration} seconds.`);
            } else {
              log("Update is installed and will be run when the app next resumes.");
            }
          }
          break;
        case CodePush.SyncStatus.UNKNOWN_ERROR:
          log("An unknown error occurred.");
          break;
      }
    };

  let remotePackageLabel;
  try {
    await CodePush.notifyApplicationReady();

    syncStatusChangeCallback(CodePush.SyncStatus.CHECKING_FOR_UPDATE);
    const remotePackage = await checkForUpdate(handleBinaryVersionMismatchCallback);
    remotePackageLabel = remotePackage?.label;

    const doDownloadAndInstall = async () => {
      syncStatusChangeCallback(CodePush.SyncStatus.DOWNLOADING_PACKAGE);
      sharedCodePushOptions.onDownloadStart?.(remotePackageLabel);

      const localPackage = await remotePackage.download(downloadProgressCallback);

      sharedCodePushOptions.onDownloadSuccess?.(remotePackageLabel);

      // Determine the correct install mode based on whether the update is mandatory or not.
      resolvedInstallMode = localPackage.isMandatory ? syncOptions.mandatoryInstallMode : syncOptions.installMode;

      syncStatusChangeCallback(CodePush.SyncStatus.INSTALLING_UPDATE);
      await localPackage.install(resolvedInstallMode, syncOptions.minimumBackgroundDuration, () => {
        syncStatusChangeCallback(CodePush.SyncStatus.UPDATE_INSTALLED);
      });

      return CodePush.SyncStatus.UPDATE_INSTALLED;
    };

    const updateShouldBeIgnored = await shouldUpdateBeIgnored(remotePackage, syncOptions);

    if (!remotePackage || updateShouldBeIgnored) {
      if (updateShouldBeIgnored) {
        log("An update is available, but it is being ignored due to having been previously rolled back.");
      }

      const currentPackage = await CodePush.getCurrentPackage();
      if (currentPackage && currentPackage.isPending) {
        syncStatusChangeCallback(CodePush.SyncStatus.UPDATE_INSTALLED);
        return CodePush.SyncStatus.UPDATE_INSTALLED;
      } else {
        syncStatusChangeCallback(CodePush.SyncStatus.UP_TO_DATE);
        return CodePush.SyncStatus.UP_TO_DATE;
      }
    } else if (syncOptions.updateDialog) {
      // updateDialog supports any truthy value (e.g. true, "goo", 12),
      // but we should treat a non-object value as just the default dialog
      if (typeof syncOptions.updateDialog !== "object") {
        syncOptions.updateDialog = CodePush.DEFAULT_UPDATE_DIALOG;
      } else {
        syncOptions.updateDialog = { ...CodePush.DEFAULT_UPDATE_DIALOG, ...syncOptions.updateDialog };
      }

      return await new Promise((resolve, reject) => {
        let message = null;
        let installButtonText = null;

        const dialogButtons = [];

        if (remotePackage.isMandatory) {
          message = syncOptions.updateDialog.mandatoryUpdateMessage;
          installButtonText = syncOptions.updateDialog.mandatoryContinueButtonLabel;
        } else {
          message = syncOptions.updateDialog.optionalUpdateMessage;
          installButtonText = syncOptions.updateDialog.optionalInstallButtonLabel;
          // Since this is an optional update, add a button
          // to allow the end-user to ignore it
          dialogButtons.push({
            text: syncOptions.updateDialog.optionalIgnoreButtonLabel,
            onPress: () => {
              syncStatusChangeCallback(CodePush.SyncStatus.UPDATE_IGNORED);
              resolve(CodePush.SyncStatus.UPDATE_IGNORED);
            },
          });
        }

        // Since the install button should be placed to the
        // right of any other button, add it last
        dialogButtons.push({
          text: installButtonText,
          onPress: () => {
            doDownloadAndInstall()
              .then(resolve, reject);
          },
        })

        // If the update has a description, and the developer
        // explicitly chose to display it, then set that as the message
        if (syncOptions.updateDialog.appendReleaseDescription && remotePackage.description) {
          message += `${syncOptions.updateDialog.descriptionPrefix} ${remotePackage.description}`;
        }

        syncStatusChangeCallback(CodePush.SyncStatus.AWAITING_USER_ACTION);
        Alert.alert(syncOptions.updateDialog.title, message, dialogButtons);
      });
    } else {
      return await doDownloadAndInstall();
    }
  } catch (error) {
    syncStatusChangeCallback(CodePush.SyncStatus.UNKNOWN_ERROR);
    sharedCodePushOptions?.onSyncError?.(remotePackageLabel ?? 'unknown', error);
    log(error.message);
    throw error;
  }
};

let CodePush;

/**
 * @callback releaseHistoryFetcher
 * @param {UpdateCheckRequest} updateRequest Current package information to check for updates.
 * @returns {Promise<ReleaseHistoryInterface>} The release history of the updates deployed for a specific binary version.
 */

/**
 * @callback updateChecker
 * @param {UpdateCheckRequest} updateRequest Current package information to check for updates.
 * @returns {Promise<{update_info: UpdateCheckResponse}>} The result of the update check. Follows the AppCenter API response interface.
 *
 * @deprecated It will be removed in the next major version.
 */

/**
 * If you pass options once when calling `codePushify`, they will be shared with related functions.
 * @type {{
 *   releaseHistoryFetcher: releaseHistoryFetcher | undefined,
 *   setReleaseHistoryFetcher(releaseHistoryFetcherFunction: releaseHistoryFetcher | undefined): void,
 *
 *   updateChecker: updateChecker | undefined,
 *   setUpdateChecker(updateCheckerFunction: updateChecker | undefined): void,
 *
 *   onUpdateSuccess: (label: string) => void | undefined,
 *   setOnUpdateSuccess(onUpdateSuccessFunction: (label: string) => void | undefined): void,
 *
 *   onUpdateRollback: (label: string) => void | undefined,
 *   setOnUpdateRollback(onUpdateRollbackFunction: (label: string) => void | undefined): void,
 *
 *   onDownloadStart: (label: string) => void | undefined,
 *   setOnDownloadStart(onDownloadStartFunction: (label: string) => void | undefined): void,
 *
 *   onDownloadSuccess: (label: string) => void | undefined,
 *   setOnDownloadSuccess(onDownloadSuccessFunction: (label: string) => void | undefined): void,
 *
 *   onSyncError: (label: string, error: Error) => void | undefined,
 *   setOnSyncError(onSyncErrorFunction: (label: string, error: Error) => void | undefined): void,
 *
 *   onRolloutSkipped: (label: string, error: Error) => void | undefined,
 *   setOnRolloutSkipped(onRolloutSkippedFunction: (label: string, error: Error) => void | undefined): void,
 * }}
 */
const sharedCodePushOptions = {
  releaseHistoryFetcher: undefined,
  setReleaseHistoryFetcher(releaseHistoryFetcherFunction) {
    if (!releaseHistoryFetcherFunction || typeof releaseHistoryFetcherFunction !== 'function') throw new Error('Please implement the releaseHistoryFetcher function');
    this.releaseHistoryFetcher = releaseHistoryFetcherFunction;
  },
  updateChecker: undefined,
  setUpdateChecker(updateCheckerFunction) {
    if (!updateCheckerFunction) return;
    if (typeof updateCheckerFunction !== 'function') throw new Error('Please pass a function to updateChecker');
    this.updateChecker = updateCheckerFunction;
  },
  onUpdateSuccess: undefined,
  setOnUpdateSuccess(onUpdateSuccessFunction) {
    if (!onUpdateSuccessFunction) return;
    if (typeof onUpdateSuccessFunction !== 'function') throw new Error('Please pass a function to onUpdateSuccess');
    this.onUpdateSuccess = onUpdateSuccessFunction;
  },
  onUpdateRollback: undefined,
  setOnUpdateRollback(onUpdateRollbackFunction) {
    if (!onUpdateRollbackFunction) return;
    if (typeof onUpdateRollbackFunction !== 'function') throw new Error('Please pass a function to onUpdateRollback');
    this.onUpdateRollback = onUpdateRollbackFunction;
  },
  onDownloadStart: undefined,
  setOnDownloadStart(onDownloadStartFunction) {
    if (!onDownloadStartFunction) return;
    if (typeof onDownloadStartFunction !== 'function') throw new Error('Please pass a function to onDownloadStart');
    this.onDownloadStart = onDownloadStartFunction;
  },
  onDownloadSuccess: undefined,
  setOnDownloadSuccess(onDownloadSuccessFunction) {
    if (!onDownloadSuccessFunction) return;
    if (typeof onDownloadSuccessFunction !== 'function') throw new Error('Please pass a function to onDownloadSuccess');
    this.onDownloadSuccess = onDownloadSuccessFunction;
  },
  onSyncError: undefined,
  setOnSyncError(onSyncErrorFunction) {
    if (!onSyncErrorFunction) return;
    if (typeof onSyncErrorFunction !== 'function') throw new Error('Please pass a function to onSyncError');
    this.onSyncError = onSyncErrorFunction;
  },
  onRolloutSkipped: undefined,
  setOnRolloutSkipped(onRolloutSkippedFunction) {
    if (!onRolloutSkippedFunction) return;
    if (typeof onRolloutSkippedFunction !== 'function') throw new Error('Please pass a function to onRolloutSkipped');
    this.onRolloutSkipped = onRolloutSkippedFunction;
  },
}

function codePushify(options = {}) {
  let React;
  let ReactNative = require("react-native");

  try { React = require("react"); } catch (e) { }
  if (!React) {
    try { React = ReactNative.React; } catch (e) { }
    if (!React) {
      throw new Error("Unable to find the 'React' module.");
    }
  }

  if (!React.Component) {
    throw new Error(
`Unable to find the "Component" class, please either:
1. Upgrade to a newer version of React Native that supports it, or
2. Call the codePush.sync API in your component instead of using the @codePush decorator`,
    );
  }

  if (options.updateChecker && !options.releaseHistoryFetcher) {
    throw new Error('If you want to use `updateChecker`, pass a no-op function to releaseHistoryFetcher option. (e.g. `releaseHistoryFetcher: async () => ({})`)');
  }

  sharedCodePushOptions.setReleaseHistoryFetcher(options.releaseHistoryFetcher);
  sharedCodePushOptions.setUpdateChecker(options.updateChecker);

  // set telemetry callbacks
  sharedCodePushOptions.setOnUpdateSuccess(options.onUpdateSuccess);
  sharedCodePushOptions.setOnUpdateRollback(options.onUpdateRollback);
  sharedCodePushOptions.setOnDownloadStart(options.onDownloadStart);
  sharedCodePushOptions.setOnDownloadSuccess(options.onDownloadSuccess);
  sharedCodePushOptions.setOnSyncError(options.onSyncError);
  sharedCodePushOptions.setOnRolloutSkipped(options.onRolloutSkipped);

  const decorator = (RootComponent) => {
    class CodePushComponent extends React.Component {
      constructor(props) {
        super(props);
        this.rootComponentRef = React.createRef();
      }

      componentDidMount() {
        if (options.checkFrequency === CodePush.CheckFrequency.MANUAL) {
          CodePush.notifyAppReady();
        } else {
          const rootComponentInstance = this.rootComponentRef.current;

          let syncStatusCallback;
          if (rootComponentInstance && rootComponentInstance.codePushStatusDidChange) {
            syncStatusCallback = rootComponentInstance.codePushStatusDidChange.bind(rootComponentInstance);
          }

          let downloadProgressCallback;
          if (rootComponentInstance && rootComponentInstance.codePushDownloadDidProgress) {
            downloadProgressCallback = rootComponentInstance.codePushDownloadDidProgress.bind(rootComponentInstance);
          }

          let handleBinaryVersionMismatchCallback;
          if (rootComponentInstance && rootComponentInstance.codePushOnBinaryVersionMismatch) {
            handleBinaryVersionMismatchCallback = rootComponentInstance.codePushOnBinaryVersionMismatch.bind(rootComponentInstance);
          }

          CodePush.sync(options, syncStatusCallback, downloadProgressCallback, handleBinaryVersionMismatchCallback);

          if (options.checkFrequency === CodePush.CheckFrequency.ON_APP_RESUME) {
            ReactNative.AppState.addEventListener("change", (newState) => {
              if (newState === "active") {
                CodePush.sync(options, syncStatusCallback, downloadProgressCallback);
              }
            });
          }
        }
      }

      render() {
        const props = { ...this.props };

        // We can set ref property on class components only (not stateless)
        // Check it by render method
        if (RootComponent.prototype && RootComponent.prototype.render) {
          props.ref = this.rootComponentRef;
        }

        return <RootComponent {...props} />
      }
    }

    return hoistStatics(CodePushComponent, RootComponent);
  }

  if (typeof options === "function") {
    // Infer that the root component was directly passed to us.
    return decorator(options);
  } else {
    return decorator;
  }
}

// If the "NativeCodePush" variable isn't defined, then
// the app didn't properly install the native module,
// and therefore, it doesn't make sense initializing
// the JS interface when it wouldn't work anyways.
if (NativeCodePush) {
  CodePush = codePushify;
  Object.assign(CodePush, {
    checkForUpdate,
    getConfiguration,
    getCurrentPackage,
    getUpdateMetadata,
    log,
    notifyAppReady: notifyApplicationReady,
    notifyApplicationReady,
    restartApp,
    setUpTestDependencies,
    sync,
    disallowRestart: NativeCodePush.disallow,
    allowRestart: NativeCodePush.allow,
    clearUpdates: NativeCodePush.clearUpdates,
    InstallMode: {
      IMMEDIATE: NativeCodePush.codePushInstallModeImmediate, // Restart the app immediately
      ON_NEXT_RESTART: NativeCodePush.codePushInstallModeOnNextRestart, // Don't artificially restart the app. Allow the update to be "picked up" on the next app restart
      ON_NEXT_RESUME: NativeCodePush.codePushInstallModeOnNextResume, // Restart the app the next time it is resumed from the background
      ON_NEXT_SUSPEND: NativeCodePush.codePushInstallModeOnNextSuspend, // Restart the app _while_ it is in the background,
      // but only after it has been in the background for "minimumBackgroundDuration" seconds (0 by default),
      // so that user context isn't lost unless the app suspension is long enough to not matter
    },
    SyncStatus: {
      UP_TO_DATE: 0, // The running app is up-to-date
      UPDATE_INSTALLED: 1, // The app had an optional/mandatory update that was successfully downloaded and is about to be installed.
      UPDATE_IGNORED: 2, // The app had an optional update and the end-user chose to ignore it
      UNKNOWN_ERROR: 3,
      SYNC_IN_PROGRESS: 4, // There is an ongoing "sync" operation in progress.
      CHECKING_FOR_UPDATE: 5,
      AWAITING_USER_ACTION: 6,
      DOWNLOADING_PACKAGE: 7,
      INSTALLING_UPDATE: 8,
    },
    CheckFrequency: {
      ON_APP_START: 0,
      ON_APP_RESUME: 1,
      MANUAL: 2,
    },
    UpdateState: {
      RUNNING: NativeCodePush.codePushUpdateStateRunning,
      PENDING: NativeCodePush.codePushUpdateStatePending,
      LATEST: NativeCodePush.codePushUpdateStateLatest,
    },
    DeploymentStatus: {
      FAILED: "DeploymentFailed",
      SUCCEEDED: "DeploymentSucceeded",
    },
    DEFAULT_UPDATE_DIALOG: {
      appendReleaseDescription: false,
      descriptionPrefix: " Description: ",
      mandatoryContinueButtonLabel: "Continue",
      mandatoryUpdateMessage: "An update is available that must be installed.",
      optionalIgnoreButtonLabel: "Ignore",
      optionalInstallButtonLabel: "Install",
      optionalUpdateMessage: "An update is available. Would you like to install it?",
      title: "Update available",
    },
    DEFAULT_ROLLBACK_RETRY_OPTIONS: {
      delayInHours: 24,
      maxRetryAttempts: 1,
    },
  });
} else {
  log("The CodePush module doesn't appear to be properly installed. Please double-check that everything is setup correctly.");
}

module.exports = CodePush;
