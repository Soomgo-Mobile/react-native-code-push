package com.microsoft.codepush.react;

import android.app.Activity;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.Choreographer;

import androidx.annotation.OptIn;

import com.facebook.react.ReactDelegate;
import com.facebook.react.ReactHost;
import com.facebook.react.ReactActivity;
import com.facebook.react.ReactInstanceManager;
import com.facebook.react.ReactRootView;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.JSBundleLoader;
import com.facebook.react.bridge.LifecycleEventListener;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.common.annotations.UnstableReactNativeAPI;
import com.facebook.react.module.annotations.ReactModule;
import com.facebook.react.modules.core.DeviceEventManagerModule;
import com.facebook.react.modules.core.ReactChoreographer;
import com.facebook.react.runtime.ReactHostDelegate;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.Date;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@ReactModule(name = CodePushNativeModule.NAME)
public class CodePushNativeModule extends NativeCodePushSpec {
    public static final String NAME = "CodePush";

    private String mBinaryContentsHash = null;
    private String mClientUniqueId = null;
    private LifecycleEventListener mLifecycleEventListener = null;
    private int mMinimumBackgroundDuration = 0;
    private final ExecutorService mBackgroundExecutor = Executors.newSingleThreadExecutor();

    private CodePush mCodePush;
    private SettingsManager mSettingsManager;
    private CodePushTelemetryManager mTelemetryManager;
    private CodePushUpdateManager mUpdateManager;

    private  boolean _allowed = true;
    private  boolean _restartInProgress = false;
    private  ArrayList<Boolean> _restartQueue = new ArrayList<>();

    public CodePushNativeModule(ReactApplicationContext reactContext, CodePush codePush, CodePushUpdateManager codePushUpdateManager, CodePushTelemetryManager codePushTelemetryManager, SettingsManager settingsManager) {
        super(reactContext);

        mCodePush = codePush;
        mSettingsManager = settingsManager;
        mTelemetryManager = codePushTelemetryManager;
        mUpdateManager = codePushUpdateManager;

        // Initialize module state while we have a reference to the current context.
        mBinaryContentsHash = CodePushUpdateUtils.getHashForBinaryContents(reactContext, mCodePush.isDebugMode());

        SharedPreferences preferences = codePush.getContext().getSharedPreferences(CodePushConstants.CODE_PUSH_PREFERENCES, 0);
        mClientUniqueId = preferences.getString(CodePushConstants.CLIENT_UNIQUE_ID_KEY, null);
        if (mClientUniqueId == null) {
            mClientUniqueId = UUID.randomUUID().toString();
            preferences.edit().putString(CodePushConstants.CLIENT_UNIQUE_ID_KEY, mClientUniqueId).apply();
        }
    }

    @Override
    public String getName() {
        return NAME;
    }

    @Override
    public void invalidate() {
        clearLifecycleEventListener();
        mBackgroundExecutor.shutdownNow();
        super.invalidate();
    }

