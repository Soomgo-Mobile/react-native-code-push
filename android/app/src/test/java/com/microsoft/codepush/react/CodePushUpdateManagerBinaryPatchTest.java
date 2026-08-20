package com.microsoft.codepush.react;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Which archive an update is downloaded from, and how the one download that is allowed to
 * fail falls back to the other one.
 */
public class CodePushUpdateManagerBinaryPatchTest {

    private static final String BUNDLE_FILE_NAME = "index.android.bundle";
    private static final String FULL_ARCHIVE_URL = "https://example.test/updates/full.zip";
    private static final String PATCH_ARCHIVE_URL = "https://example.test/updates/full.zip-patch.zip";
    /** Long enough that a timing that wrongly included it could not be mistaken for one that did not. */
    private static final long FULL_ARCHIVE_DOWNLOAD_DURATION_MS = 300;

    @Rule
    public TemporaryFolder mTemporaryFolder = new TemporaryFolder();

    private String mDocumentsDirectory;
    private File mBinaryPatchFolder;

    @Before
    public void setUp() {
        mDocumentsDirectory = mTemporaryFolder.getRoot().getAbsolutePath();
        mBinaryPatchFolder = new File(
                new File(mDocumentsDirectory, CodePushConstants.CODE_PUSH_FOLDER_PREFIX),
                CodePushConstants.BINARY_PATCH_FOLDER_NAME);
    }

    @Test
    public void downloadsTheFullArchiveWhenTheUpdateHasNoBinaryPatch() throws IOException {
        RecordingUpdateManager updateManager = new RecordingUpdateManager(mDocumentsDirectory,
                BinaryPatchResult.success());

        JSONObject patchResult = updateManager.downloadPackage(updatePackage(null), BUNDLE_FILE_NAME, ignoreProgress());

        assertEquals(Arrays.asList(FULL_ARCHIVE_URL), updateManager.downloadedUrls);
        assertEquals(Arrays.asList(false), updateManager.patchAttempts);
        assertNull("a download with no patch to try has nothing to report about one", patchResult);
    }

    @Test
    public void downloadsOnlyTheBinaryPatchArchiveWhenThePatchApplies() throws IOException {
        RecordingUpdateManager updateManager = new RecordingUpdateManager(mDocumentsDirectory,
                BinaryPatchResult.success());

        JSONObject patchResult = updateManager.downloadPackage(updatePackage(PATCH_ARCHIVE_URL), BUNDLE_FILE_NAME,
                ignoreProgress());

        assertEquals(Arrays.asList(PATCH_ARCHIVE_URL), updateManager.downloadedUrls);
        assertEquals(Arrays.asList(true), updateManager.patchAttempts);
        assertEquals("applied", patchResult.optString("status", null));
    }

    @Test
    public void fallsBackToTheFullArchiveOnceWhenThePatchCannotBeApplied() throws IOException {
        RecordingUpdateManager updateManager = new RecordingUpdateManager(mDocumentsDirectory,
                BinaryPatchResult.failure(BinaryPatchResult.REASON_BASE_HASH_MISMATCH));

        JSONObject patchResult = updateManager.downloadPackage(updatePackage(PATCH_ARCHIVE_URL), BUNDLE_FILE_NAME,
                ignoreProgress());

        assertEquals(Arrays.asList(PATCH_ARCHIVE_URL, FULL_ARCHIVE_URL), updateManager.downloadedUrls);
        // The second download is not a patch download, so it has no patch of its own to fail
        // at: the fallback can only happen the once.
        assertEquals(Arrays.asList(true, false), updateManager.patchAttempts);
        assertEquals("fallback", patchResult.optString("status", null));
        // The reason travels to the app exactly as the applier worded it.
        assertEquals(BinaryPatchResult.REASON_BASE_HASH_MISMATCH, patchResult.optString("fallbackReason", null));
    }

    @Test
    public void fallsBackToTheFullArchiveWhenTheBinaryPatchArchiveCannotBeDownloaded() throws IOException {
        RecordingUpdateManager updateManager = new RecordingUpdateManager(mDocumentsDirectory, null);

        JSONObject patchResult = updateManager.downloadPackage(updatePackage(PATCH_ARCHIVE_URL), BUNDLE_FILE_NAME,
                ignoreProgress());

        assertEquals(Arrays.asList(PATCH_ARCHIVE_URL, FULL_ARCHIVE_URL), updateManager.downloadedUrls);
        assertEquals(Arrays.asList(true, false), updateManager.patchAttempts);
        assertEquals("fallback", patchResult.optString("status", null));
        // An archive that could not be downloaded is not something the appliers have a word
        // for, and no word is invented for it here.
        assertFalse(patchResult.has("fallbackReason"));
    }

