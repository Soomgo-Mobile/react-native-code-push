package com.microsoft.codepush.react;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.Charset;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

public class CodePushBinaryPatchTest {

    private static final String BUNDLE_FILE_NAME = "index.android.bundle";
    private static final String PATCH_FILE_NAME = BUNDLE_FILE_NAME + ".patch";

    private static final byte[] BASE_BUNDLE = bytes("the bundle inside the app binary");
    private static final byte[] TARGET_BUNDLE = bytes("the bundle the update wants to run");
    private static final byte[] PATCH = bytes("the difference between the two");

    @Rule
    public TemporaryFolder mTemporaryFolder = new TemporaryFolder();

    private File mContentsFolder;
    private File mWorkingFolder;
    private File mManifestFile;
    private File mPatchFile;
    private File mBundleFile;

    @Before
    public void setUp() throws IOException {
        mContentsFolder = mTemporaryFolder.newFolder("unzipped");
        mWorkingFolder = new File(mTemporaryFolder.getRoot(), CodePushConstants.BINARY_PATCH_FOLDER_NAME);
        mManifestFile = new File(mContentsFolder, CodePushConstants.BINARY_PATCH_MANIFEST_FILE_NAME);
        mPatchFile = new File(mContentsFolder, PATCH_FILE_NAME);
        mBundleFile = new File(mContentsFolder, BUNDLE_FILE_NAME);

        writeFile(mPatchFile, PATCH);
        writeManifest(validManifest());
    }

    @Test
    public void appliesAPatchAndLeavesTheContentsOfAFullArchiveBehind() throws IOException {
        FakePatchApplier applier = new FakePatchApplier(CodePushBinaryPatch.PatchApplier.RESULT_OK, TARGET_BUNDLE);

        BinaryPatchResult result = restoreBundle(BASE_BUNDLE, applier);

        assertTrue(result.succeeded());
        assertArrayEquals(TARGET_BUNDLE, readFile(mBundleFile));
        assertFalse("the patch file is not part of the update", mPatchFile.exists());
        assertFalse("the manifest is not part of the update", mManifestFile.exists());
        assertArrayEquals(BASE_BUNDLE, applier.base);
        assertArrayEquals(PATCH, applier.patch);
        assertEquals(TARGET_BUNDLE.length, applier.expectedTargetSize);
        assertNoTemporaryFilesLeft();
    }

    @Test
    public void removesWhatAnInterruptedAttemptLeftInTheWorkingDirectory() throws IOException {
        assertTrue(mWorkingFolder.mkdirs());
        writeFile(new File(mWorkingFolder, CodePushConstants.BINARY_PATCH_TARGET_FILE_NAME), bytes("half a bundle"));

        BinaryPatchResult result = restoreBundle(BASE_BUNDLE,
                new FakePatchApplier(CodePushBinaryPatch.PatchApplier.RESULT_OK, TARGET_BUNDLE));

        assertTrue(result.succeeded());
        assertArrayEquals(TARGET_BUNDLE, readFile(mBundleFile));
        assertNoTemporaryFilesLeft();
    }

    @Test
    public void reportsAnInvalidManifestWhenThereIsNone() {
        assertTrue(mManifestFile.delete());

        assertFailure(BinaryPatchResult.REASON_INVALID_MANIFEST, restoreBundle(BASE_BUNDLE, succeedingApplier()));
    }

    @Test
    public void reportsAnInvalidManifestWhenItIsNotJson() throws IOException {
        writeFile(mManifestFile, bytes("not json at all"));

        assertFailure(BinaryPatchResult.REASON_INVALID_MANIFEST, restoreBundle(BASE_BUNDLE, succeedingApplier()));
    }

    @Test
    public void reportsAnUnsupportedFormatForAnotherFormatVersion() throws IOException {
        writeManifest(putValue(validManifest(), CodePushConstants.BINARY_PATCH_FORMAT_VERSION_KEY,
                CodePushConstants.BINARY_PATCH_FORMAT_VERSION + 1));

        assertFailure(BinaryPatchResult.REASON_UNSUPPORTED_FORMAT, restoreBundle(BASE_BUNDLE, succeedingApplier()));
    }

    @Test
    public void reportsAnUnsupportedFormatForAnotherAlgorithm() throws IOException {
        writeManifest(putValue(validManifest(), CodePushConstants.BINARY_PATCH_ALGORITHM_KEY, "bsdiff-bz2"));

        assertFailure(BinaryPatchResult.REASON_UNSUPPORTED_FORMAT, restoreBundle(BASE_BUNDLE, succeedingApplier()));
    }

    @Test
    public void reportsAnInvalidManifestWhenTheBundlePathLeavesTheArchive() throws IOException {
        writeManifest(putValue(validManifest(), CodePushConstants.BINARY_PATCH_BUNDLE_PATH_KEY,
                "../" + BUNDLE_FILE_NAME));

        assertFailure(BinaryPatchResult.REASON_INVALID_MANIFEST, restoreBundle(BASE_BUNDLE, succeedingApplier()));
        assertFalse(new File(mTemporaryFolder.getRoot(), BUNDLE_FILE_NAME).exists());
    }

