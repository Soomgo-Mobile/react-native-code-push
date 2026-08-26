package com.microsoft.codepush.react;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.fail;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONException;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.Charset;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * Downloading a real archive over HTTP and installing what comes out of it.
 *
 * These exercise the update manager end to end - download, unzip, restore, folder hash,
 * metadata - with only the two seams of the applier stubbed, because the wiring between
 * those steps is where an archive that is not what it claims has to be caught.
 */
public class CodePushUpdateManagerDownloadTest {

    private static final String BUNDLE_FILE_NAME = "index.android.bundle";
    /** Every archive wraps its files in one directory, which the manifest paths are relative to. */
    private static final String CONTENTS_DIR_NAME = "CodePush";
    private static final String ASSET_PATH = "assets/logo.png";
    /** An asset the update adds, so the diff archive is the only place it comes from. */
    private static final String ADDED_ASSET_PATH = "assets/badge.png";
    /** An asset the installed package holds and the update does without. */
    private static final String DROPPED_ASSET_PATH = "assets/legacy.png";

    private static final byte[] BASE_BUNDLE = bytes("the bundle inside the app binary");
    private static final byte[] TARGET_BUNDLE = bytes("the bundle the update wants to run");
    private static final byte[] INSTALLED_BUNDLE = bytes("the bundle of the update already installed");
    private static final byte[] PATCH = bytes("the difference between the two");
    private static final byte[] ASSET = bytes("an image the update ships with");
    private static final byte[] ADDED_ASSET = bytes("an image only the newer update ships");
    private static final byte[] DROPPED_ASSET = bytes("an image the newer update leaves behind");
    private static final byte[] ERROR_PAGE = bytes("<html><body>404 Not Found</body></html>");

    @Rule
    public TemporaryFolder mTemporaryFolder = new TemporaryFolder();

    private TestArchiveServer mServer;

    private String mDocumentsDirectory;
    private String mPackageHash;
    private File mPackageFolder;

    @Before
    public void setUp() throws IOException {
        mDocumentsDirectory = mTemporaryFolder.getRoot().getAbsolutePath();
        mPackageHash = packageHashOf(fullArchiveContents());
        mPackageFolder = new File(new File(mDocumentsDirectory, CodePushConstants.CODE_PUSH_FOLDER_PREFIX), mPackageHash);

        mServer = new TestArchiveServer();
    }

    @After
    public void tearDown() throws IOException {
        mServer.close();
    }

    @Test
    public void installsAnUpdateFromItsBinaryPatchArchive() throws IOException, JSONException {
        String patchUrl = serve("/patch.zip", zipOf(patchArchiveContents()));
        String fullUrl = serve("/full.zip", zipOf(fullArchiveContents()));

        JSONObject patchResult = updateManager(applierWriting(TARGET_BUNDLE))
                .downloadPackage(updatePackage(fullUrl, patchUrl), BUNDLE_FILE_NAME, ignoreProgress());

        assertEquals("the full archive is not downloaded when the patch installs",
                Arrays.asList("/patch.zip"), mServer.requestedPaths());
        assertInstalledContents();
        assertEquals("applied", patchResult.optString("status", null));
        assertFalse("an applied patch has nothing to report a reason for", patchResult.has("fallbackReason"));
        assertTrue("the whole path is timed", patchResult.optLong("totalDurationMs", -1) >= 0);
        assertFalse("the result no longer carries a top level apply time", patchResult.has("applyDurationMs"));

        JSONObject appliedAttempt = patchResult.getJSONArray("attempts").getJSONObject(0);
        assertTrue("an applied attempt carries its apply time", appliedAttempt.has("applyDurationMs"));
        assertTrue(appliedAttempt.optLong("applyDurationMs", -1) >= 0);
    }

    @Test
    public void fallsBackToTheFullArchiveWhenThePatchUrlDoesNotServeAnArchive() throws IOException {
        // A CDN that answers an error page with a 200 is the realistic way this happens.
        String patchUrl = serve("/patch.zip", ERROR_PAGE);
        String fullUrl = serve("/full.zip", zipOf(fullArchiveContents()));

        JSONObject patchResult = updateManager(applierWriting(TARGET_BUNDLE))
                .downloadPackage(updatePackage(fullUrl, patchUrl), BUNDLE_FILE_NAME, ignoreProgress());

        assertEquals(Arrays.asList("/patch.zip", "/full.zip"), mServer.requestedPaths());
        assertInstalledContents();
        assertFallbackResult(patchResult, ArchiveRestoreResult.REASON_INVALID_MANIFEST);
    }

    @Test
    public void reportsAnInvalidManifestWhenThePatchUrlDoesNotServeAnArchive() throws IOException {
        String patchUrl = serve("/patch.zip", ERROR_PAGE);

        ArchiveRestoreResult result = updateManager(applierWriting(TARGET_BUNDLE)).downloadAndInstallPackage(
                updatePackage("https://example.test/unused.zip", patchUrl), BUNDLE_FILE_NAME, ignoreProgress(),
                patchUrl, true, new ArchiveAttemptLog());

        assertFalse(result.succeeded());
        assertEquals(ArchiveRestoreResult.REASON_INVALID_MANIFEST, result.getFailureReason());
        assertFalse("bytes that are not an update must not reach the package folder", mPackageFolder.exists());
    }

