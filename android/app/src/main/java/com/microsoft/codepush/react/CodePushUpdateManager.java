package com.microsoft.codepush.react;

import android.content.Context;
import android.os.Build;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.MalformedURLException;
import java.net.URL;
import java.nio.ByteBuffer;

import javax.net.ssl.HttpsURLConnection;

public class CodePushUpdateManager {

    private String mDocumentsDirectory;
    private final CodePushBinaryPatch mBinaryPatch;

    public CodePushUpdateManager(String documentsDirectory, Context context) {
        this(documentsDirectory, new CodePushBinaryPatch(new AssetsBaseBundleProvider(context), new HDiffPatchNative()));
    }

    CodePushUpdateManager(String documentsDirectory, CodePushBinaryPatch binaryPatch) {
        mDocumentsDirectory = documentsDirectory;
        mBinaryPatch = binaryPatch;
    }

    private String getDownloadFilePath() {
        return CodePushUtils.appendPathComponent(getCodePushPath(), CodePushConstants.DOWNLOAD_FILE_NAME);
    }

    private String getUnzippedFolderPath() {
        return CodePushUtils.appendPathComponent(getCodePushPath(), CodePushConstants.UNZIPPED_FOLDER_NAME);
    }

    private String getBinaryPatchFolderPath() {
        return CodePushUtils.appendPathComponent(getCodePushPath(), CodePushConstants.BINARY_PATCH_FOLDER_NAME);
    }

    private String getDocumentsDirectory() {
        return mDocumentsDirectory;
    }

    private String getCodePushPath() {
        String codePushPath = CodePushUtils.appendPathComponent(getDocumentsDirectory(), CodePushConstants.CODE_PUSH_FOLDER_PREFIX);
        if (CodePush.isUsingTestConfiguration()) {
            codePushPath = CodePushUtils.appendPathComponent(codePushPath, "TestPackages");
        }

        return codePushPath;
    }

    private String getStatusFilePath() {
        return CodePushUtils.appendPathComponent(getCodePushPath(), CodePushConstants.STATUS_FILE);
    }

    public JSONObject getCurrentPackageInfo() {
        String statusFilePath = getStatusFilePath();
        if (!FileUtils.fileAtPathExists(statusFilePath)) {
            return new JSONObject();
        }

        try {
            return CodePushUtils.getJsonObjectFromFile(statusFilePath);
        } catch (IOException e) {
            // Should not happen.
            throw new CodePushUnknownException("Error getting current package info", e);
        }
    }

    public void updateCurrentPackageInfo(JSONObject packageInfo) {
        try {
            CodePushUtils.writeJsonToFile(packageInfo, getStatusFilePath());
        } catch (IOException e) {
            // Should not happen.
            throw new CodePushUnknownException("Error updating current package info", e);
        }
    }

    public String getCurrentPackageFolderPath() {
        JSONObject info = getCurrentPackageInfo();
        String packageHash = info.optString(CodePushConstants.CURRENT_PACKAGE_KEY, null);
        if (packageHash == null) {
            return null;
        }

        return getPackageFolderPath(packageHash);
    }

    public String getCurrentPackageBundlePath(String bundleFileName) {
        String packageFolder = getCurrentPackageFolderPath();
        if (packageFolder == null) {
            return null;
        }

        JSONObject currentPackage = getCurrentPackage();
        if (currentPackage == null) {
            return null;
        }

        String relativeBundlePath = currentPackage.optString(CodePushConstants.RELATIVE_BUNDLE_PATH_KEY, null);
        if (relativeBundlePath == null) {
            return CodePushUtils.appendPathComponent(packageFolder, bundleFileName);
        } else {
            return CodePushUtils.appendPathComponent(packageFolder, relativeBundlePath);
        }
    }

    public String getPackageFolderPath(String packageHash) {
        return CodePushUtils.appendPathComponent(getCodePushPath(), packageHash);
    }

    public String getCurrentPackageHash() {
        JSONObject info = getCurrentPackageInfo();
        return info.optString(CodePushConstants.CURRENT_PACKAGE_KEY, null);
    }

    public String getPreviousPackageHash() {
        JSONObject info = getCurrentPackageInfo();
        return info.optString(CodePushConstants.PREVIOUS_PACKAGE_KEY, null);
    }

