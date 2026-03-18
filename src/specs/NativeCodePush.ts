import { TurboModuleRegistry } from 'react-native';
import type { TurboModule } from 'react-native';
import type {
  EventEmitter,
  UnsafeObject,
} from 'react-native/Libraries/Types/CodegenTypes';

export type DownloadProgress = {
  receivedBytes: number;
  totalBytes: number;
};

export interface Spec extends TurboModule {
  downloadUpdate(updatePackage: UnsafeObject, notifyProgress: boolean): Promise<UnsafeObject>;
  getConfiguration(): Promise<UnsafeObject>;
  getUpdateMetadata(updateState: number): Promise<UnsafeObject | null>;
  getNewStatusReport(): Promise<UnsafeObject | null>;
  installUpdate(
    updatePackage: UnsafeObject,
    installMode: number,
    minimumBackgroundDuration: number,
  ): Promise<void>;
  isFailedUpdate(packageHash: string): Promise<boolean>;
  getLatestRollbackInfo(): Promise<UnsafeObject | null>;
  setLatestRollbackInfo(packageHash: string): Promise<void>;
  isFirstRun(packageHash: string): Promise<boolean>;
  notifyApplicationReady(): Promise<void>;
  allow(): void;
  disallow(): void;
  clearPendingRestart(): void;
  restartApp(onlyIfUpdateIsPending: boolean): void;
  recordStatusReported(statusReport: UnsafeObject): void;
  saveStatusReportForRetry(statusReport: UnsafeObject): void;
  clearUpdates(): void;

  readonly onDownloadProgress: EventEmitter<DownloadProgress>;
}

export function getNativeCodePushTurboModule(): Spec | null {
  return TurboModuleRegistry.get<Spec>('CodePush');
}

export default getNativeCodePushTurboModule();