    @Test
    public void reportsAnInvalidManifestWhenThePatchPathLeavesTheArchive() throws IOException {
        writeFile(new File(mTemporaryFolder.getRoot(), PATCH_FILE_NAME), PATCH);
        writeManifest(putValue(validManifest(), CodePushConstants.BINARY_PATCH_FILE_KEY, "../" + PATCH_FILE_NAME));

        assertFailure(BinaryPatchResult.REASON_INVALID_MANIFEST, restoreBundle(BASE_BUNDLE, succeedingApplier()));
    }

    @Test
    public void reportsAnInvalidManifestWhenTheBundlePathIsAbsolute() throws IOException {
        writeManifest(putValue(validManifest(), CodePushConstants.BINARY_PATCH_BUNDLE_PATH_KEY,
                new File(mTemporaryFolder.getRoot(), BUNDLE_FILE_NAME).getAbsolutePath()));

        assertFailure(BinaryPatchResult.REASON_INVALID_MANIFEST, restoreBundle(BASE_BUNDLE, succeedingApplier()));
    }

    @Test
    public void reportsAnInvalidManifestWhenTheArchiveHasNoPatchFile() {
        assertTrue(mPatchFile.delete());

        assertFailure(BinaryPatchResult.REASON_INVALID_MANIFEST, restoreBundle(BASE_BUNDLE, succeedingApplier()));
    }

    @Test
    public void reportsAnInvalidManifestWhenTheTargetSizeIsEmpty() throws IOException {
        writeManifest(putValue(validManifest(), CodePushConstants.BINARY_PATCH_TARGET_BUNDLE_SIZE_KEY, 0));

        assertFailure(BinaryPatchResult.REASON_INVALID_MANIFEST, restoreBundle(BASE_BUNDLE, succeedingApplier()));
    }

    @Test
    public void reportsAnInvalidManifestWhenTheTargetSizeIsBeyondTheLimit() throws IOException {
        writeManifest(putValue(validManifest(), CodePushConstants.BINARY_PATCH_TARGET_BUNDLE_SIZE_KEY,
                CodePushConstants.BINARY_PATCH_MAX_TARGET_BUNDLE_SIZE + 1));

        assertFailure(BinaryPatchResult.REASON_INVALID_MANIFEST, restoreBundle(BASE_BUNDLE, succeedingApplier()));
    }

    @Test
    public void reportsAnUnavailableBaseBundleWhenTheBinaryBundleCannotBeRead() {
        CodePushBinaryPatch binaryPatch = new CodePushBinaryPatch(new CodePushBinaryPatch.BaseBundleProvider() {
            @Override
            public byte[] readBaseBundle(String bundleFileName) throws IOException {
                throw new IOException("no such asset: " + bundleFileName);
            }
        }, succeedingApplier());

        assertFailure(BinaryPatchResult.REASON_BASE_BUNDLE_UNAVAILABLE, restoreBundle(binaryPatch));
    }

    @Test
    public void reportsABaseHashMismatchWhenTheBinaryHoldsAnotherBundle() {
        FakePatchApplier applier = new FakePatchApplier(CodePushBinaryPatch.PatchApplier.RESULT_OK, TARGET_BUNDLE);

        BinaryPatchResult result = restoreBundle(bytes("a bundle from another app build"), applier);

        assertFailure(BinaryPatchResult.REASON_BASE_HASH_MISMATCH, result);
        assertEquals("a patch is not applied to a base it was not computed against", 0, applier.invocationCount);
    }

    @Test
    public void reportsAnUnsupportedFormatWhenTheApplierRejectsTheCodec() {
        BinaryPatchResult result = restoreBundle(BASE_BUNDLE,
                new FakePatchApplier(CodePushBinaryPatch.PatchApplier.RESULT_UNSUPPORTED_COMPRESSION, null));

        assertFailure(BinaryPatchResult.REASON_UNSUPPORTED_FORMAT, result);
    }

    @Test
    public void reportsAFailedApplyWhenThePatchHeaderIsCorrupt() {
        BinaryPatchResult result = restoreBundle(BASE_BUNDLE,
                new FakePatchApplier(CodePushBinaryPatch.PatchApplier.RESULT_INVALID_HEADER, null));

        assertFailure(BinaryPatchResult.REASON_PATCH_APPLY_FAILED, result);
        assertNoRestoredBundleInTheContents();
    }

    @Test
    public void reportsAFailedApplyWhenTheNativeLibraryIsMissing() {
        BinaryPatchResult result = restoreBundle(BASE_BUNDLE,
                new FakePatchApplier(CodePushBinaryPatch.PatchApplier.RESULT_LIBRARY_UNAVAILABLE, null));

        assertFailure(BinaryPatchResult.REASON_PATCH_APPLY_FAILED, result);
    }

    @Test
    public void reportsAFailedVerificationWhenTheRestoredBundleHasAnotherSize() {
        BinaryPatchResult result = restoreBundle(BASE_BUNDLE,
                new FakePatchApplier(CodePushBinaryPatch.PatchApplier.RESULT_OK, bytes("too short")));

        assertFailure(BinaryPatchResult.REASON_TARGET_VERIFICATION_FAILED, result);
        assertNoRestoredBundleInTheContents();
    }