    @Test
    public void failsTheDownloadWhenTheServerAnswersTheArchiveWithAnErrorStatus() throws IOException {
        // Nothing is served at this path, so the server answers it with a 404.
        String fullUrl = mServer.urlOf("/missing-full.zip");

        try {
            updateManager(applierWriting(TARGET_BUNDLE)).downloadPackage(
                    fullUpdatePackage(mPackageHash, fullUrl), BUNDLE_FILE_NAME, ignoreProgress());
            fail("a download the server refused must not be reported as installed");
        } catch (CodePushHttpException e) {
            assertEquals(404, e.getStatusCode());
            assertTrue("the message names the status the server answered with",
                    e.getMessage().contains("404"));
        }

        assertFalse("nothing the server refused reaches the package folder", mPackageFolder.exists());
    }

    @Test
    public void fallsBackToTheFullArchiveWhenApplyingThePatchRunsOutOfMemory() throws IOException {
        String patchUrl = serve("/patch.zip", zipOf(patchArchiveContents()));
        String fullUrl = serve("/full.zip", zipOf(fullArchiveContents()));
        CodePushBinaryPatch.PatchApplier outOfMemoryApplier = new CodePushBinaryPatch.PatchApplier() {
            @Override
            public int apply(byte[] base, byte[] patch, String outputPath, long expectedTargetSize) {
                throw new OutOfMemoryError("Failed to allocate the restored bundle");
            }
        };

        JSONObject patchResult = updateManager(outOfMemoryApplier)
                .downloadPackage(updatePackage(fullUrl, patchUrl), BUNDLE_FILE_NAME, ignoreProgress());

        assertEquals(Arrays.asList("/patch.zip", "/full.zip"), mServer.requestedPaths());
        assertInstalledContents();
        // Running out of memory is not one of the outcomes the appliers have a word for, and
        // no word is invented for it here.
        assertFallbackResult(patchResult, null);
    }

    @Test
    public void reportsAPackageVerificationFailureWhenTheRestoredUpdateIsNotTheOnePublished() throws IOException {
        // The patch archive carries an asset the release was not published with, so the
        // bundle it restores is the promised one while the update it makes is not.
        Map<String, byte[]> contents = patchArchiveContents();
        contents.put(CONTENTS_DIR_NAME + "/" + ASSET_PATH, bytes("an image from some other release"));
        String patchUrl = serve("/patch.zip", zipOf(contents));
        String fullUrl = serve("/full.zip", zipOf(fullArchiveContents()));

        JSONObject patchResult = updateManager(applierWriting(TARGET_BUNDLE))
                .downloadPackage(updatePackage(fullUrl, patchUrl), BUNDLE_FILE_NAME, ignoreProgress());

        assertEquals(Arrays.asList("/patch.zip", "/full.zip"), mServer.requestedPaths());
        assertInstalledContents();
        assertFallbackResult(patchResult, ArchiveRestoreResult.REASON_PACKAGE_VERIFICATION_FAILED);
    }

    @Test
    public void installsAnAssetDiffUpdateByMergingWithTheInstalledPackage() throws IOException {
        installBaseUpdate();
        Map<String, byte[]> updateContents = assetDiffTargetContents();
        String updateHash = packageHashOf(updateContents);
        String diffUrl = serve("/diff.zip", zipOf(assetDiffArchiveContents(DROPPED_ASSET_PATH)));
        String fullUrl = serve("/full.zip", zipOf(updateContents));

        JSONObject patchResult = updateManager(applierWriting(TARGET_BUNDLE))
                .downloadPackage(updatePackage(updateHash, fullUrl, diffUrl), BUNDLE_FILE_NAME, ignoreProgress());

        assertEquals("the update is downloaded as its diff alone, the base being already installed",
                Arrays.asList("/installed.zip", "/diff.zip"), mServer.requestedPaths());
        assertEquals("applied", patchResult.optString("status", null));
        assertFalse("an applied diff has nothing to report a reason for", patchResult.has("fallbackReason"));
        // The asset the diff leaves out is carried over from the installed package, and the
        // one its manifest names is not.
        assertInstalledContents(updateHash, updateContents);
    }

    @Test
    public void fallsBackToTheFullArchiveWhenTheAssetDiffMergeYieldsTheWrongContents() throws IOException {
        // A manifest that deletes an asset the update keeps: the merge ends up missing a file
        // the release was published with, and the update is not the one the hash is for.
        installBaseUpdate();
        Map<String, byte[]> updateContents = assetDiffTargetContents();
        String updateHash = packageHashOf(updateContents);
        String diffUrl = serve("/diff.zip", zipOf(assetDiffArchiveContents(ASSET_PATH)));
        String fullUrl = serve("/full.zip", zipOf(updateContents));

        JSONObject patchResult = updateManager(applierWriting(TARGET_BUNDLE))
                .downloadPackage(updatePackage(updateHash, fullUrl, diffUrl), BUNDLE_FILE_NAME, ignoreProgress());

        assertEquals(Arrays.asList("/installed.zip", "/diff.zip", "/full.zip"), mServer.requestedPaths());
        assertFallbackResult(patchResult, ArchiveRestoreResult.REASON_PACKAGE_VERIFICATION_FAILED);
        assertInstalledContents(updateHash, updateContents);
    }

