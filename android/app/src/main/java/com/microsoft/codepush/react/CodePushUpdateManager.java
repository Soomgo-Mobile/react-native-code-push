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
     * @return what the attempts at installing the update from its patch archives ended in,
     *         or null when the update had no such archive to attempt. The result belongs
     *         to this download alone: the metadata written for the update never carries it.
     */
    public JSONObject downloadPackage(JSONObject updatePackage, String expectedBundleFileName,
                                      DownloadProgressCallback progressCallback) throws IOException {
        // A release that was published with a binary patch offers up to three archives of
        // the same update. The asset diff is the smallest and is tried first, the patch
        // archive stands in when the diff fails on its asset side, and the full archive is
        // always there when none of it works out.
        String binaryPatchDownloadUrl = optArchiveDownloadUrl(updatePackage, CodePushConstants.BINARY_PATCH_DOWNLOAD_URL_KEY);
        String assetDiffDownloadUrl = optArchiveDownloadUrl(updatePackage, CodePushConstants.ASSET_DIFF_DOWNLOAD_URL_KEY);

        ArchiveAttemptLog patchAttempt = null;
        boolean patchArchiveWorthTrying = binaryPatchDownloadUrl != null;
        if (assetDiffDownloadUrl != null) {
            patchAttempt = new ArchiveAttemptLog();
            patchAttempt.beginAttempt(ArchiveAttemptLog.ARCHIVE_ASSET_DIFF);
            if (tryDownloadArchivePackage(updatePackage, expectedBundleFileName, progressCallback,
                    assetDiffDownloadUrl, patchAttempt)) {
                return patchAttempt.result();
            }

            // A diff that failed before its bundle was restored failed in the bundle patch,
            // which the patch archive carries byte for byte - it would fail the same way,
            // and trying it would only put a second doomed download in front of the full
            // one. A failure after the restore is on the asset side, which the patch
            // archive does not share.
            patchArchiveWorthTrying = patchArchiveWorthTrying && patchAttempt.currentAttemptRestoredBundle();
        }

        if (patchArchiveWorthTrying) {
            if (patchAttempt == null) {
                patchAttempt = new ArchiveAttemptLog();
            }
            patchAttempt.beginAttempt(ArchiveAttemptLog.ARCHIVE_BINARY_PATCH);
            if (tryDownloadArchivePackage(updatePackage, expectedBundleFileName, progressCallback,
                    binaryPatchDownloadUrl, patchAttempt)) {
                return patchAttempt.result();
            }
        }

        downloadAndInstallPackage(updatePackage, expectedBundleFileName, progressCallback,
                updatePackage.optString(CodePushConstants.DOWNLOAD_URL_KEY, null), false, null);

        return patchAttempt == null ? null : patchAttempt.result();
    }

    /**
     * @return the URL one of the update's archives is offered at, or null when the update
     *         does not offer that archive. An empty string is not a URL: it stands for the
     *         same absent archive as a missing key, which is what iOS makes of it too.
     */
    private static String optArchiveDownloadUrl(JSONObject updatePackage, String downloadUrlKey) {
        String downloadUrl = updatePackage.optString(downloadUrlKey, null);
        return downloadUrl == null || downloadUrl.isEmpty() ? null : downloadUrl;
    }

    /**
     * Installs the update from one of its patch archives.
     *
     * Every verdict on the archive ends the same way, with the caller moving on to the next
     * one, so none of it is reported to the caller as an error. A network that did not carry
     * the archive is not a verdict on it and is raised instead. The ladder cannot loop:
     * which archive comes next is the caller's decision alone, and the full archive at its
     * end is downloaded by a call that is not allowed to take the patch path, so it has no
     * failure of its own to fall back from.
     *
     * @param patchAttempt records what the attempt ended in, for the caller to hand to
     *                     whoever asked for the download
     * @return true when the update was installed, false when the caller has to move on to
     *         the next archive
     * @throws IOException when the network did not carry the archive, which is not a verdict
     *                     on the archive and so is not a reason to try another one
     */
    private boolean tryDownloadArchivePackage(JSONObject updatePackage, String expectedBundleFileName,
                                              DownloadProgressCallback progressCallback,
                                              String archiveDownloadUrl, ArchiveAttemptLog patchAttempt)
            throws IOException {
        try {
            ArchiveRestoreResult patchResult = downloadAndInstallPackage(updatePackage, expectedBundleFileName,
                    progressCallback, archiveDownloadUrl, true, patchAttempt);
            if (patchResult.succeeded()) {
                return true;
            }

            patchAttempt.recordFallback(patchResult.getFailureReason());
            CodePushUtils.log("The " + patchAttempt.currentArchive() + " archive failed ("
                    + patchResult.getFailureReason() + "). Falling back.");
        } catch (Exception | OutOfMemoryError e) {
            if (CodePushErrorCode.isNetworkFailure(e)) {
                // The network is what failed, not the archive, and the full archive is behind
                // the same network - only larger, and started over from nothing. Falling back
                // here would spend a second download to reach the failure already in hand.
                CodePushUtils.log("The " + patchAttempt.currentArchive()
                        + " archive could not be downloaded. Giving up on the download.");
                if (e instanceof IOException) {
                    throw (IOException) e;
                }

                // A network failure read out of a wrapper this package raised, which the
                // caller catches by its own type rather than by `IOException`.
                throw new CodePushUnknownException(
                        "The " + patchAttempt.currentArchive() + " archive could not be downloaded.", e);
            }

            // Applying a patch is the one path that holds a whole bundle in memory, so
            // running out of it is a failure this has to absorb like any other: by the time
            // it lands here the arrays are unreachable, and the full archive is downloaded
            // to disk in chunks rather than held.
            patchAttempt.recordFallbackAfterError();
            CodePushUtils.log(e);
            CodePushUtils.log("The " + patchAttempt.currentArchive()
                    + " archive could not be applied. Falling back.");
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
     *                            Both the asset diff and the patch archive are downloaded
     *                            that way; the full archive never is, so an update being
     *                            downloaded in full can never end up on the patch path.
     * @param patchAttempt the record the patch is timed into, or null for a full download,
     *                     which has no patch to time
     * @return the outcome of the patch: a failed result means the update was not installed
     *         and the caller has to move on to the next archive. Downloading the full
     *         archive always succeeds or throws.
     */
    ArchiveRestoreResult downloadAndInstallPackage(JSONObject updatePackage, String expectedBundleFileName,
                                                DownloadProgressCallback progressCallback,
                                                String downloadUrlString, boolean isBinaryPatchUpdate,
                                                ArchiveAttemptLog patchAttempt) throws IOException {
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
            connection.setConnectTimeout(CodePushConstants.DOWNLOAD_CONNECT_TIMEOUT_IN_MS);
            connection.setReadTimeout(CodePushConstants.DOWNLOAD_READ_TIMEOUT_IN_MS);

            if (android.os.Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP &&
                downloadUrl.toString().startsWith("https")) {
                try {
                    ((HttpsURLConnection)connection).setSSLSocketFactory(new TLSSocketFactory());
                } catch (Exception e) {
                    throw new CodePushUnknownException("Error set SSLSocketFactory. ", e);
                }
            }

            connection.setRequestProperty("Accept-Encoding", "identity");

            // Read before the body is: an error status carries a body of its own, and
            // asking `getInputStream()` for it first turns some statuses into a stream and
            // others into an exception that says nothing about which status it was.
            int responseCode = connection.getResponseCode();
            if (responseCode >= 400) {
                throw new CodePushHttpException(downloadUrlString, responseCode);
            }

            bin = new BufferedInputStream(connection.getInputStream());

            // Announced only once the response is flowing, so a connection that fails to
            // open never announces an empty stream.
            progressCallback.onDownloadStart();
            long totalBytes = connection.getContentLength();
            long receivedBytes = 0;

            if (totalBytes > 0) {
                // The zero-received event hands the listener this download's total up front,
                // so a fallback download shows as restarting rather than running backwards.
                progressCallback.call(new DownloadProgress(totalBytes, 0));
            }

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

            // Only against a length the server declared. `getContentLength()` answers -1
            // for a body sent without one, which no read total matches - so comparing anyway
            // would fail every download a server chooses to send that way.
            if (totalBytes >= 0 && totalBytes != receivedBytes) {
                throw new CodePushIncompleteDownloadException(receivedBytes, totalBytes);
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
                ArchiveRestoreResult patchResult = mBinaryPatch.restoreBundle(unzippedFolderPath,
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
                try {
                    String currentPackageFolderPath = getCurrentPackageFolderPath();
                    if (currentPackageFolderPath != null && !FileUtils.fileAtPathExists(currentPackageFolderPath)) {
                        // The copy below skips a package that is gone and lets the merge
                        // "complete" without it, which would report the missing package as a
                        // verification failure of the merged contents. The other platform's
                        // merge fails reading the missing files, so it is refused here too,
                        // for the two platforms to report one reason for one state.
                        throw new IOException("The installed package the diff merges into is gone from " + currentPackageFolderPath);
                    }

                    CodePushUpdateUtils.copyNecessaryFilesFromCurrentPackage(diffManifestFilePath, currentPackageFolderPath, newUpdateFolderPath);
                    File diffManifestFile = new File(diffManifestFilePath);
                    diffManifestFile.delete();
                } catch (Exception e) {
                    // A merge that cannot complete has a word of its own, because it says
                    // the diff went wrong on its asset side - the one failure the patch
                    // archive, which carries every asset, is not implicated in.
                    if (isBinaryPatchUpdate) {
                        CodePushUtils.log(e);
                        return ArchiveRestoreResult.failure(ArchiveRestoreResult.REASON_ASSET_MERGE_FAILED);
                    }

                    throw e;
                }
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
                // Whatever the archive URL served, it is not an update archive - an error page
                // answered with a 200 looks like this too. Moving it into place would
                // install bytes no hash has ever been checked against, so the full archive
                // is downloaded instead.
                return ArchiveRestoreResult.failure(ArchiveRestoreResult.REASON_INVALID_MANIFEST);
            }

            // File is a jsbundle, move it to a folder with the packageHash as its name
            FileUtils.moveFile(downloadFile, newUpdateFolderPath, expectedBundleFileName);
        }

        // Save metadata to the folder.
        CodePushUtils.writeJsonToFile(updatePackage, newUpdateMetadataPath);

        return ArchiveRestoreResult.success();
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
            connection.setConnectTimeout(CodePushConstants.DOWNLOAD_CONNECT_TIMEOUT_IN_MS);
            connection.setReadTimeout(CodePushConstants.DOWNLOAD_READ_TIMEOUT_IN_MS);

            int responseCode = connection.getResponseCode();
            if (responseCode >= 400) {
                throw new CodePushHttpException(remoteBundleUrl, responseCode);
            }

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