    private void loadBundleLegacy() {
        final Activity currentActivity = getReactApplicationContext().getCurrentActivity();
        if (currentActivity == null) {
            // The currentActivity can be null if it is backgrounded / destroyed, so we simply
            // no-op to prevent any null pointer exceptions.
            return;
        }
        mCodePush.invalidateCurrentInstance();

        currentActivity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                currentActivity.recreate();
            }
        });
    }

    // Use reflection to find and set the appropriate fields on ReactInstanceManager. See #556 for a proposal for a less brittle way
    // to approach this.
    private void setJSBundle(String latestJSBundleFile) throws IllegalAccessException {
        try {
            JSBundleLoader latestJSBundleLoader;
            if (latestJSBundleFile.toLowerCase().startsWith("assets://")) {
                latestJSBundleLoader = JSBundleLoader.createAssetLoader(getReactApplicationContext(), latestJSBundleFile, false);
            } else {
                latestJSBundleLoader = JSBundleLoader.createFileLoader(latestJSBundleFile);
            }

            ReactHost reactHost = resolveReactHost();
            if (reactHost == null) {
                CodePushUtils.log("Unable to resolve ReactHost");
                // Bridge, Old Architecture
                setJSBundleLoaderBridge(latestJSBundleLoader);
                return;
            }

            // Bridgeless (RN >= 0.74)
            setJSBundleLoaderBridgeless(reactHost, latestJSBundleLoader);
        } catch (Exception e) {
            CodePushUtils.log("Unable to set JSBundle - CodePush may not support this version of React Native");
            throw new IllegalAccessException("Could not setJSBundle");
        }
    }

    private void setJSBundleLoaderBridge(JSBundleLoader latestJSBundleLoader) throws NoSuchFieldException, IllegalAccessException {
        ReactDelegate reactDelegate = resolveReactDelegate();
        assert reactDelegate != null;
        ReactInstanceManager instanceManager = reactDelegate.getReactInstanceManager();
        Field bundleLoaderField = instanceManager.getClass().getDeclaredField("mBundleLoader");
        bundleLoaderField.setAccessible(true);
        bundleLoaderField.set(instanceManager, latestJSBundleLoader);
    }

    @OptIn(markerClass = UnstableReactNativeAPI.class)
    private void setJSBundleLoaderBridgeless(ReactHost reactHost, JSBundleLoader latestJSBundleLoader) throws NoSuchFieldException, IllegalAccessException {
        // RN < 0.81
        Field reactHostDelegateField = resolveDeclaredField(reactHost.getClass(), "mReactHostDelegate");
        if (reactHostDelegateField == null) {
            // RN >= 0.81
            reactHostDelegateField = resolveDeclaredField(reactHost.getClass(), "reactHostDelegate");
        }
        if (reactHostDelegateField == null) {
            throw new NoSuchFieldException("Unable to resolve ReactHostDelegate field.");
        }

        reactHostDelegateField.setAccessible(true);
        ReactHostDelegate reactHostDelegate = (ReactHostDelegate) reactHostDelegateField.get(reactHost);
        assert reactHostDelegate != null;

        // Expo ReactHost delegate keeps this mutable backing field specifically
        // so integrations can override the bundle loader at runtime.
        Field jsBundleLoaderField = resolveDeclaredField(reactHostDelegate.getClass(), "_jsBundleLoader");
        if (jsBundleLoaderField == null) {
            // Fallback for non-Expo delegates.
            jsBundleLoaderField = resolveDeclaredField(reactHostDelegate.getClass(), "jsBundleLoader");
        }
        if (jsBundleLoaderField == null) {
            throw new NoSuchFieldException("Unable to resolve JSBundleLoader field.");
        }

        jsBundleLoaderField.setAccessible(true);
        jsBundleLoaderField.set(reactHostDelegate, latestJSBundleLoader);
    }

    private void loadBundle() {
        clearLifecycleEventListener();

        try {
            String latestJSBundleFile = mCodePush.getJSBundleFileInternal(mCodePush.getAssetsBundleFileName());

            // #1) Update the locally stored JS bundle file path
            setJSBundle(latestJSBundleFile);

            // #2) Get the context creation method and fire it on the UI thread (which RN enforces)
            new Handler(Looper.getMainLooper()).post(new Runnable() {
                @Override
                public void run() {
                    ReactDelegate reactDelegate = resolveReactDelegate();
                    assert reactDelegate != null;

                    resetReactRootViews(reactDelegate);

                    reactDelegate.reload();

                    mCodePush.initializeUpdateAfterRestart();
                }
            });

        } catch (Exception e) {
            // Our reflection logic failed somewhere
            // so fall back to restarting the Activity (if it exists)
            CodePushUtils.log("Failed to load the bundle, falling back to restarting the Activity (if it exists). " + e.getMessage());
            loadBundleLegacy();
        }
    }

    // Fix freezing that occurs when reloading the app (RN >= 0.77.1 Old Architecture)
    //  - "Trying to add a root view with an explicit id (11) already set.
    //     React Native uses the id field to track react tags and will overwrite this field.
    //     If that is fine, explicitly overwrite the id field to View.NO_ID before calling addRootView."
    private void resetReactRootViews(ReactDelegate reactDelegate) {
        ReactActivity currentActivity = (ReactActivity) getReactApplicationContext().getCurrentActivity();
        if (currentActivity != null) {
            ReactRootView reactRootView = reactDelegate.getReactRootView();
            if (reactRootView != null) {
                reactRootView.removeAllViews();
                reactRootView.setId(View.NO_ID);
            }
        }
    }

    private void clearLifecycleEventListener() {
        // Remove LifecycleEventListener to prevent infinite restart loop
        if (mLifecycleEventListener != null) {
            getReactApplicationContext().removeLifecycleEventListener(mLifecycleEventListener);
            mLifecycleEventListener = null;
        }
    }

    private ReactDelegate resolveReactDelegate() {
        ReactActivity currentActivity = (ReactActivity) getReactApplicationContext().getCurrentActivity();
        if (currentActivity == null) {
            return null;
        }

        return currentActivity.getReactDelegate();
    }

    private ReactHost resolveReactHost() {
        ReactDelegate reactDelegate = resolveReactDelegate();
        if (reactDelegate == null) {
            return null;
        }

        return reactDelegate.getReactHost();
    }

    private Field resolveDeclaredField(Class<?> targetClass, String fieldName) {
        Class<?> cursor = targetClass;
        while (cursor != null) {
            try {
                return cursor.getDeclaredField(fieldName);
            } catch (NoSuchFieldException ignored) {
                cursor = cursor.getSuperclass();
            }
        }
        return null;
    }

    private void executeInBackground(Runnable runnable) {
        mBackgroundExecutor.execute(runnable);
    }

    private void emitDownloadProgressEvent(DownloadProgress downloadProgress) {
        if (mEventEmitterCallback != null) {
            emitOnDownloadProgress(downloadProgress.createWritableMap());
            return;
        }

        getReactApplicationContext()
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                .emit(CodePushConstants.DOWNLOAD_PROGRESS_EVENT_NAME, downloadProgress.createWritableMap());
    }

    private void restartAppInternal(boolean onlyIfUpdateIsPending) {
        if (this._restartInProgress) {
            CodePushUtils.log("Restart request queued until the current restart is completed");
            this._restartQueue.add(onlyIfUpdateIsPending);
            return;
        } else if (!this._allowed) {
            CodePushUtils.log("Restart request queued until restarts are re-allowed");
            this._restartQueue.add(onlyIfUpdateIsPending);
            return;
        }

        this._restartInProgress = true;
        if (!onlyIfUpdateIsPending || mSettingsManager.isPendingUpdate(null)) {
            loadBundle();
            CodePushUtils.log("Restarting app");
            return;
        }

        this._restartInProgress = false;
        if (this._restartQueue.size() > 0) {
            boolean buf = this._restartQueue.get(0);
            this._restartQueue.remove(0);
            this.restartAppInternal(buf);
        }
    }

    @ReactMethod
    public void allow() {
        CodePushUtils.log("Re-allowing restarts");
        this._allowed = true;

        if (_restartQueue.size() > 0) {
            CodePushUtils.log("Executing pending restart");
            boolean buf = this._restartQueue.get(0);
            this._restartQueue.remove(0);
            this.restartAppInternal(buf);
        }
    }

    @ReactMethod
    public void clearPendingRestart() {
        this._restartQueue.clear();
    }

    @ReactMethod
    public void disallow() {
        CodePushUtils.log("Disallowing restarts");
        this._allowed = false;
    }

    @ReactMethod
    public void restartApp(boolean onlyIfUpdateIsPending) {
        restartAppInternal(onlyIfUpdateIsPending);
    }

    @ReactMethod
    public void downloadUpdate(final ReadableMap updatePackage, final boolean notifyProgress, final Promise promise) {
        executeInBackground(new Runnable() {
            @Override
            public void run() {
                try {
                    JSONObject mutableUpdatePackage = CodePushUtils.convertReadableToJsonObject(updatePackage);
                    mUpdateManager.downloadPackage(mutableUpdatePackage, mCodePush.getAssetsBundleFileName(), new DownloadProgressCallback() {
                        private boolean hasScheduledNextFrame = false;
                        private DownloadProgress latestDownloadProgress = null;

                        @Override
                        public void call(DownloadProgress downloadProgress) {
                            if (!notifyProgress) {
                                return;
                            }

                            latestDownloadProgress = downloadProgress;
                            if (latestDownloadProgress.isCompleted()) {
                                dispatchDownloadProgressEvent();
                                return;
                            }

                            if (hasScheduledNextFrame) {
                                return;
                            }

                            hasScheduledNextFrame = true;
                            getReactApplicationContext().runOnUiQueueThread(new Runnable() {
                                @Override
                                public void run() {
                                    ReactChoreographer.getInstance().postFrameCallback(
                                            ReactChoreographer.CallbackType.TIMERS_EVENTS,
                                            new Choreographer.FrameCallback() {
                                                @Override
                                                public void doFrame(long frameTimeNanos) {
                                                    if (!latestDownloadProgress.isCompleted()) {
                                                        dispatchDownloadProgressEvent();
                                                    }

                                                    hasScheduledNextFrame = false;
                                                }
                                            }
                                    );
                                }
                            });
                        }

                        public void dispatchDownloadProgressEvent() {
                            emitDownloadProgressEvent(latestDownloadProgress);
                        }
                    });

                    JSONObject newPackage = mUpdateManager.getPackage(CodePushUtils.tryGetString(updatePackage, CodePushConstants.PACKAGE_HASH_KEY));
                    promise.resolve(CodePushUtils.convertJsonObjectToWritable(newPackage));
                } catch (CodePushInvalidUpdateException e) {
                    CodePushUtils.log(e);
                    mSettingsManager.saveFailedUpdate(CodePushUtils.convertReadableToJsonObject(updatePackage));
                    promise.reject(e);
                } catch (IOException | CodePushUnknownException e) {
                    CodePushUtils.log(e);
                    promise.reject(e);
                }
            }
        });
    }

    @ReactMethod
    public void getConfiguration(Promise promise) {
        try {
            WritableMap configMap =  Arguments.createMap();
            configMap.putString("appVersion", mCodePush.getAppVersion());
            configMap.putString("clientUniqueId", mClientUniqueId);
            configMap.putString("deploymentKey", mCodePush.getDeploymentKey());
            configMap.putString("serverUrl", mCodePush.getServerUrl());

            // The binary hash may be null in debug builds
            if (mBinaryContentsHash != null) {
                configMap.putString(CodePushConstants.PACKAGE_HASH_KEY, mBinaryContentsHash);
            }

            promise.resolve(configMap);
        } catch(CodePushUnknownException e) {
            CodePushUtils.log(e);
            promise.reject(e);
        }
    }

    @ReactMethod
    public void getUpdateMetadata(final double updateStateValue, final Promise promise) {
        executeInBackground(new Runnable() {
            @Override
            public void run() {
                try {
                    int updateState = (int) updateStateValue;
                    JSONObject currentPackage = mUpdateManager.getCurrentPackage();

                    if (currentPackage == null) {
                        promise.resolve(null);
                        return;
                    }

                    Boolean currentUpdateIsPending = false;

                    if (currentPackage.has(CodePushConstants.PACKAGE_HASH_KEY)) {
                        String currentHash = currentPackage.optString(CodePushConstants.PACKAGE_HASH_KEY, null);
                        currentUpdateIsPending = mSettingsManager.isPendingUpdate(currentHash);
                    }

                    if (updateState == CodePushUpdateState.PENDING.getValue() && !currentUpdateIsPending) {
                        promise.resolve(null);
                    } else if (updateState == CodePushUpdateState.RUNNING.getValue() && currentUpdateIsPending) {
                        JSONObject previousPackage = mUpdateManager.getPreviousPackage();

                        if (previousPackage == null) {
                            promise.resolve(null);
                            return;
                        }

                        promise.resolve(CodePushUtils.convertJsonObjectToWritable(previousPackage));
                    } else {
                        if (mCodePush.isRunningBinaryVersion()) {
                            CodePushUtils.setJSONValueForKey(currentPackage, "_isDebugOnly", true);
                        }

                        CodePushUtils.setJSONValueForKey(currentPackage, "isPending", currentUpdateIsPending);
                        promise.resolve(CodePushUtils.convertJsonObjectToWritable(currentPackage));
                    }
                } catch (CodePushMalformedDataException e) {
                    CodePushUtils.log(e.getMessage());
                    clearUpdates();
                    promise.resolve(null);
                } catch(CodePushUnknownException e) {
                    CodePushUtils.log(e);
                    promise.reject(e);
                }
            }
        });
    }

    @ReactMethod
    public void getNewStatusReport(final Promise promise) {
        executeInBackground(new Runnable() {
            @Override
            public void run() {
                try {
                    if (mCodePush.needToReportRollback()) {
                        mCodePush.setNeedToReportRollback(false);
                        JSONArray failedUpdates = mSettingsManager.getFailedUpdates();
                        if (failedUpdates != null && failedUpdates.length() > 0) {
                            try {
                                JSONObject lastFailedPackageJSON = failedUpdates.getJSONObject(failedUpdates.length() - 1);
                                WritableMap lastFailedPackage = CodePushUtils.convertJsonObjectToWritable(lastFailedPackageJSON);
                                WritableMap failedStatusReport = mTelemetryManager.getRollbackReport(lastFailedPackage);
                                if (failedStatusReport != null) {
                                    promise.resolve(failedStatusReport);
                                    return;
                                }
                            } catch (JSONException e) {
                                throw new CodePushUnknownException("Unable to read failed updates information stored in SharedPreferences.", e);
                            }
                        }
                    } else if (mCodePush.didUpdate()) {
                        JSONObject currentPackage = mUpdateManager.getCurrentPackage();
                        if (currentPackage != null) {
                            WritableMap newPackageStatusReport = mTelemetryManager.getUpdateReport(CodePushUtils.convertJsonObjectToWritable(currentPackage));
                            if (newPackageStatusReport != null) {
                                promise.resolve(newPackageStatusReport);
                                return;
                            }
                        }
                    } else if (mCodePush.isRunningBinaryVersion()) {
                        WritableMap newAppVersionStatusReport = mTelemetryManager.getBinaryUpdateReport(mCodePush.getAppVersion());
                        if (newAppVersionStatusReport != null) {
                            promise.resolve(newAppVersionStatusReport);
                            return;
                        }
                    } else {
                        WritableMap retryStatusReport = mTelemetryManager.getRetryStatusReport();
                        if (retryStatusReport != null) {
                            promise.resolve(retryStatusReport);
                            return;
                        }
                    }

                    promise.resolve(null);
                } catch(CodePushUnknownException e) {
                    CodePushUtils.log(e);
                    promise.reject(e);
                }
            }
        });
    }

    @ReactMethod
    public void installUpdate(final ReadableMap updatePackage, final double installModeValue, final double minimumBackgroundDurationValue, final Promise promise) {
        executeInBackground(new Runnable() {
            @Override
            public void run() {
                try {
                    int installMode = (int) installModeValue;
                    int minimumBackgroundDuration = (int) minimumBackgroundDurationValue;
                    mUpdateManager.installPackage(CodePushUtils.convertReadableToJsonObject(updatePackage), mSettingsManager.isPendingUpdate(null));

                    String pendingHash = CodePushUtils.tryGetString(updatePackage, CodePushConstants.PACKAGE_HASH_KEY);
                    if (pendingHash == null) {
                        throw new CodePushUnknownException("Update package to be installed has no hash.");
                    } else {
                        mSettingsManager.savePendingUpdate(pendingHash, /* isLoading */false);
                    }

                    if (installMode == CodePushInstallMode.ON_NEXT_RESUME.getValue()
                            || installMode == CodePushInstallMode.IMMEDIATE.getValue()
                            || installMode == CodePushInstallMode.ON_NEXT_SUSPEND.getValue()) {
                        CodePushNativeModule.this.mMinimumBackgroundDuration = minimumBackgroundDuration;

                        if (mLifecycleEventListener == null) {
                            mLifecycleEventListener = new LifecycleEventListener() {
                                private Date lastPausedDate = null;
                                private Handler appSuspendHandler = new Handler(Looper.getMainLooper());
                                private Runnable loadBundleRunnable = new Runnable() {
                                    @Override
                                    public void run() {
                                        CodePushUtils.log("Loading bundle on suspend");
                                        restartAppInternal(false);
                                    }
                                };

                                @Override
                                public void onHostResume() {
                                    appSuspendHandler.removeCallbacks(loadBundleRunnable);
                                    if (lastPausedDate != null) {
                                        long durationInBackground = (new Date().getTime() - lastPausedDate.getTime()) / 1000;
                                        if (installMode == CodePushInstallMode.IMMEDIATE.getValue()
                                                || durationInBackground >= CodePushNativeModule.this.mMinimumBackgroundDuration) {
                                            CodePushUtils.log("Loading bundle on resume");
                                            restartAppInternal(false);
                                        }
                                    }
                                }

                                @Override
                                public void onHostPause() {
                                    lastPausedDate = new Date();

                                    if (installMode == CodePushInstallMode.ON_NEXT_SUSPEND.getValue() && mSettingsManager.isPendingUpdate(null)) {
                                        appSuspendHandler.postDelayed(loadBundleRunnable, minimumBackgroundDuration * 1000);
                                    }
                                }

                                @Override
                                public void onHostDestroy() {
                                }
                            };

                            getReactApplicationContext().addLifecycleEventListener(mLifecycleEventListener);
                        }
                    }

                    promise.resolve(null);
                } catch(CodePushUnknownException e) {
                    CodePushUtils.log(e);
                    promise.reject(e);
                }
            }
        });
    }

    @ReactMethod
    public void isFailedUpdate(String packageHash, Promise promise) {
        try {
            promise.resolve(mSettingsManager.isFailedHash(packageHash));
        } catch (CodePushUnknownException e) {
            CodePushUtils.log(e);
            promise.reject(e);
        }
    }

    @ReactMethod
    public void getLatestRollbackInfo(Promise promise) {
        try {
            JSONObject latestRollbackInfo = mSettingsManager.getLatestRollbackInfo();
            if (latestRollbackInfo != null) {
                promise.resolve(CodePushUtils.convertJsonObjectToWritable(latestRollbackInfo));
            } else {
                promise.resolve(null);
            }
        } catch (CodePushUnknownException e) {
            CodePushUtils.log(e);
            promise.reject(e);
        }
    }

    @ReactMethod
    public void setLatestRollbackInfo(String packageHash, Promise promise) {
        try {
            mSettingsManager.setLatestRollbackInfo(packageHash);
            promise.resolve(null);
        } catch (CodePushUnknownException e) {
            CodePushUtils.log(e);
            promise.reject(e);
        }
    }

    @ReactMethod
    public void isFirstRun(String packageHash, Promise promise) {
        try {
            boolean isFirstRun = mCodePush.didUpdate()
                    && packageHash != null
                    && packageHash.length() > 0
                    && packageHash.equals(mUpdateManager.getCurrentPackageHash());
            promise.resolve(isFirstRun);
        } catch(CodePushUnknownException e) {
            CodePushUtils.log(e);
            promise.reject(e);
        }
    }

    @ReactMethod
    public void notifyApplicationReady(Promise promise) {
        try {
            mSettingsManager.removePendingUpdate();
            promise.resolve(null);
        } catch(CodePushUnknownException e) {
            CodePushUtils.log(e);
            promise.reject(e);
        }
    }

    @ReactMethod
    public void recordStatusReported(ReadableMap statusReport) {
        try {
            mTelemetryManager.recordStatusReported(statusReport);
        } catch(CodePushUnknownException e) {
            CodePushUtils.log(e);
        }
    }

    @ReactMethod
    public void saveStatusReportForRetry(ReadableMap statusReport) {
        try {
            mTelemetryManager.saveStatusReportForRetry(statusReport);
        } catch(CodePushUnknownException e) {
            CodePushUtils.log(e);
        }
    }

    @ReactMethod
    // Replaces the current bundle with the one downloaded from removeBundleUrl.
    // It is only to be used during tests. No-ops if the test configuration flag is not set.
    public void downloadAndReplaceCurrentBundle(String remoteBundleUrl) {
        try {
            if (mCodePush.isUsingTestConfiguration()) {
                try {
                    mUpdateManager.downloadAndReplaceCurrentBundle(remoteBundleUrl, mCodePush.getAssetsBundleFileName());
                } catch (IOException e) {
                    throw new CodePushUnknownException("Unable to replace current bundle", e);
                }
            }
        } catch(CodePushUnknownException | CodePushMalformedDataException e) {
            CodePushUtils.log(e);
        }
    }

    /**
     * This method clears CodePush's downloaded updates.
     * It is needed to switch to a different deployment if the current deployment is more recent.
     * Note: we don’t recommend to use this method in scenarios other than that (CodePush will call
     * this method automatically when needed in other cases) as it could lead to unpredictable
     * behavior.
     */
    @ReactMethod
    public void clearUpdates() {
        CodePushUtils.log("Clearing updates.");
        mCodePush.clearUpdates();
    }

    @ReactMethod
    public void addListener(String eventName) {
        // Set up any upstream listeners or background tasks as necessary
    }

    @ReactMethod
    public void removeListeners(Integer count) {
        // Remove upstream listeners, stop unnecessary background tasks
    }
}