    @Test
    public void fallsBackToTheFullArchiveWhenAnAssetDiffArrivesWithNoInstalledPackage() throws IOException {
        // Nothing is installed, so the assets the diff counts on being there already have
        // nowhere to be copied from and the merge cannot make the update whole.
        Map<String, byte[]> updateContents = assetDiffTargetContents();
        String updateHash = packageHashOf(updateContents);
        String diffUrl = serve("/diff.zip", zipOf(assetDiffArchiveContents(DROPPED_ASSET_PATH)));
        String fullUrl = serve("/full.zip", zipOf(updateContents));

        JSONObject patchResult = updateManager(applierWriting(TARGET_BUNDLE))
                .downloadPackage(updatePackage(updateHash, fullUrl, diffUrl), BUNDLE_FILE_NAME, ignoreProgress());

        assertEquals(Arrays.asList("/diff.zip", "/full.zip"), mServer.requestedPaths());
        assertFallbackResult(patchResult, ArchiveRestoreResult.REASON_PACKAGE_VERIFICATION_FAILED);
        assertInstalledContents(updateHash, updateContents);
    }

    @Test
    public void fallsBackToThePatchArchiveWhenTheInstalledPackageIsGoneFromDisk() throws IOException {
        // The metadata still names the installed update, but its files are gone: the merge
        // has nothing to read, which is a failure of the merge itself rather than of its
        // result - and the one failure the patch archive, carrying every asset, is not
        // implicated in.
        installBaseUpdate();
        FileUtils.deleteDirectoryAtPath(new File(
                new File(mDocumentsDirectory, CodePushConstants.CODE_PUSH_FOLDER_PREFIX),
                packageHashOf(installedArchiveContents())).getAbsolutePath());

        Map<String, byte[]> updateContents = assetDiffTargetContents();
        String updateHash = packageHashOf(updateContents);
        String diffUrl = serve("/diff.zip", zipOf(assetDiffArchiveContents(DROPPED_ASSET_PATH)));
        String patchUrl = serve("/patch.zip", zipOf(patchArchiveContentsForAssetDiffTarget()));
        String fullUrl = serve("/full.zip", zipOf(updateContents));

        JSONObject patchResult = updateManager(applierWriting(TARGET_BUNDLE)).downloadPackage(
                updatePackageWithAssetDiff(updateHash, fullUrl, patchUrl, diffUrl), BUNDLE_FILE_NAME, ignoreProgress());

        assertEquals(Arrays.asList("/installed.zip", "/diff.zip", "/patch.zip"), mServer.requestedPaths());
        assertEquals("applied", patchResult.optString("status", null));
        assertEquals("binary-patch", patchResult.optString("archive", null));
        assertEquals(ArchiveRestoreResult.REASON_ASSET_MERGE_FAILED,
                patchResult.optJSONArray("attempts").optJSONObject(0).optString("fallbackReason", null));
        assertInstalledContents(updateHash, updateContents);
    }

    @Test
    public void fallsBackToThePatchArchiveWhenTheAssetDiffManifestCannotBeParsed() throws IOException {
        // Bytes that are not JSON leave nothing to read the deletions out of, so the merge
        // has no way to know what it was supposed to delete - a failure of the merge itself.
        installBaseUpdate();
        Map<String, byte[]> updateContents = assetDiffTargetContents();
        String updateHash = packageHashOf(updateContents);
        String diffUrl = serve("/diff.zip",
                zipOf(assetDiffArchiveContentsWithManifest(bytes("{\"deletedFiles\":"))));
        String patchUrl = serve("/patch.zip", zipOf(patchArchiveContentsForAssetDiffTarget()));
        String fullUrl = serve("/full.zip", zipOf(updateContents));

        JSONObject patchResult = updateManager(applierWriting(TARGET_BUNDLE)).downloadPackage(
                updatePackageWithAssetDiff(updateHash, fullUrl, patchUrl, diffUrl), BUNDLE_FILE_NAME, ignoreProgress());

        assertEquals(Arrays.asList("/installed.zip", "/diff.zip", "/patch.zip"), mServer.requestedPaths());
        assertEquals("applied", patchResult.optString("status", null));
        assertEquals("binary-patch", patchResult.optString("archive", null));
        assertEquals(ArchiveRestoreResult.REASON_ASSET_MERGE_FAILED,
                patchResult.optJSONArray("attempts").optJSONObject(0).optString("fallbackReason", null));
        assertInstalledContents(updateHash, updateContents);
    }