    public JSONObject getCurrentPackage() {
        String packageHash = getCurrentPackageHash();
        if (packageHash == null) {
            return null;
        }

        return getPackage(packageHash);
    }

    public JSONObject getPreviousPackage() {
        String packageHash = getPreviousPackageHash();
        if (packageHash == null) {
            return null;
        }

        return getPackage(packageHash);
    }

    public JSONObject getPackage(String packageHash) {
        String folderPath = getPackageFolderPath(packageHash);
        String packageFilePath = CodePushUtils.appendPathComponent(folderPath, CodePushConstants.PACKAGE_FILE_NAME);
        try {
            return CodePushUtils.getJsonObjectFromFile(packageFilePath);
        } catch (IOException e) {
            return null;
        }
    }

    /**
     * @return what the attempt at installing the update from its binary patch archive ended
     *         in, or null when the update had no patch archive to attempt. The result belongs
     *         to this download alone: the metadata written for the update never carries it.
     */
    public JSONObject downloadPackage(JSONObject updatePackage, String expectedBundleFileName,
                                      DownloadProgressCallback progressCallback) throws IOException {
        // A release that was published with a binary patch offers two archives of the same
        // update. The patch is worth trying because it is a fraction of the size, and the
        // full archive is always there when it does not work out.
        String binaryPatchDownloadUrl = updatePackage.optString(CodePushConstants.BINARY_PATCH_DOWNLOAD_URL_KEY, null);
        BinaryPatchAttempt patchAttempt = null;
        if (binaryPatchDownloadUrl != null) {
            patchAttempt = new BinaryPatchAttempt();
            if (tryDownloadBinaryPatchPackage(updatePackage, expectedBundleFileName, progressCallback,
                    binaryPatchDownloadUrl, patchAttempt)) {
                return patchAttempt.result();
            }
        }

        downloadAndInstallPackage(updatePackage, expectedBundleFileName, progressCallback,
                updatePackage.optString(CodePushConstants.DOWNLOAD_URL_KEY, null), false, null);

        return patchAttempt == null ? null : patchAttempt.result();
    }

    /**
     * Installs the update from its binary patch archive.
     *
     * Every way this can fail ends the same way, with the update being downloaded in full
     * instead, so none of them is reported to the caller as an error. The fallback happens
     * exactly once without anything having to count it: the full archive is downloaded by
     * a call that is not allowed to take the patch path, so it has no failure of its own to
     * fall back from.
     *
     * @param patchAttempt records what the attempt ended in, for the caller to hand to
     *                     whoever asked for the download
     * @return true when the update was installed, false when the caller has to download the
     *         full archive instead
     */
    private boolean tryDownloadBinaryPatchPackage(JSONObject updatePackage, String expectedBundleFileName,
                                                  DownloadProgressCallback progressCallback,
                                                  String binaryPatchDownloadUrl, BinaryPatchAttempt patchAttempt) {
        try {
            BinaryPatchResult patchResult = downloadAndInstallPackage(updatePackage, expectedBundleFileName,
                    progressCallback, binaryPatchDownloadUrl, true, patchAttempt);
            if (patchResult.succeeded()) {
                return true;
            }

            patchAttempt.recordFallback(patchResult.getFailureReason());
            CodePushUtils.log("Binary patch update failed (" + patchResult.getFailureReason()
                    + "). Downloading the full update instead.");
        } catch (Exception | OutOfMemoryError e) {
            // Applying a patch is the one path that holds a whole bundle in memory, so
            // running out of it is a failure this has to absorb like any other: by the time
            // it lands here the arrays are unreachable, and the full archive is downloaded
            // to disk in chunks rather than held.
            patchAttempt.recordFallbackAfterError();
            CodePushUtils.log(e);
            CodePushUtils.log("The binary patch update could not be completed. Downloading the full update instead.");
        } finally {
            FileUtils.deleteDirectoryAtPath(getBinaryPatchFolderPath());
        }

        return false;
    }