    @Test
    public void timesThePatchAttemptRatherThanTheDownloadThatFollowedIt() throws IOException {
        RecordingUpdateManager updateManager = new RecordingUpdateManager(mDocumentsDirectory,
                BinaryPatchResult.failure(BinaryPatchResult.REASON_PATCH_APPLY_FAILED));
        updateManager.fullArchiveDownloadDurationMs = FULL_ARCHIVE_DOWNLOAD_DURATION_MS;

        JSONObject patchResult = updateManager.downloadPackage(updatePackage(PATCH_ARCHIVE_URL), BUNDLE_FILE_NAME,
                ignoreProgress());

        // The attempt was over before the full archive was even asked for, so what it reports
        // is time the patch spent and nothing else.
        long reportedDurationMs = patchResult.optLong("applyDurationMs", -1);
        assertTrue("the fallback is timed over the download that followed it: " + reportedDurationMs + " ms",
                reportedDurationMs >= 0 && reportedDurationMs < FULL_ARCHIVE_DOWNLOAD_DURATION_MS);
    }

    @Test
    public void removesTheBinaryPatchWorkingDirectoryWhateverTheOutcomeIs() throws IOException {
        List<BinaryPatchResult> outcomes = Arrays.asList(BinaryPatchResult.success(),
                BinaryPatchResult.failure(BinaryPatchResult.REASON_TARGET_VERIFICATION_FAILED), null);

        for (BinaryPatchResult outcome : outcomes) {
            assertTrue(mBinaryPatchFolder.mkdirs());
            assertTrue(new File(mBinaryPatchFolder, CodePushConstants.BINARY_PATCH_TARGET_FILE_NAME).createNewFile());

            new RecordingUpdateManager(mDocumentsDirectory, outcome)
                    .downloadPackage(updatePackage(PATCH_ARCHIVE_URL), BUNDLE_FILE_NAME, ignoreProgress());

            assertFalse(mBinaryPatchFolder.exists());
        }
    }

    private static JSONObject updatePackage(String binaryPatchDownloadUrl) {
        JSONObject updatePackage = new JSONObject();
        CodePushUtils.setJSONValueForKey(updatePackage, CodePushConstants.PACKAGE_HASH_KEY, "package-hash");
        CodePushUtils.setJSONValueForKey(updatePackage, CodePushConstants.DOWNLOAD_URL_KEY, FULL_ARCHIVE_URL);
        if (binaryPatchDownloadUrl != null) {
            CodePushUtils.setJSONValueForKey(updatePackage, CodePushConstants.BINARY_PATCH_DOWNLOAD_URL_KEY,
                    binaryPatchDownloadUrl);
        }

        return updatePackage;
    }

    private static DownloadProgressCallback ignoreProgress() {
        return new DownloadProgressCallback() {
            @Override
            public void onDownloadStart() {
            }

            @Override
            public void call(DownloadProgress downloadProgress) {
            }
        };
    }

    /**
     * Records which archive each download went to instead of downloading and installing it.
     * Downloading is what these cover, so the manager is built without the collaborator that
     * applies a patch - nothing here reaches it.
     */
    private static class RecordingUpdateManager extends CodePushUpdateManager {

        private final BinaryPatchResult mPatchOutcome;

        final List<String> downloadedUrls = new ArrayList<>();
        final List<Boolean> patchAttempts = new ArrayList<>();

        /** How long the full archive takes to download, for timings that must not include it. */
        long fullArchiveDownloadDurationMs = 0;

        /** @param patchOutcome what the patch download ends in, or null when it cannot be downloaded */
        RecordingUpdateManager(String documentsDirectory, BinaryPatchResult patchOutcome) {
            super(documentsDirectory, (CodePushBinaryPatch) null);
            mPatchOutcome = patchOutcome;
        }

        @Override
        BinaryPatchResult downloadAndInstallPackage(JSONObject updatePackage, String expectedBundleFileName,
                                                    DownloadProgressCallback progressCallback,
                                                    String downloadUrlString, boolean isBinaryPatchUpdate,
                                                    BinaryPatchAttempt patchAttempt) throws IOException {
            downloadedUrls.add(downloadUrlString);
            patchAttempts.add(isBinaryPatchUpdate);

            if (!isBinaryPatchUpdate) {
                sleep(fullArchiveDownloadDurationMs);
                return BinaryPatchResult.success();
            }
            if (mPatchOutcome == null) {
                throw new IOException("the binary patch archive is not there");
            }

            return mPatchOutcome;
        }

        private static void sleep(long durationMs) {
            if (durationMs <= 0) {
                return;
            }

            try {
                Thread.sleep(durationMs);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
    }
}