    @Test
    public void fallsBackToThePatchArchiveWhenTheAssetDiffManifestDoesNotNameTheFilesToDelete() throws IOException {
        // A manifest without the key is not a manifest with nothing to delete: the CLI always
        // writes it, an empty list included, so its absence says the manifest is not the one
        // the release published - and merging past it would leave behind files the update
        // dropped.
        installBaseUpdate();
        Map<String, byte[]> updateContents = assetDiffTargetContents();
        String updateHash = packageHashOf(updateContents);
        String diffUrl = serve("/diff.zip", zipOf(assetDiffArchiveContentsWithManifest(bytes("{}"))));
        String patchUrl = serve("/patch.zip", zipOf(patchArchiveContentsForAssetDiffTarget()));
        String fullUrl = serve("/full.zip", zipOf(updateContents));

        JSONObject patchResult = updateManager(applierWriting(TARGET_BUNDLE)).downloadPackage(
                updatePackageWithAssetDiff(updateHash, fullUrl, patchUrl, diffUrl), BUNDLE_FILE_NAME, ignoreProgress());

        assertEquals(Arrays.asList("/installed.zip", "/diff.zip", "/patch.zip"), mServer.requestedPaths());
        assertEquals("applied", patchResult.optString("status", null));
        assertEquals("binary-patch", patchResult.optString("archive", null));
        assertEquals(ArchiveRestoreResult.REASON_ASSET_MERGE_FAILED,
                patchResult.optJSONArray("attempts").optJSONObject(0).optString("fallbackReason", null));
        assertInstalledContents(updateHash, updateContents);
    }

    @Test
    public void skipsThePatchArchiveWhenTheAssetDiffCannotBeDownloaded() throws IOException {
        // A diff that never arrived left no verdict at all: nothing says the patch archive
        // is any better off, and the full download is the one that cannot fail - so a
        // client is never walked through two doomed downloads on its way there.
        Map<String, byte[]> updateContents = assetDiffTargetContents();
        String updateHash = packageHashOf(updateContents);
        String diffUrl = mServer.urlOf("/missing-diff.zip");
        String patchUrl = serve("/patch.zip", zipOf(patchArchiveContentsForAssetDiffTarget()));
        String fullUrl = serve("/full.zip", zipOf(updateContents));

        JSONObject patchResult = updateManager(applierWriting(TARGET_BUNDLE)).downloadPackage(
                updatePackageWithAssetDiff(updateHash, fullUrl, patchUrl, diffUrl), BUNDLE_FILE_NAME, ignoreProgress());

        assertEquals(Arrays.asList("/missing-diff.zip", "/full.zip"), mServer.requestedPaths());
        assertFallbackResult(patchResult, null);
        assertEquals("asset-diff", patchResult.optString("archive", null));
        assertEquals(1, patchResult.optJSONArray("attempts").length());
        assertInstalledContents(updateHash, updateContents);
    }

    @Test
    public void installsFromThePatchArchiveWhenTheAssetDiffUrlIsAnEmptyString() throws IOException {
        // An empty slot is not an archive on offer. Attempting it would fail for want of a
        // URL and leave no verdict behind, which is what skips the patch archive - so the
        // update would be downloaded in full with a perfectly good patch archive untried.
        String patchUrl = serve("/patch.zip", zipOf(patchArchiveContents()));
        String fullUrl = serve("/full.zip", zipOf(fullArchiveContents()));

        JSONObject patchResult = updateManager(applierWriting(TARGET_BUNDLE)).downloadPackage(
                updatePackageWithAssetDiff(mPackageHash, fullUrl, patchUrl, ""), BUNDLE_FILE_NAME, ignoreProgress());

        assertEquals("the empty diff slot is not downloaded and does not cost the patch archive its try",
                Arrays.asList("/patch.zip"), mServer.requestedPaths());
        assertEquals("applied", patchResult.optString("status", null));
        assertEquals("binary-patch", patchResult.optString("archive", null));
        assertEquals(1, patchResult.optJSONArray("attempts").length());
        assertInstalledContents();
    }

    @Test
    public void leavesAFileOutsideThePackageFolderAloneWhenTheAssetDiffManifestNamesIt() throws IOException {
        // A manifest entry that climbs out of the package folder: the client is not the one
        // that wrote it, so it must not act on it.
        installBaseUpdate();
        File fileOutsideThePackage = mTemporaryFolder.newFile("keep-me.txt");
        Map<String, byte[]> updateContents = assetDiffTargetContents();
        String updateHash = packageHashOf(updateContents);
        String diffUrl = serve("/diff.zip",
                zipOf(assetDiffArchiveContents(DROPPED_ASSET_PATH, CONTENTS_DIR_NAME + "/../../../keep-me.txt")));
        String fullUrl = serve("/full.zip", zipOf(updateContents));

        JSONObject patchResult = updateManager(applierWriting(TARGET_BUNDLE))
                .downloadPackage(updatePackage(updateHash, fullUrl, diffUrl), BUNDLE_FILE_NAME, ignoreProgress());

        assertTrue("a manifest entry reaching outside the package folder deleted " + fileOutsideThePackage,
                fileOutsideThePackage.exists());
        // Skipping it costs the update nothing, so the diff still installs.
        assertEquals("applied", patchResult.optString("status", null));
        assertInstalledContents(updateHash, updateContents);
    }