    /**
     * Downloads an update from one of its archives and installs it.
     *
     * @param isBinaryPatchUpdate whether the archive holds a binary patch of the JS bundle,
     *                            which has to be applied before the contents are the update.
     *                            Only an archive downloaded from the binary patch URL is
     *                            treated that way, so an update being downloaded in full can
     *                            never end up on the patch path.
     * @param patchAttempt the record the patch is timed into, or null for a full download,
     *                     which has no patch to time
     * @return the outcome of the patch: a failed result means the update was not installed
     *         and the caller has to fall back to the full archive. Downloading the full
     *         archive always succeeds or throws.
     */
    BinaryPatchResult downloadAndInstallPackage(JSONObject updatePackage, String expectedBundleFileName,
                                                DownloadProgressCallback progressCallback,
                                                String downloadUrlString, boolean isBinaryPatchUpdate,
                                                BinaryPatchAttempt patchAttempt) throws IOException {
        String newUpdateHash = updatePackage.optString(CodePushConstants.PACKAGE_HASH_KEY, null);
        String newUpdateFolderPath = getPackageFolderPath(newUpdateHash);
        String newUpdateMetadataPath = CodePushUtils.appendPathComponent(newUpdateFolderPath, CodePushConstants.PACKAGE_FILE_NAME);
        if (FileUtils.fileAtPathExists(newUpdateFolderPath)) {
            // This removes any stale data in newPackageFolderPath that could have been left
            // uncleared due to a crash or error during the download or install process.
            FileUtils.deleteDirectoryAtPath(newUpdateFolderPath);
        }

        HttpURLConnection connection = null;
        BufferedInputStream bin = null;
        FileOutputStream fos = null;
        BufferedOutputStream bout = null;
        File downloadFile = null;
        boolean isZip = false;

        // Download the file while checking if it is a zip and notifying client of progress.
        try {
            URL downloadUrl = new URL(downloadUrlString);
            connection = (HttpURLConnection) (downloadUrl.openConnection());

            if (android.os.Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP &&
                downloadUrl.toString().startsWith("https")) {
                try {
                    ((HttpsURLConnection)connection).setSSLSocketFactory(new TLSSocketFactory());
                } catch (Exception e) {
                    throw new CodePushUnknownException("Error set SSLSocketFactory. ", e);
                }
            }

            connection.setRequestProperty("Accept-Encoding", "identity");
            bin = new BufferedInputStream(connection.getInputStream());

            long totalBytes = connection.getContentLength();
            long receivedBytes = 0;

            File downloadFolder = new File(getCodePushPath());
            downloadFolder.mkdirs();
            downloadFile = new File(downloadFolder, CodePushConstants.DOWNLOAD_FILE_NAME);
            fos = new FileOutputStream(downloadFile);
            bout = new BufferedOutputStream(fos, CodePushConstants.DOWNLOAD_BUFFER_SIZE);
            byte[] data = new byte[CodePushConstants.DOWNLOAD_BUFFER_SIZE];
            byte[] header = new byte[4];

            int numBytesRead = 0;
            while ((numBytesRead = bin.read(data, 0, CodePushConstants.DOWNLOAD_BUFFER_SIZE)) >= 0) {
                if (receivedBytes < 4) {
                    for (int i = 0; i < numBytesRead; i++) {
                        int headerOffset = (int) (receivedBytes) + i;
                        if (headerOffset >= 4) {
                            break;
                        }

                        header[headerOffset] = data[i];
                    }
                }

                receivedBytes += numBytesRead;
                bout.write(data, 0, numBytesRead);
                progressCallback.call(new DownloadProgress(totalBytes, receivedBytes));
            }

            if (totalBytes != receivedBytes) {
                throw new CodePushUnknownException("Received " + receivedBytes + " bytes, expected " + totalBytes);
            }

            isZip = ByteBuffer.wrap(header).getInt() == 0x504b0304;
        } catch (MalformedURLException e) {
            throw new CodePushMalformedDataException(downloadUrlString, e);
        } finally {
            try {
                if (bout != null) bout.close();
                if (fos != null) fos.close();
                if (bin != null) bin.close();
                if (connection != null) connection.disconnect();
            } catch (IOException e) {
                throw new CodePushUnknownException("Error closing IO resources.", e);
            }
        }

        if (isZip) {
            // Unzip the downloaded file and then delete the zip
            String unzippedFolderPath = getUnzippedFolderPath();
            FileUtils.unzipFile(downloadFile, unzippedFolderPath);
            FileUtils.deleteFileOrFolderSilently(downloadFile);

            // Rebuild the JS bundle the archive only carries a patch of, which leaves the
            // contents identical to the ones the full archive would have delivered.
            if (isBinaryPatchUpdate) {
                long patchStartTime = System.currentTimeMillis();
                BinaryPatchResult patchResult = mBinaryPatch.restoreBundle(unzippedFolderPath,
                        getBinaryPatchFolderPath(), expectedBundleFileName);
                if (!patchResult.succeeded()) {
                    return patchResult;
                }

                long applyDurationMs = System.currentTimeMillis() - patchStartTime;
                patchAttempt.recordBundleRestored(applyDurationMs);
                CodePushUtils.log("Restored the update from its binary patch in " + applyDurationMs + " ms.");
            }

            // Merge contents with current update based on the manifest
            String diffManifestFilePath = CodePushUtils.appendPathComponent(unzippedFolderPath,
                    CodePushConstants.DIFF_MANIFEST_FILE_NAME);
            boolean isDiffUpdate = FileUtils.fileAtPathExists(diffManifestFilePath);
            if (isDiffUpdate) {
                String currentPackageFolderPath = getCurrentPackageFolderPath();
                CodePushUpdateUtils.copyNecessaryFilesFromCurrentPackage(diffManifestFilePath, currentPackageFolderPath, newUpdateFolderPath);
                File diffManifestFile = new File(diffManifestFilePath);
                diffManifestFile.delete();
            }

            FileUtils.copyDirectoryContents(unzippedFolderPath, newUpdateFolderPath);
            FileUtils.deleteFileAtPathSilently(unzippedFolderPath);

            // For zip updates, we need to find the relative path to the jsBundle and save it in the
            // metadata so that we can find and run it easily the next time.
            String relativeBundlePath = CodePushUpdateUtils.findJSBundleInUpdateContents(newUpdateFolderPath, expectedBundleFileName);

            if (relativeBundlePath == null) {
                throw new CodePushInvalidUpdateException("Update is invalid - A JS bundle file named \"" + expectedBundleFileName + "\" could not be found within the downloaded contents. Please check that you are releasing your CodePush updates using the exact same JS bundle file name that was shipped with your app's binary.");
            } else {
                if (FileUtils.fileAtPathExists(newUpdateMetadataPath)) {
                    File metadataFileFromOldUpdate = new File(newUpdateMetadataPath);
                    metadataFileFromOldUpdate.delete();
                }

                if (isDiffUpdate) {
                    CodePushUtils.log("Applying diff update.");
                } else {
                    CodePushUtils.log("Applying full update.");
                }

                CodePushUpdateUtils.verifyFolderHash(newUpdateFolderPath, newUpdateHash);
                CodePushUtils.setJSONValueForKey(updatePackage, CodePushConstants.RELATIVE_BUNDLE_PATH_KEY, relativeBundlePath);
            }
        } else {
            if (isBinaryPatchUpdate) {
                // Whatever the patch URL served, it is not a patch archive - an error page
                // answered with a 200 looks like this too. Moving it into place would
                // install bytes no hash has ever been checked against, so the full archive
                // is downloaded instead.
                return BinaryPatchResult.failure(BinaryPatchResult.REASON_INVALID_MANIFEST);
            }

            // File is a jsbundle, move it to a folder with the packageHash as its name
            FileUtils.moveFile(downloadFile, newUpdateFolderPath, expectedBundleFileName);
        }

        // Save metadata to the folder.
        CodePushUtils.writeJsonToFile(updatePackage, newUpdateMetadataPath);

        return BinaryPatchResult.success();
    }

