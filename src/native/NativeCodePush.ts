import { NativeEventEmitter, NativeModules } from 'react-native';
import { getNativeCodePushTurboModule } from '../specs/NativeCodePush';
import type { DownloadProgress, Spec as NativeCodePushSpec } from '../specs/NativeCodePush';

export const DOWNLOAD_PROGRESS_EVENT_NAME = 'CodePushDownloadProgress';

export const InstallMode = Object.freeze({
  IMMEDIATE: 0,
  ON_NEXT_RESTART: 1,
  ON_NEXT_RESUME: 2,
  ON_NEXT_SUSPEND: 3,
});

export const UpdateState = Object.freeze({
  RUNNING: 0,
  PENDING: 1,
  LATEST: 2,
});

type Subscription = {
  remove: () => void;
};

type LegacyCodePushModule = {
  addListener?: (eventName: string) => void;
  allow: () => void | Promise<void>;
  clearPendingRestart: () => void | Promise<void>;
  clearUpdates: () => void;
  disallow: () => void | Promise<void>;
  downloadAndReplaceCurrentBundle?: (remoteBundleUrl: string) => void;
  downloadUpdate: (updatePackage: object, notifyProgress: boolean) => Promise<object>;
  getConfiguration: () => Promise<object>;
  getLatestRollbackInfo: () => Promise<object | null>;
  getNewStatusReport: () => Promise<object | string | null>;
  getUpdateMetadata: (updateState: number) => Promise<object | null>;
  installUpdate: (
    updatePackage: object,
    installMode: number,
    minimumBackgroundDuration: number,
  ) => Promise<void>;
  isFailedUpdate: (packageHash: string) => Promise<boolean>;
  isFirstRun: (packageHash: string) => Promise<boolean>;
  notifyApplicationReady: () => Promise<void>;
  recordStatusReported: (statusReport: object) => void;
  removeListeners?: (count: number) => void;
  restartApp: (onlyIfUpdateIsPending: boolean) => void | Promise<void>;
  saveStatusReportForRetry: (statusReport: object) => void;
  setLatestRollbackInfo: (packageHash: string) => Promise<void>;
};

type CodePushModule = LegacyCodePushModule & {
  onDownloadProgress?: NativeCodePushSpec['onDownloadProgress'];
};

type EventEmitterCapableCodePushModule = LegacyCodePushModule & {
  addListener: NonNullable<LegacyCodePushModule['addListener']>;
  removeListeners: NonNullable<LegacyCodePushModule['removeListeners']>;
};

function getTurboModule(): CodePushModule | null {
  return getNativeCodePushTurboModule() as CodePushModule | null;
}

function getLegacyModule(): LegacyCodePushModule | null {
  return (NativeModules.CodePush ?? null) as LegacyCodePushModule | null;
}

function getNativeModule(): CodePushModule | null {
  const turboModule = getTurboModule();
  if (turboModule) {
    return turboModule;
  }

  return getLegacyModule();
}

function normalizeStatusReport(statusReport: object | string | null | undefined) {
  if (!statusReport || typeof statusReport === 'string') {
    return null;
  }

  return statusReport;
}

function canUseNativeEventEmitter(
  module: LegacyCodePushModule,
): module is EventEmitterCapableCodePushModule {
  return (
    typeof module.addListener === 'function' &&
    typeof module.removeListeners === 'function'
  );
}

function addDownloadProgressListener(
  listener: (progress: DownloadProgress) => void,
): Subscription {
  const nativeModule = getNativeModule();
  if (!nativeModule) {
    return {
      remove() {},
    };
  }

  const turboModule = getTurboModule();
  if (turboModule?.onDownloadProgress) {
    return turboModule.onDownloadProgress(listener);
  }

  const legacyModule = getLegacyModule();
  if (!legacyModule || !canUseNativeEventEmitter(legacyModule)) {
    return {
      remove() {},
    };
  }

  const eventEmitter = new NativeEventEmitter(legacyModule);
  return eventEmitter.addListener(DOWNLOAD_PROGRESS_EVENT_NAME, listener);
}

function createNativeCodePush() {
  return {
    InstallMode,
    UpdateState,
    addDownloadProgressListener,
    allow: () => getNativeModule()?.allow(),
    clearPendingRestart: () => getNativeModule()?.clearPendingRestart(),
    clearUpdates: () => getNativeModule()?.clearUpdates(),
    disallow: () => getNativeModule()?.disallow(),
    downloadAndReplaceCurrentBundle: (remoteBundleUrl: string) =>
      getNativeModule()?.downloadAndReplaceCurrentBundle?.(remoteBundleUrl),
    downloadUpdate: (updatePackage: object, notifyProgress: boolean) =>
      getNativeModule()?.downloadUpdate(updatePackage, notifyProgress),
    getConfiguration: () => getNativeModule()?.getConfiguration(),
    getLatestRollbackInfo: () => getNativeModule()?.getLatestRollbackInfo(),
    getNewStatusReport: async () =>
      normalizeStatusReport(await getNativeModule()?.getNewStatusReport()),
    getUpdateMetadata: (updateState: number) => getNativeModule()?.getUpdateMetadata(updateState),
    installUpdate: (
      updatePackage: object,
      installMode: number,
      minimumBackgroundDuration: number,
    ) => getNativeModule()?.installUpdate(updatePackage, installMode, minimumBackgroundDuration),
    isFailedUpdate: (packageHash: string) => getNativeModule()?.isFailedUpdate(packageHash),
    isFirstRun: (packageHash: string) => getNativeModule()?.isFirstRun(packageHash),
    notifyApplicationReady: () => getNativeModule()?.notifyApplicationReady(),
    recordStatusReported: (statusReport: object) =>
      getNativeModule()?.recordStatusReported(statusReport),
    restartApp: (onlyIfUpdateIsPending: boolean) =>
      getNativeModule()?.restartApp(onlyIfUpdateIsPending),
    saveStatusReportForRetry: (statusReport: object) =>
      getNativeModule()?.saveStatusReportForRetry(statusReport),
    setLatestRollbackInfo: (packageHash: string) =>
      getNativeModule()?.setLatestRollbackInfo(packageHash),
  };
}

export function getNativeCodePush() {
  const nativeModule = getNativeModule();
  return nativeModule ? createNativeCodePush() : null;
}

export default getNativeCodePush();