    @Test
    public void announcesEachDownloadOfAFallbackAsItsOwnProgressStream() throws IOException {
        byte[] fullArchive = zipOf(fullArchiveContents());
        String patchUrl = serve("/patch.zip", ERROR_PAGE);
        String fullUrl = serve("/full.zip", fullArchive);
        final List<List<Long>> streams = new ArrayList<>();
        final List<Long> completedBytes = new ArrayList<>();

        updateManager(applierWriting(TARGET_BUNDLE)).downloadPackage(
                updatePackage(fullUrl, patchUrl), BUNDLE_FILE_NAME, new DownloadProgressCallback() {
                    @Override
                    public void onDownloadStart() {
                        streams.add(new ArrayList<Long>());
                    }

                    @Override
                    public void call(DownloadProgress downloadProgress) {
                        streams.get(streams.size() - 1).add(downloadProgress.getReceivedBytes());
                        if (downloadProgress.isCompleted()) {
                            completedBytes.add(downloadProgress.getReceivedBytes());
                        }
                    }
                });

        assertEquals("each download announces a stream of its own", 2, streams.size());
        for (List<Long> stream : streams) {
            assertEquals("a stream opens by putting its total on the table at zero received",
                    Long.valueOf(0), stream.get(0));
            for (int i = 1; i < stream.size(); i++) {
                assertTrue("a stream never runs backwards", stream.get(i) >= stream.get(i - 1));
            }
        }
        assertEquals("both downloads complete at the size of the body they served",
                Arrays.asList((long) ERROR_PAGE.length, (long) fullArchive.length), completedBytes);
    }

    /** The result of a download the update had to be downloaded in full for. */
    private static void assertFallbackResult(JSONObject patchResult, String expectedReason) {
        assertEquals("fallback", patchResult.optString("status", null));
        assertEquals(expectedReason, patchResult.optString("fallbackReason", null));
        assertTrue("the whole path is timed", patchResult.optLong("totalDurationMs", -1) >= 0);
        assertFalse("the result no longer carries a top level apply time", patchResult.has("applyDurationMs"));
    }

    /** The installed update is the full archive's contents, whichever archive it came from. */
    private void assertInstalledContents() throws IOException {
        File contentsFolder = new File(mPackageFolder, CONTENTS_DIR_NAME);
        assertArrayEquals(TARGET_BUNDLE, readFile(new File(contentsFolder, BUNDLE_FILE_NAME)));
        assertArrayEquals(ASSET, readFile(new File(contentsFolder, ASSET_PATH)));
        assertFalse(new File(contentsFolder, CodePushConstants.BINARY_PATCH_MANIFEST_FILE_NAME).exists());
        assertFalse(new File(contentsFolder, BUNDLE_FILE_NAME + ".patch").exists());

        // Written last, so its presence also says the folder hash check passed.
        JSONObject metadata = CodePushUtils.getJsonObjectFromFile(
                new File(mPackageFolder, CodePushConstants.PACKAGE_FILE_NAME).getAbsolutePath());
        String bundlePath = metadata.optString(CodePushConstants.RELATIVE_BUNDLE_PATH_KEY, null);
        assertTrue("the metadata points at the restored bundle, but says " + bundlePath,
                bundlePath != null && bundlePath.endsWith(CONTENTS_DIR_NAME + "/" + BUNDLE_FILE_NAME));
        // How the update was downloaded says nothing about the update, so it is not part of
        // what the update is installed from and outlives the download in no file.
        assertFalse("the patch attempt reached the stored metadata",
                metadata.has(CodePushConstants.UPDATE_ARCHIVE_RESULT_KEY));

        File binaryPatchFolder = new File(
                new File(mDocumentsDirectory, CodePushConstants.CODE_PUSH_FOLDER_PREFIX),
                CodePushConstants.BINARY_PATCH_FOLDER_NAME);
        assertFalse(binaryPatchFolder.exists());
    }

    /**
     * The update installed under a hash is these contents and nothing else, which is the
     * whole question for an update that was rebuilt from parts of two archives.
     */
    private void assertInstalledContents(String packageHash, Map<String, byte[]> expectedContents) throws IOException {
        File packageFolder = new File(new File(mDocumentsDirectory, CodePushConstants.CODE_PUSH_FOLDER_PREFIX), packageHash);
        Map<String, byte[]> installedFiles = filesUnder(packageFolder, "");
        // Written last, so its presence also says the folder hash check passed.
        assertTrue("the update is installed without its metadata",
                installedFiles.remove(CodePushConstants.PACKAGE_FILE_NAME) != null);

        assertEquals("the installed files", new TreeSet<>(expectedContents.keySet()), installedFiles.keySet());
        for (Map.Entry<String, byte[]> expectedFile : expectedContents.entrySet()) {
            assertArrayEquals("the contents of " + expectedFile.getKey(),
                    expectedFile.getValue(), installedFiles.get(expectedFile.getKey()));
        }
    }

