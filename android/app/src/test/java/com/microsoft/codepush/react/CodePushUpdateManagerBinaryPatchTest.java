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
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Which archives an update is downloaded from, and how a failed one picks the next rung:
 * the patch archive after an asset-side diff failure, the full archive after every other.
 */
public class CodePushUpdateManagerBinaryPatchTest {

    private static final String BUNDLE_FILE_NAME = "index.android.bundle";
    private static final String FULL_ARCHIVE_URL = "https://example.test/updates/full.zip";
    private static final String PATCH_ARCHIVE_URL = "https://example.test/updates/full.zip-patch.zip";
    private static final String DIFF_ARCHIVE_URL = "https://example.test/updates/diff-from-base.zip";
    /** Long enough that a timing that wrongly included it could not be mistaken for one that did not. */
    private static final long FULL_ARCHIVE_DOWNLOAD_DURATION_MS = 300;
    /** Long enough that a total which dropped the attempt that installed could not be mistaken for one that kept it. */
    private static final long PATCH_ARCHIVE_DOWNLOAD_DURATION_MS = 300;

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
                ArchiveRestoreResult.success());

        JSONObject patchResult = updateManager.downloadPackage(updatePackage(null), BUNDLE_FILE_NAME, ignoreProgress());

        assertEquals(Arrays.asList(FULL_ARCHIVE_URL), updateManager.downloadedUrls);
        assertEquals(Arrays.asList(false), updateManager.patchAttempts);
        assertNull("a download with no patch to try has nothing to report about one", patchResult);
    }

    @Test
    public void downloadsOnlyTheBinaryPatchArchiveWhenThePatchApplies() throws IOException {
        RecordingUpdateManager updateManager = new RecordingUpdateManager(mDocumentsDirectory,
                ArchiveRestoreResult.success());

        JSONObject patchResult = updateManager.downloadPackage(updatePackage(PATCH_ARCHIVE_URL), BUNDLE_FILE_NAME,
                ignoreProgress());

        assertEquals(Arrays.asList(PATCH_ARCHIVE_URL), updateManager.downloadedUrls);
        assertEquals(Arrays.asList(true), updateManager.patchAttempts);
        assertEquals("applied", patchResult.optString("status", null));
    }

    @Test
    public void fallsBackToTheFullArchiveOnceWhenThePatchCannotBeApplied() throws IOException {
        RecordingUpdateManager updateManager = new RecordingUpdateManager(mDocumentsDirectory,
                ArchiveRestoreResult.failure(ArchiveRestoreResult.REASON_BASE_HASH_MISMATCH));

        JSONObject patchResult = updateManager.downloadPackage(updatePackage(PATCH_ARCHIVE_URL), BUNDLE_FILE_NAME,
                ignoreProgress());

        assertEquals(Arrays.asList(PATCH_ARCHIVE_URL, FULL_ARCHIVE_URL), updateManager.downloadedUrls);
        // The second download is not a patch download, so it has no patch of its own to fail
        // at: the fallback can only happen the once.
        assertEquals(Arrays.asList(true, false), updateManager.patchAttempts);
        assertEquals("fallback", patchResult.optString("status", null));
        // The reason travels to the app exactly as the applier worded it.
        assertEquals(ArchiveRestoreResult.REASON_BASE_HASH_MISMATCH, patchResult.optString("fallbackReason", null));
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
    public void downloadsOnlyTheAssetDiffArchiveWhenTheDiffApplies() throws IOException {
        RecordingUpdateManager updateManager = new RecordingUpdateManager(mDocumentsDirectory,
                ArchiveRestoreResult.success());

        JSONObject patchResult = updateManager.downloadPackage(updatePackage(PATCH_ARCHIVE_URL, DIFF_ARCHIVE_URL),
                BUNDLE_FILE_NAME, ignoreProgress());

        assertEquals(Arrays.asList(DIFF_ARCHIVE_URL), updateManager.downloadedUrls);
        assertEquals("applied", patchResult.optString("status", null));
        assertEquals("asset-diff", patchResult.optString("archive", null));
        assertEquals(1, patchResult.optJSONArray("attempts").length());
    }

    @Test
    public void fallsBackToThePatchArchiveWhenTheDiffFailsAfterItsBundleWasRestored() throws IOException {
        RecordingUpdateManager updateManager = new RecordingUpdateManager(mDocumentsDirectory,
                ArchiveRestoreResult.success());
        updateManager.urlsRestoringTheBundle.add(DIFF_ARCHIVE_URL);
        updateManager.patchOutcomesByUrl.put(DIFF_ARCHIVE_URL,
                ArchiveRestoreResult.failure(ArchiveRestoreResult.REASON_ASSET_MERGE_FAILED));
        updateManager.downloadDurationMsByUrl.put(PATCH_ARCHIVE_URL, PATCH_ARCHIVE_DOWNLOAD_DURATION_MS);

        JSONObject patchResult = updateManager.downloadPackage(updatePackage(PATCH_ARCHIVE_URL, DIFF_ARCHIVE_URL),
                BUNDLE_FILE_NAME, ignoreProgress());

        // A failure after the restore is on the asset side of the diff, which the patch
        // archive does not share - so the patch is the next rung, not the full archive.
        assertEquals(Arrays.asList(DIFF_ARCHIVE_URL, PATCH_ARCHIVE_URL), updateManager.downloadedUrls);
        assertEquals("applied", patchResult.optString("status", null));
        assertEquals("binary-patch", patchResult.optString("archive", null));
        assertEquals(2, patchResult.optJSONArray("attempts").length());
        JSONObject diffAttempt = patchResult.optJSONArray("attempts").optJSONObject(0);
        assertEquals("asset-diff", diffAttempt.optString("archive", null));
        assertEquals(ArchiveRestoreResult.REASON_ASSET_MERGE_FAILED, diffAttempt.optString("fallbackReason", null));

        // The path runs to the end, not to the moment the diff was given up on: the attempt
        // that installed is most of it, so a total frozen at the first fallback would be
        // smaller than the attempt it is supposed to contain.
        long totalDurationMs = patchResult.optLong("totalDurationMs", -1);
        long patchAttemptDurationMs = patchResult.optJSONArray("attempts").optJSONObject(1)
                .optLong("durationMs", -1);
        assertTrue("the total covers the attempt that installed: " + totalDurationMs + " ms total against "
                        + patchAttemptDurationMs + " ms in that attempt alone",
                totalDurationMs >= patchAttemptDurationMs);
        assertTrue("the total covers the download the attempt that installed spent: " + totalDurationMs + " ms",
                totalDurationMs >= PATCH_ARCHIVE_DOWNLOAD_DURATION_MS);
    }

    @Test
    public void skipsThePatchArchiveWhenTheDiffFailedInTheBundlePatchBothArchivesCarry() throws IOException {
        RecordingUpdateManager updateManager = new RecordingUpdateManager(mDocumentsDirectory,
                ArchiveRestoreResult.failure(ArchiveRestoreResult.REASON_BASE_HASH_MISMATCH));

        JSONObject patchResult = updateManager.downloadPackage(updatePackage(PATCH_ARCHIVE_URL, DIFF_ARCHIVE_URL),
                BUNDLE_FILE_NAME, ignoreProgress());

        // Both archives carry the same bundle patch, so the patch archive would fail the
        // same way and is passed over for the full one.
        assertEquals(Arrays.asList(DIFF_ARCHIVE_URL, FULL_ARCHIVE_URL), updateManager.downloadedUrls);
        assertEquals("fallback", patchResult.optString("status", null));
        assertEquals("asset-diff", patchResult.optString("archive", null));
        assertEquals(ArchiveRestoreResult.REASON_BASE_HASH_MISMATCH, patchResult.optString("fallbackReason", null));
        assertEquals(1, patchResult.optJSONArray("attempts").length());
        assertFalse("an attempt that never restored the bundle has no apply to report",
                patchResult.optJSONArray("attempts").optJSONObject(0).has("applyDurationMs"));
    }

    @Test
    public void fallsBackToTheFullArchiveWhenTheDiffAndThePatchBothFail() throws IOException {
        RecordingUpdateManager updateManager = new RecordingUpdateManager(mDocumentsDirectory,
                ArchiveRestoreResult.failure(ArchiveRestoreResult.REASON_TARGET_VERIFICATION_FAILED));
        updateManager.urlsRestoringTheBundle.add(DIFF_ARCHIVE_URL);
        updateManager.patchOutcomesByUrl.put(DIFF_ARCHIVE_URL,
                ArchiveRestoreResult.failure(ArchiveRestoreResult.REASON_ASSET_MERGE_FAILED));

        JSONObject patchResult = updateManager.downloadPackage(updatePackage(PATCH_ARCHIVE_URL, DIFF_ARCHIVE_URL),
                BUNDLE_FILE_NAME, ignoreProgress());

        assertEquals(Arrays.asList(DIFF_ARCHIVE_URL, PATCH_ARCHIVE_URL, FULL_ARCHIVE_URL),
                updateManager.downloadedUrls);
        assertEquals("fallback", patchResult.optString("status", null));
        // The top of the result retells the last attempt; the chain holds them both.
        assertEquals("binary-patch", patchResult.optString("archive", null));
        assertEquals(ArchiveRestoreResult.REASON_TARGET_VERIFICATION_FAILED,
                patchResult.optString("fallbackReason", null));
        assertEquals(ArchiveRestoreResult.REASON_ASSET_MERGE_FAILED,
                patchResult.optJSONArray("attempts").optJSONObject(0).optString("fallbackReason", null));
        assertEquals(ArchiveRestoreResult.REASON_TARGET_VERIFICATION_FAILED,
                patchResult.optJSONArray("attempts").optJSONObject(1).optString("fallbackReason", null));
    }

    @Test
    public void fallsBackToTheFullArchiveWhenTheDiffFailsAndTheUpdateHasNoPatchArchive() throws IOException {
        RecordingUpdateManager updateManager = new RecordingUpdateManager(mDocumentsDirectory,
                ArchiveRestoreResult.failure(ArchiveRestoreResult.REASON_ASSET_MERGE_FAILED));
        updateManager.urlsRestoringTheBundle.add(DIFF_ARCHIVE_URL);

        JSONObject patchResult = updateManager.downloadPackage(updatePackage(null, DIFF_ARCHIVE_URL),
                BUNDLE_FILE_NAME, ignoreProgress());

        assertEquals(Arrays.asList(DIFF_ARCHIVE_URL, FULL_ARCHIVE_URL), updateManager.downloadedUrls);
        assertEquals("fallback", patchResult.optString("status", null));
    }

    @Test
    public void timesThePatchAttemptRatherThanTheDownloadThatFollowedIt() throws IOException {
        RecordingUpdateManager updateManager = new RecordingUpdateManager(mDocumentsDirectory,
                ArchiveRestoreResult.failure(ArchiveRestoreResult.REASON_PATCH_APPLY_FAILED));
        updateManager.fullArchiveDownloadDurationMs = FULL_ARCHIVE_DOWNLOAD_DURATION_MS;

        JSONObject patchResult = updateManager.downloadPackage(updatePackage(PATCH_ARCHIVE_URL), BUNDLE_FILE_NAME,
                ignoreProgress());

        // The attempt was over before the full archive was even asked for, so what it reports
        // is time the patch spent and nothing else.
        long reportedDurationMs = patchResult.optLong("totalDurationMs", -1);
        assertTrue("the fallback is timed over the download that followed it: " + reportedDurationMs + " ms",
                reportedDurationMs >= 0 && reportedDurationMs < FULL_ARCHIVE_DOWNLOAD_DURATION_MS);
    }

    @Test
    public void removesTheBinaryPatchWorkingDirectoryWhateverTheOutcomeIs() throws IOException {
        List<ArchiveRestoreResult> outcomes = Arrays.asList(ArchiveRestoreResult.success(),
                ArchiveRestoreResult.failure(ArchiveRestoreResult.REASON_TARGET_VERIFICATION_FAILED), null);

        for (ArchiveRestoreResult outcome : outcomes) {
            assertTrue(mBinaryPatchFolder.mkdirs());
            assertTrue(new File(mBinaryPatchFolder, CodePushConstants.BINARY_PATCH_TARGET_FILE_NAME).createNewFile());

            new RecordingUpdateManager(mDocumentsDirectory, outcome)
                    .downloadPackage(updatePackage(PATCH_ARCHIVE_URL), BUNDLE_FILE_NAME, ignoreProgress());

            assertFalse(mBinaryPatchFolder.exists());
        }
    }

    private static JSONObject updatePackage(String binaryPatchDownloadUrl) {
        return updatePackage(binaryPatchDownloadUrl, null);
    }

    private static JSONObject updatePackage(String binaryPatchDownloadUrl, String assetDiffDownloadUrl) {
        JSONObject updatePackage = new JSONObject();
        CodePushUtils.setJSONValueForKey(updatePackage, CodePushConstants.PACKAGE_HASH_KEY, "package-hash");
        CodePushUtils.setJSONValueForKey(updatePackage, CodePushConstants.DOWNLOAD_URL_KEY, FULL_ARCHIVE_URL);
        if (binaryPatchDownloadUrl != null) {
            CodePushUtils.setJSONValueForKey(updatePackage, CodePushConstants.BINARY_PATCH_DOWNLOAD_URL_KEY,
                    binaryPatchDownloadUrl);
        }
        if (assetDiffDownloadUrl != null) {
            CodePushUtils.setJSONValueForKey(updatePackage, CodePushConstants.ASSET_DIFF_DOWNLOAD_URL_KEY,
                    assetDiffDownloadUrl);
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

        private final ArchiveRestoreResult mPatchOutcome;

        final List<String> downloadedUrls = new ArrayList<>();
        final List<Boolean> patchAttempts = new ArrayList<>();

        /** Outcomes for one archive at a time; every other archive ends in the shared one. */
        final Map<String, ArchiveRestoreResult> patchOutcomesByUrl = new HashMap<>();

        /** Archives whose attempt restores the bundle before it ends, whichever way it ends. */
        final Set<String> urlsRestoringTheBundle = new HashSet<>();

        /** How long the full archive takes to download, for timings that must not include it. */
        long fullArchiveDownloadDurationMs = 0;

        /** How long one archive takes to download, for timings that have to tell the attempts apart. */
        final Map<String, Long> downloadDurationMsByUrl = new HashMap<>();

        /** @param patchOutcome what a patch download ends in, or null when it cannot be downloaded */
        RecordingUpdateManager(String documentsDirectory, ArchiveRestoreResult patchOutcome) {
            super(documentsDirectory, (CodePushBinaryPatch) null);
            mPatchOutcome = patchOutcome;
        }

        @Override
        ArchiveRestoreResult downloadAndInstallPackage(JSONObject updatePackage, String expectedBundleFileName,
                                                    DownloadProgressCallback progressCallback,
                                                    String downloadUrlString, boolean isBinaryPatchUpdate,
                                                    ArchiveAttemptLog patchAttempt) throws IOException {
            downloadedUrls.add(downloadUrlString);
            patchAttempts.add(isBinaryPatchUpdate);
            if (downloadDurationMsByUrl.containsKey(downloadUrlString)) {
                sleep(downloadDurationMsByUrl.get(downloadUrlString));
            }

            if (!isBinaryPatchUpdate) {
                sleep(fullArchiveDownloadDurationMs);
                return ArchiveRestoreResult.success();
            }

            if (urlsRestoringTheBundle.contains(downloadUrlString)) {
                patchAttempt.recordBundleRestored(1);
            }

            ArchiveRestoreResult outcome = patchOutcomesByUrl.containsKey(downloadUrlString)
                    ? patchOutcomesByUrl.get(downloadUrlString)
                    : mPatchOutcome;
            if (outcome == null) {
                throw new IOException("the binary patch archive is not there");
            }

            return outcome;
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