    public void installPackage(JSONObject updatePackage, boolean removePendingUpdate) {
        String packageHash = updatePackage.optString(CodePushConstants.PACKAGE_HASH_KEY, null);
        JSONObject info = getCurrentPackageInfo();

        String currentPackageHash = info.optString(CodePushConstants.CURRENT_PACKAGE_KEY, null);
        if (packageHash != null && packageHash.equals(currentPackageHash)) {
            // The current package is already the one being installed, so we should no-op.
            return;
        }

        if (removePendingUpdate) {
            String currentPackageFolderPath = getCurrentPackageFolderPath();
            if (currentPackageFolderPath != null) {
                FileUtils.deleteDirectoryAtPath(currentPackageFolderPath);
            }
        } else {
            String previousPackageHash = getPreviousPackageHash();
            if (previousPackageHash != null && !previousPackageHash.equals(packageHash)) {
                FileUtils.deleteDirectoryAtPath(getPackageFolderPath(previousPackageHash));
            }

            CodePushUtils.setJSONValueForKey(info, CodePushConstants.PREVIOUS_PACKAGE_KEY, info.optString(CodePushConstants.CURRENT_PACKAGE_KEY, null));
        }

        CodePushUtils.setJSONValueForKey(info, CodePushConstants.CURRENT_PACKAGE_KEY, packageHash);
        updateCurrentPackageInfo(info);
    }