    /** Every file in a folder, keyed by its path relative to that folder. */
    private static Map<String, byte[]> filesUnder(File folder, String pathPrefix) throws IOException {
        Map<String, byte[]> files = new TreeMap<>();
        File[] entries = folder.listFiles();
        if (entries == null) {
            return files;
        }

        for (File entry : entries) {
            String relativePath = pathPrefix.isEmpty() ? entry.getName() : pathPrefix + "/" + entry.getName();
            if (entry.isDirectory()) {
                files.putAll(filesUnder(entry, relativePath));
            } else {
                files.put(relativePath, readFile(entry));
            }
        }

        return files;
    }

    /**
     * Downloads an update in full and makes it the current package, which is what the asset
     * diff of a later release is merged into.
     */
    private void installBaseUpdate() throws IOException {
        Map<String, byte[]> contents = installedArchiveContents();
        JSONObject installedPackage = fullUpdatePackage(
                packageHashOf(contents), serve("/installed.zip", zipOf(contents)));

        CodePushUpdateManager updateManager = updateManager(applierWriting(TARGET_BUNDLE));
        updateManager.downloadPackage(installedPackage, BUNDLE_FILE_NAME, ignoreProgress());
        updateManager.installPackage(installedPackage, false);
    }

    private CodePushUpdateManager updateManager(CodePushBinaryPatch.PatchApplier applier) {
        CodePushBinaryPatch binaryPatch = new CodePushBinaryPatch(new CodePushBinaryPatch.BaseBundleProvider() {
            @Override
            public byte[] readBaseBundle(String bundleFileName) {
                return BASE_BUNDLE;
            }
        }, applier);

        return new CodePushUpdateManager(mDocumentsDirectory, binaryPatch);
    }

    private static CodePushBinaryPatch.PatchApplier applierWriting(final byte[] restoredBundle) {
        return new CodePushBinaryPatch.PatchApplier() {
            @Override
            public int apply(byte[] base, byte[] patch, String outputPath, long expectedTargetSize) {
                assertArrayEquals(BASE_BUNDLE, base);
                assertArrayEquals(PATCH, patch);
                try {
                    writeFile(new File(outputPath), restoredBundle);
                } catch (IOException e) {
                    return RESULT_IO_ERROR;
                }

                return RESULT_OK;
            }
        };
    }

    private Map<String, byte[]> fullArchiveContents() {
        Map<String, byte[]> contents = new LinkedHashMap<>();
        contents.put(CONTENTS_DIR_NAME + "/" + BUNDLE_FILE_NAME, TARGET_BUNDLE);
        contents.put(CONTENTS_DIR_NAME + "/" + ASSET_PATH, ASSET);
        return contents;
    }

    private Map<String, byte[]> patchArchiveContents() {
        JSONObject manifest = new JSONObject();
        CodePushUtils.setJSONValueForKey(manifest, CodePushConstants.BINARY_PATCH_FORMAT_VERSION_KEY,
                CodePushConstants.BINARY_PATCH_FORMAT_VERSION);
        CodePushUtils.setJSONValueForKey(manifest, CodePushConstants.BINARY_PATCH_ALGORITHM_KEY,
                CodePushConstants.BINARY_PATCH_ALGORITHM);
        CodePushUtils.setJSONValueForKey(manifest, CodePushConstants.BINARY_PATCH_BUNDLE_PATH_KEY, BUNDLE_FILE_NAME);
        CodePushUtils.setJSONValueForKey(manifest, CodePushConstants.BINARY_PATCH_FILE_KEY, BUNDLE_FILE_NAME + ".patch");
        CodePushUtils.setJSONValueForKey(manifest, CodePushConstants.BINARY_PATCH_BASE_BUNDLE_HASH_KEY, sha256(BASE_BUNDLE));
        CodePushUtils.setJSONValueForKey(manifest, CodePushConstants.BINARY_PATCH_TARGET_BUNDLE_HASH_KEY, sha256(TARGET_BUNDLE));
        CodePushUtils.setJSONValueForKey(manifest, CodePushConstants.BINARY_PATCH_TARGET_BUNDLE_SIZE_KEY, TARGET_BUNDLE.length);

        Map<String, byte[]> contents = new LinkedHashMap<>();
        contents.put(CONTENTS_DIR_NAME + "/" + CodePushConstants.BINARY_PATCH_MANIFEST_FILE_NAME, bytes(manifest.toString()));
        contents.put(CONTENTS_DIR_NAME + "/" + BUNDLE_FILE_NAME + ".patch", PATCH);
        contents.put(CONTENTS_DIR_NAME + "/" + ASSET_PATH, ASSET);
        return contents;
    }

