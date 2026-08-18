package com.microsoft.codepush.react;

public class CodePushConstants {
    public static final String ASSETS_BUNDLE_PREFIX = "assets://";
    // The binary patch values below are the client half of the contract the CLI writes
    // into a patch archive. The CLI is TypeScript, so its constants cannot be imported
    // here: any change to the manifest it produces has to be repeated in this file.
    public static final String BINARY_PATCH_ALGORITHM = "hdiffpatch-m-zstd";
    public static final String BINARY_PATCH_ALGORITHM_KEY = "algorithm";
    public static final String BINARY_PATCH_BASE_BUNDLE_HASH_KEY = "baseBundleHash";
    public static final String BINARY_PATCH_BUNDLE_PATH_KEY = "bundlePath";
    public static final String BINARY_PATCH_DOWNLOAD_URL_KEY = "binaryPatchDownloadUrl";
    public static final String BINARY_PATCH_FILE_KEY = "patchFile";
    public static final String BINARY_PATCH_FOLDER_NAME = "binary-patch";
    public static final int BINARY_PATCH_FORMAT_VERSION = 1;
    public static final String BINARY_PATCH_FORMAT_VERSION_KEY = "formatVersion";
    public static final String BINARY_PATCH_MANIFEST_FILE_NAME = "codepush-binary-patch.json";
    // A manifest asking for a bundle larger than this is treated as malformed rather than
    // as a reason to reserve that much memory and disk. A large Hermes bundle stays under
    // 50 MB, and a release that somehow exceeds the bound still installs from its full
    // archive, so the headroom below is generous enough for the limit to only ever catch
    // a manifest that is wrong. The other platform's applier holds the same value.
    public static final long BINARY_PATCH_MAX_TARGET_BUNDLE_SIZE = 128L * 1024 * 1024;
    // Not part of the CLI's contract: the field a download that tried a patch reports its
    // outcome under, on the package it resolves with and on no package it stores.
    public static final String BINARY_PATCH_RESULT_KEY = "binaryPatchResult";
    public static final String BINARY_PATCH_TARGET_BUNDLE_HASH_KEY = "targetBundleHash";
    public static final String BINARY_PATCH_TARGET_BUNDLE_SIZE_KEY = "targetBundleSize";
    public static final String BINARY_PATCH_TARGET_FILE_NAME = "target.bundle";
    public static final String CODE_PUSH_FOLDER_PREFIX = "CodePush";
    public static final String CODE_PUSH_HASH_FILE_NAME = "CodePushHash";
    public static final String CODE_PUSH_OLD_HASH_FILE_NAME = "CodePushHash.json";
    public static final String CODE_PUSH_PREFERENCES = "CodePush";
    public static final String CURRENT_PACKAGE_KEY = "currentPackage";
    public static final String DEFAULT_JS_BUNDLE_NAME = "index.android.bundle";
    public static final String DIFF_MANIFEST_FILE_NAME = "hotcodepush.json";
    public static final int DOWNLOAD_BUFFER_SIZE = 1024 * 256;
    public static final String DOWNLOAD_FILE_NAME = "download.zip";
    public static final String DOWNLOAD_PROGRESS_EVENT_NAME = "CodePushDownloadProgress";
    public static final String DOWNLOAD_URL_KEY = "downloadUrl";
    public static final String FAILED_UPDATES_KEY = "CODE_PUSH_FAILED_UPDATES";
    public static final String PACKAGE_FILE_NAME = "app.json";
    public static final String PACKAGE_HASH_KEY = "packageHash";
    public static final String PENDING_UPDATE_HASH_KEY = "hash";
    public static final String PENDING_UPDATE_IS_LOADING_KEY = "isLoading";
    public static final String PENDING_UPDATE_KEY = "CODE_PUSH_PENDING_UPDATE";
    public static final String PREVIOUS_PACKAGE_KEY = "previousPackage";
    public static final String REACT_NATIVE_LOG_TAG = "ReactNative";
    public static final String RELATIVE_BUNDLE_PATH_KEY = "bundlePath";
    public static final String STATUS_FILE = "codepush.json";
    public static final String UNZIPPED_FOLDER_NAME = "unzipped";
    public static final String LATEST_ROLLBACK_INFO_KEY = "LATEST_ROLLBACK_INFO";
    public static final String LATEST_ROLLBACK_PACKAGE_HASH_KEY = "packageHash";
    public static final String LATEST_ROLLBACK_TIME_KEY = "time";
    public static final String LATEST_ROLLBACK_COUNT_KEY = "count";
    public static final String CLIENT_UNIQUE_ID_KEY = "clientUniqueId";
}