    public void rollbackPackage() {
        JSONObject info = getCurrentPackageInfo();
        String currentPackageFolderPath = getCurrentPackageFolderPath();
        FileUtils.deleteDirectoryAtPath(currentPackageFolderPath);
        CodePushUtils.setJSONValueForKey(info, CodePushConstants.CURRENT_PACKAGE_KEY, info.optString(CodePushConstants.PREVIOUS_PACKAGE_KEY, null));
        CodePushUtils.setJSONValueForKey(info, CodePushConstants.PREVIOUS_PACKAGE_KEY, null);
        updateCurrentPackageInfo(info);
    }

    public void downloadAndReplaceCurrentBundle(String remoteBundleUrl, String bundleFileName) throws IOException {
        URL downloadUrl;
        HttpURLConnection connection = null;
        BufferedInputStream bin = null;
        FileOutputStream fos = null;
        BufferedOutputStream bout = null;
        try {
            downloadUrl = new URL(remoteBundleUrl);
            connection = (HttpURLConnection) (downloadUrl.openConnection());
            bin = new BufferedInputStream(connection.getInputStream());
            File downloadFile = new File(getCurrentPackageBundlePath(bundleFileName));
            downloadFile.delete();
            fos = new FileOutputStream(downloadFile);
            bout = new BufferedOutputStream(fos, CodePushConstants.DOWNLOAD_BUFFER_SIZE);
            byte[] data = new byte[CodePushConstants.DOWNLOAD_BUFFER_SIZE];
            int numBytesRead = 0;
            while ((numBytesRead = bin.read(data, 0, CodePushConstants.DOWNLOAD_BUFFER_SIZE)) >= 0) {
                bout.write(data, 0, numBytesRead);
            }
        } catch (MalformedURLException e) {
            throw new CodePushMalformedDataException(remoteBundleUrl, e);
        } finally {
            try {
                if (bout != null) bout.close();
                if (fos != null) fos.close();
                if (bin != null) bin.close();
                if (connection != null) connection.disconnect();
            } catch (IOException e) {
                throw new CodePushUnknownException("Error closing IO resources.", e);
            }
        }
    }

    public void clearUpdates() {
        FileUtils.deleteDirectoryAtPath(getCodePushPath());
    }

    /** Reads the JS bundle that shipped inside the app binary out of the APK's assets. */
    private static class AssetsBaseBundleProvider implements CodePushBinaryPatch.BaseBundleProvider {

        private final Context mContext;

        AssetsBaseBundleProvider(Context context) {
            mContext = context;
        }

        @Override
        public byte[] readBaseBundle(String bundleFileName) throws IOException {
            // The bundle is stored uncompressed in the APK, so it is read straight into
            // memory: a copy on disk would buy nothing and cost the space the restored
            // bundle needs.
            InputStream assetStream = mContext.getAssets().open(bundleFileName);
            try {
                // An uncompressed asset knows its whole length up front, so the buffer is
                // sized for it: growing one would repeatedly hold two copies of a bundle
                // that is already the largest allocation on this path.
                ByteArrayOutputStream bundleBytes = new ByteArrayOutputStream(
                        Math.max(assetStream.available(), CodePushConstants.DOWNLOAD_BUFFER_SIZE));
                byte[] buffer = new byte[CodePushConstants.DOWNLOAD_BUFFER_SIZE];
                int bytesRead;
                while ((bytesRead = assetStream.read(buffer)) > 0) {
                    bundleBytes.write(buffer, 0, bytesRead);
                }

                return bundleBytes.toByteArray();
            } finally {
                assetStream.close();
            }
        }
    }
}