    /** The full archive of the release that is installed when the asset diff arrives. */
    private Map<String, byte[]> installedArchiveContents() {
        Map<String, byte[]> contents = new LinkedHashMap<>();
        contents.put(CONTENTS_DIR_NAME + "/" + BUNDLE_FILE_NAME, INSTALLED_BUNDLE);
        contents.put(CONTENTS_DIR_NAME + "/" + ASSET_PATH, ASSET);
        contents.put(CONTENTS_DIR_NAME + "/" + DROPPED_ASSET_PATH, DROPPED_ASSET);
        return contents;
    }

    /**
     * An asset diff archive: the patch archive carrying only the assets the update changes,
     * plus the manifest of the files to delete at the archive root, beside the contents
     * directory the manifest's paths are relative to. An asset the installed package already
     * holds unchanged is not shipped at all - the client copies it over.
     */
    private Map<String, byte[]> assetDiffArchiveContents(String deletedAssetPath) {
        return assetDiffArchiveContentsWithManifest(
                bytes("{\"deletedFiles\":[\"" + CONTENTS_DIR_NAME + "/" + deletedAssetPath + "\"]}"));
    }

    /** The same archive carrying a manifest of its own, which is how one the CLI did not write arrives. */
    private Map<String, byte[]> assetDiffArchiveContentsWithManifest(byte[] manifest) {
        Map<String, byte[]> contents = patchArchiveContents();
        contents.remove(CONTENTS_DIR_NAME + "/" + ASSET_PATH);
        contents.put(CONTENTS_DIR_NAME + "/" + ADDED_ASSET_PATH, ADDED_ASSET);
        contents.put(CodePushConstants.DIFF_MANIFEST_FILE_NAME, manifest);
        return contents;
    }

    /** The same archive, with one more path in its manifest of the files to delete. */
    private Map<String, byte[]> assetDiffArchiveContents(String deletedAssetPath, String otherDeletedPath) {
        Map<String, byte[]> contents = assetDiffArchiveContents(deletedAssetPath);
        contents.put(CodePushConstants.DIFF_MANIFEST_FILE_NAME,
                bytes("{\"deletedFiles\":[\"" + CONTENTS_DIR_NAME + "/" + deletedAssetPath + "\",\"" + otherDeletedPath + "\"]}"));
        return contents;
    }

    /** The patch archive of the release the asset diff belongs to: every asset, no merge. */
    private Map<String, byte[]> patchArchiveContentsForAssetDiffTarget() {
        Map<String, byte[]> contents = patchArchiveContents();
        contents.put(CONTENTS_DIR_NAME + "/" + ADDED_ASSET_PATH, ADDED_ASSET);
        return contents;
    }

    /** What an asset diff has to add up to: the contents of the update's full archive. */
    private Map<String, byte[]> assetDiffTargetContents() {
        Map<String, byte[]> contents = fullArchiveContents();
        contents.put(CONTENTS_DIR_NAME + "/" + ADDED_ASSET_PATH, ADDED_ASSET);
        return contents;
    }

    private JSONObject updatePackage(String downloadUrl, String binaryPatchDownloadUrl) {
        return updatePackage(mPackageHash, downloadUrl, binaryPatchDownloadUrl);
    }

    private JSONObject updatePackage(String packageHash, String downloadUrl, String binaryPatchDownloadUrl) {
        JSONObject updatePackage = fullUpdatePackage(packageHash, downloadUrl);
        CodePushUtils.setJSONValueForKey(updatePackage, CodePushConstants.BINARY_PATCH_DOWNLOAD_URL_KEY, binaryPatchDownloadUrl);
        return updatePackage;
    }

    /** A release offering all three archives, the diff in the slot of its own the JS fills. */
    private JSONObject updatePackageWithAssetDiff(String packageHash, String downloadUrl,
                                                  String binaryPatchDownloadUrl, String assetDiffDownloadUrl) {
        JSONObject updatePackage = updatePackage(packageHash, downloadUrl, binaryPatchDownloadUrl);
        CodePushUtils.setJSONValueForKey(updatePackage, CodePushConstants.ASSET_DIFF_DOWNLOAD_URL_KEY, assetDiffDownloadUrl);
        return updatePackage;
    }

    /** A release with no second archive to try, so it is downloaded in full. */
    private JSONObject fullUpdatePackage(String packageHash, String downloadUrl) {
        JSONObject updatePackage = new JSONObject();
        CodePushUtils.setJSONValueForKey(updatePackage, CodePushConstants.PACKAGE_HASH_KEY, packageHash);
        CodePushUtils.setJSONValueForKey(updatePackage, CodePushConstants.DOWNLOAD_URL_KEY, downloadUrl);
        return updatePackage;
    }

    private String serve(String path, byte[] body) {
        return mServer.serve(path, body);
    }

    /**
     * Serves the archives over a loopback socket, so the download really goes through
     * `HttpURLConnection` the way it does on a device. Written on a plain socket rather than
     * against an HTTP library because a unit test here has neither the JDK's server nor a
     * dependency that could stand in for it.
     */
    private static class TestArchiveServer {