    @Test
    public void reportsAFailedVerificationWhenTheRestoredBundleHasAnotherContent() {
        // A corrupted patch body applies without any error and produces wrong bytes, which
        // only the target hash catches.
        byte[] wrongBundle = TARGET_BUNDLE.clone();
        wrongBundle[0] = (byte) (wrongBundle[0] ^ 0xFF);

        BinaryPatchResult result = restoreBundle(BASE_BUNDLE,
                new FakePatchApplier(CodePushBinaryPatch.PatchApplier.RESULT_OK, wrongBundle));

        assertFailure(BinaryPatchResult.REASON_TARGET_VERIFICATION_FAILED, result);
        assertNoRestoredBundleInTheContents();
    }

    private BinaryPatchResult restoreBundle(byte[] baseBundle, CodePushBinaryPatch.PatchApplier applier) {
        return restoreBundle(new CodePushBinaryPatch(providerOf(baseBundle), applier));
    }

    private BinaryPatchResult restoreBundle(CodePushBinaryPatch binaryPatch) {
        return binaryPatch.restoreBundle(mContentsFolder.getAbsolutePath(), mWorkingFolder.getAbsolutePath(),
                BUNDLE_FILE_NAME);
    }

    private void assertFailure(String expectedReason, BinaryPatchResult result) {
        assertFalse(result.succeeded());
        assertEquals(expectedReason, result.getFailureReason());
        assertNoTemporaryFilesLeft();
    }

    private void assertNoTemporaryFilesLeft() {
        assertFalse("the working directory outlived the patch attempt", mWorkingFolder.exists());
    }

    /** The update must never be installed from bytes that did not pass verification. */
    private void assertNoRestoredBundleInTheContents() {
        assertFalse(mBundleFile.exists());
        assertTrue(mPatchFile.exists());
        assertTrue(mManifestFile.exists());
    }

    private JSONObject validManifest() {
        JSONObject manifest = new JSONObject();
        putValue(manifest, CodePushConstants.BINARY_PATCH_FORMAT_VERSION_KEY, CodePushConstants.BINARY_PATCH_FORMAT_VERSION);
        putValue(manifest, CodePushConstants.BINARY_PATCH_ALGORITHM_KEY, CodePushConstants.BINARY_PATCH_ALGORITHM);
        putValue(manifest, CodePushConstants.BINARY_PATCH_BUNDLE_PATH_KEY, BUNDLE_FILE_NAME);
        putValue(manifest, CodePushConstants.BINARY_PATCH_FILE_KEY, PATCH_FILE_NAME);
        putValue(manifest, CodePushConstants.BINARY_PATCH_BASE_BUNDLE_HASH_KEY, sha256(BASE_BUNDLE));
        putValue(manifest, CodePushConstants.BINARY_PATCH_TARGET_BUNDLE_HASH_KEY, sha256(TARGET_BUNDLE));
        putValue(manifest, CodePushConstants.BINARY_PATCH_TARGET_BUNDLE_SIZE_KEY, TARGET_BUNDLE.length);
        return manifest;
    }

    private static JSONObject putValue(JSONObject manifest, String key, Object value) {
        CodePushUtils.setJSONValueForKey(manifest, key, value);
        return manifest;
    }

    private void writeManifest(JSONObject manifest) throws IOException {
        writeFile(mManifestFile, bytes(manifest.toString()));
    }

    private static CodePushBinaryPatch.BaseBundleProvider providerOf(final byte[] baseBundle) {
        return new CodePushBinaryPatch.BaseBundleProvider() {
            @Override
            public byte[] readBaseBundle(String bundleFileName) {
                assertEquals(BUNDLE_FILE_NAME, bundleFileName);
                return baseBundle;
            }
        };
    }

    private static CodePushBinaryPatch.PatchApplier succeedingApplier() {
        return new FakePatchApplier(CodePushBinaryPatch.PatchApplier.RESULT_OK, TARGET_BUNDLE);
    }

    /** Stands in for the native applier, which is exercised on a device instead. */
    private static class FakePatchApplier implements CodePushBinaryPatch.PatchApplier {

        private final int mResultCode;
        private final byte[] mRestoredBundle;

        int invocationCount;
        byte[] base;
        byte[] patch;
        long expectedTargetSize;

        FakePatchApplier(int resultCode, byte[] restoredBundle) {
            mResultCode = resultCode;
            mRestoredBundle = restoredBundle;
        }

        @Override
        public int apply(byte[] base, byte[] patch, String outputPath, long expectedTargetSize) {
            this.invocationCount++;
            this.base = base;
            this.patch = patch;
            this.expectedTargetSize = expectedTargetSize;

            if (mRestoredBundle != null) {
                try {
                    writeFile(new File(outputPath), mRestoredBundle);
                } catch (IOException e) {
                    return RESULT_IO_ERROR;
                }
            }

            return mResultCode;
        }
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

    /** Hashes the way a manifest does, without going through the code under test. */
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