        private final ServerSocket mSocket;
        private final Map<String, byte[]> mBodies = new HashMap<>();
        private final List<String> mRequestedPaths = Collections.synchronizedList(new ArrayList<String>());

        TestArchiveServer() throws IOException {
            mSocket = new ServerSocket(0, 0, InetAddress.getByName("127.0.0.1"));
            Thread serverThread = new Thread(new Runnable() {
                @Override
                public void run() {
                    serveUntilClosed();
                }
            });
            serverThread.setDaemon(true);
            serverThread.start();
        }

        synchronized String serve(String path, byte[] body) {
            mBodies.put(path, body);
            return urlOf(path);
        }

        /** The URL of a path this server answers - with a 404, when nothing is served there. */
        String urlOf(String path) {
            return "http://127.0.0.1:" + mSocket.getLocalPort() + path;
        }

        List<String> requestedPaths() {
            return new ArrayList<>(mRequestedPaths);
        }

        void close() throws IOException {
            mSocket.close();
        }

        private void serveUntilClosed() {
            while (!mSocket.isClosed()) {
                Socket connection;
                try {
                    connection = mSocket.accept();
                } catch (IOException e) {
                    // The socket was closed while waiting, which is how the test ends.
                    return;
                }

                try {
                    try {
                        respond(connection);
                    } finally {
                        connection.close();
                    }
                } catch (IOException e) {
                    // A broken connection is the client's business, not the server's.
                }
            }
        }

        private void respond(Socket connection) throws IOException {
            BufferedReader request = new BufferedReader(
                    new InputStreamReader(connection.getInputStream(), Charset.forName("UTF-8")));
            String requestLine = request.readLine();
            for (String header = request.readLine(); header != null && !header.isEmpty(); header = request.readLine()) {
                // The headers are read to the blank line so the request is fully consumed.
            }

            String path = requestLine == null ? "" : requestLine.split(" ")[1];
            mRequestedPaths.add(path);
            byte[] body = bodyFor(path);

            OutputStream response = connection.getOutputStream();
            if (body == null) {
                response.write(bytes("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"));
            } else {
                response.write(bytes("HTTP/1.1 200 OK\r\nContent-Length: " + body.length
                        + "\r\nConnection: close\r\n\r\n"));
                response.write(body);
            }
            response.flush();
            // Half-close and wait for the client to hang up, so the response is not cut off
            // by closing the socket underneath it.
            connection.shutdownOutput();
            while (connection.getInputStream().read() >= 0) {
                // Drains whatever the client sends before it closes.
            }
        }

        private synchronized byte[] bodyFor(String path) {
            return mBodies.get(path);
        }
    }

    private static byte[] zipOf(Map<String, byte[]> contents) throws IOException {
        ByteArrayOutputStream archive = new ByteArrayOutputStream();
        ZipOutputStream zipStream = new ZipOutputStream(archive);
        try {
            for (Map.Entry<String, byte[]> entry : contents.entrySet()) {
                zipStream.putNextEntry(new ZipEntry(entry.getKey()));
                zipStream.write(entry.getValue());
                zipStream.closeEntry();
            }
        } finally {
            zipStream.close();
        }

        return archive.toByteArray();
    }

    /**
     * The package hash of update contents, computed the way the CLI computes it: the sorted
     * `<relative path>:<sha256>` entries, stringified as a JSON array, hashed.
     */
    private static String packageHashOf(Map<String, byte[]> contents) {
        List<String> manifest = new ArrayList<>();
        for (Map.Entry<String, byte[]> entry : contents.entrySet()) {
            manifest.add(entry.getKey() + ":" + sha256(entry.getValue()));
        }
        Collections.sort(manifest);

        StringBuilder entries = new StringBuilder("[");
        for (int i = 0; i < manifest.size(); i++) {
            if (i > 0) {
                entries.append(",");
            }
            entries.append('"').append(manifest.get(i)).append('"');
        }
        entries.append("]");

        return sha256(bytes(entries.toString()));
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

    private static void writeFile(File file, byte[] contents) throws IOException {
        OutputStream output = new FileOutputStream(file);
        try {
            output.write(contents);
        } finally {
            output.close();
        }
    }

    private static byte[] readFile(File file) throws IOException {
        byte[] contents = new byte[(int) file.length()];
        InputStream input = new FileInputStream(file);
        try {
            int offset = 0;
            while (offset < contents.length) {
                int bytesRead = input.read(contents, offset, contents.length - offset);
                if (bytesRead < 0) {
                    throw new IOException("Unexpected end of " + file);
                }
                offset += bytesRead;
            }
        } finally {
            input.close();
        }

        return contents;
    }

    private static byte[] bytes(String text) {
        return text.getBytes(Charset.forName("UTF-8"));
    }

    private static String sha256(byte[] data) {
        MessageDigest digest;
        try {
            digest = MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }

        StringBuilder hex = new StringBuilder();
        for (byte hashByte : digest.digest(data)) {
            hex.append(String.format("%02x", hashByte));
        }

        return hex.toString();
    }
}
