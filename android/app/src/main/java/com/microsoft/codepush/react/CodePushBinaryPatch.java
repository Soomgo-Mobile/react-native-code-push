package com.microsoft.codepush.react;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Rebuilds the JS bundle of an update that was downloaded as a binary patch archive.
 *
 * A patch archive holds everything the full archive holds except the JS bundle, which it
 * carries as a patch against the bundle that shipped inside the app binary, plus a
 * manifest describing how to rebuild it. Restoring means applying that patch, verifying
 * the result, moving it to where the bundle belongs and deleting the two patch-only
 * files. What is left is byte for byte the contents of the full archive, so the folder
 * hash check that follows the install is unchanged and stays the last line of defence.
 *
 * Nothing here trusts the patch. Neither the diff format nor the zstd streams inside it
 * carry a checksum of the data they produce, so an apply that reports success is not
 * proof of a correct result: a base bundle of the right size but the wrong content, or a
 * corrupted patch body, both produce wrong bytes without any error. The base bundle is
 * hashed before the patch is applied and the restored bundle is hashed afterwards, and
 * the restored bytes only reach the update contents once both checks have passed.
 *
 * Every failure is reported as a {@link BinaryPatchResult}, never as an exception: the
 * caller answers all of them the same way, by downloading the full archive instead.
 */
public class CodePushBinaryPatch {

    /** Reads the JS bundle that shipped inside the app binary. */
    public interface BaseBundleProvider {
        byte[] readBaseBundle(String bundleFileName) throws IOException;
    }

    /**
     * Applies a patch to a base bundle and writes the restored bundle to a file.
     *
     * The result codes are the ones the native applier returns, so they have to stay in
     * step with the codes in the JNI wrapper.
     */
    public interface PatchApplier {
        int RESULT_OK = 0;
        int RESULT_INVALID_ARGUMENT = 1;
        int RESULT_IO_ERROR = 2;
        int RESULT_INVALID_HEADER = 3;
        int RESULT_UNSUPPORTED_COMPRESSION = 4;
        int RESULT_SIZE_MISMATCH = 5;
        int RESULT_APPLY_FAILED = 6;
        /** Reported by the wrapper itself, when the native library could not be loaded. */
        int RESULT_LIBRARY_UNAVAILABLE = 7;

        int apply(byte[] base, byte[] patch, String outputPath, long expectedTargetSize);
    }

    private static final int COPY_BUFFER_SIZE = 1024 * 8;

    private final BaseBundleProvider mBaseBundleProvider;
    private final PatchApplier mPatchApplier;

    public CodePushBinaryPatch(BaseBundleProvider baseBundleProvider, PatchApplier patchApplier) {
        mBaseBundleProvider = baseBundleProvider;
        mPatchApplier = patchApplier;
    }

    /**
     * Turns the contents of a downloaded patch archive into the contents of the full one.
     *
     * @param unzippedFolderPath   the unzipped archive, which is modified in place
     * @param workingFolderPath    scratch directory for the restored bundle, emptied before
     *                             and after the attempt so an interrupted run leaves nothing
     * @param baseBundleFileName   name of the JS bundle inside the app binary
     */
    public BinaryPatchResult restoreBundle(String unzippedFolderPath, String workingFolderPath, String baseBundleFileName) {
        File contentsFolder = resolveContentsFolder(new File(unzippedFolderPath));
        File manifestFile = new File(contentsFolder, CodePushConstants.BINARY_PATCH_MANIFEST_FILE_NAME);
        if (!manifestFile.isFile()) {
            return BinaryPatchResult.failure(BinaryPatchResult.REASON_INVALID_MANIFEST);
        }

        JSONObject manifest;
        try {
            manifest = CodePushUtils.getJsonObjectFromFile(manifestFile.getAbsolutePath());
        } catch (IOException | CodePushMalformedDataException e) {
            CodePushUtils.log(e);
            return BinaryPatchResult.failure(BinaryPatchResult.REASON_INVALID_MANIFEST);
        }

        if (manifest.optInt(CodePushConstants.BINARY_PATCH_FORMAT_VERSION_KEY, -1) != CodePushConstants.BINARY_PATCH_FORMAT_VERSION
                || !CodePushConstants.BINARY_PATCH_ALGORITHM.equals(manifest.optString(CodePushConstants.BINARY_PATCH_ALGORITHM_KEY, null))) {
            return BinaryPatchResult.failure(BinaryPatchResult.REASON_UNSUPPORTED_FORMAT);
        }

        File targetBundleFile = resolveInsideFolder(contentsFolder, manifest.optString(CodePushConstants.BINARY_PATCH_BUNDLE_PATH_KEY, null));
        File patchFile = resolveInsideFolder(contentsFolder, manifest.optString(CodePushConstants.BINARY_PATCH_FILE_KEY, null));
        String baseBundleHash = manifest.optString(CodePushConstants.BINARY_PATCH_BASE_BUNDLE_HASH_KEY, null);
        String targetBundleHash = manifest.optString(CodePushConstants.BINARY_PATCH_TARGET_BUNDLE_HASH_KEY, null);
        long targetBundleSize = manifest.optLong(CodePushConstants.BINARY_PATCH_TARGET_BUNDLE_SIZE_KEY, -1);
        if (targetBundleFile == null || patchFile == null || !patchFile.isFile()
                || isNullOrEmpty(baseBundleHash) || isNullOrEmpty(targetBundleHash)
                || targetBundleSize <= 0 || targetBundleSize > CodePushConstants.BINARY_PATCH_MAX_TARGET_BUNDLE_SIZE) {
            return BinaryPatchResult.failure(BinaryPatchResult.REASON_INVALID_MANIFEST);
        }

        // An earlier attempt that was killed while patching leaves its restored bundle behind.
        FileUtils.deleteDirectoryAtPath(workingFolderPath);
        File workingFolder = new File(workingFolderPath);
        if (!workingFolder.mkdirs()) {
            CodePushUtils.log("Unable to create the binary patch working directory at " + workingFolderPath);
            return BinaryPatchResult.failure(BinaryPatchResult.REASON_PATCH_APPLY_FAILED);
        }

        try {
            if (workingFolder.getUsableSpace() < targetBundleSize) {
                CodePushUtils.log("Not enough free space to restore a " + targetBundleSize + " byte bundle.");
                return BinaryPatchResult.failure(BinaryPatchResult.REASON_PATCH_APPLY_FAILED);
            }

            byte[] baseBundle;
            try {
                baseBundle = mBaseBundleProvider.readBaseBundle(baseBundleFileName);
            } catch (Exception e) {
                CodePushUtils.log(e);
                return BinaryPatchResult.failure(BinaryPatchResult.REASON_BASE_BUNDLE_UNAVAILABLE);
            }
            if (baseBundle == null) {
                return BinaryPatchResult.failure(BinaryPatchResult.REASON_BASE_BUNDLE_UNAVAILABLE);
            }
            if (!baseBundleHash.equals(CodePushUpdateUtils.computeHashForBytes(baseBundle))) {
                return BinaryPatchResult.failure(BinaryPatchResult.REASON_BASE_HASH_MISMATCH);
            }

            byte[] patch;
            try {
                patch = readFile(patchFile);
            } catch (IOException e) {
                CodePushUtils.log(e);
                return BinaryPatchResult.failure(BinaryPatchResult.REASON_PATCH_APPLY_FAILED);
            }

            File restoredBundleFile = new File(workingFolder, CodePushConstants.BINARY_PATCH_TARGET_FILE_NAME);
            int resultCode = mPatchApplier.apply(baseBundle, patch, restoredBundleFile.getAbsolutePath(), targetBundleSize);
            if (resultCode != PatchApplier.RESULT_OK) {
                CodePushUtils.log("The binary patch applier returned " + resultCode + ".");
                return BinaryPatchResult.failure(reasonForResultCode(resultCode));
            }

            if (restoredBundleFile.length() != targetBundleSize) {
                return BinaryPatchResult.failure(BinaryPatchResult.REASON_TARGET_VERIFICATION_FAILED);
            }
            String restoredBundleHash;
            try {
                restoredBundleHash = CodePushUpdateUtils.computeHashForFile(restoredBundleFile);
            } catch (IOException e) {
                CodePushUtils.log(e);
                return BinaryPatchResult.failure(BinaryPatchResult.REASON_TARGET_VERIFICATION_FAILED);
            }
            if (!targetBundleHash.equals(restoredBundleHash)) {
                return BinaryPatchResult.failure(BinaryPatchResult.REASON_TARGET_VERIFICATION_FAILED);
            }

            if (!moveFile(restoredBundleFile, targetBundleFile) || !patchFile.delete() || !manifestFile.delete()) {
                // The contents are half restored, so they must not be installed. The full
                // archive that follows unzips over them, which is what clears them.
                CodePushUtils.log("Unable to put the restored bundle in place of the patch.");
                return BinaryPatchResult.failure(BinaryPatchResult.REASON_PATCH_APPLY_FAILED);
            }

            return BinaryPatchResult.success();
        } finally {
            FileUtils.deleteDirectoryAtPath(workingFolderPath);
        }
    }

    /**
     * Finds the contents root inside an unzipped archive.
     *
     * An archive wraps its files in a single directory, and the manifest's paths are
     * relative to that directory rather than to the archive. An archive whose files are at
     * the top level is its own contents root, which is how the tooling that unpacks one
     * reads it too.
     */
    private static File resolveContentsFolder(File unzippedFolder) {
        File[] entries = unzippedFolder.listFiles();
        if (entries != null && entries.length == 1 && entries[0].isDirectory()) {
            return entries[0];
        }

        return unzippedFolder;
    }

    /**
     * Resolves a path the manifest points at, refusing anything that would reach outside
     * the archive - an archive is untrusted input, and its manifest is no more trusted
     * than its entries.
     *
     * @return the resolved file, or null when the path is unusable
     */
    private static File resolveInsideFolder(File folder, String relativePath) {
        if (isNullOrEmpty(relativePath) || new File(relativePath).isAbsolute()) {
            return null;
        }

        try {
            String folderPath = folder.getCanonicalPath() + File.separator;
            String resolvedPath = new File(folder, relativePath).getCanonicalPath();
            if (!resolvedPath.startsWith(folderPath)) {
                return null;
            }

            return new File(resolvedPath);
        } catch (IOException e) {
            CodePushUtils.log(e);
            return null;
        }
    }

    private static String reasonForResultCode(int resultCode) {
        return resultCode == PatchApplier.RESULT_UNSUPPORTED_COMPRESSION
                ? BinaryPatchResult.REASON_UNSUPPORTED_FORMAT
                : BinaryPatchResult.REASON_PATCH_APPLY_FAILED;
    }

    /** Rename, falling back to a copy for the case where the two paths are on different volumes. */
    private static boolean moveFile(File sourceFile, File destinationFile) {
        File destinationFolder = destinationFile.getParentFile();
        if (destinationFolder != null && !destinationFolder.exists() && !destinationFolder.mkdirs()) {
            return false;
        }

        if (sourceFile.renameTo(destinationFile)) {
            return true;
        }

        try {
            copyFile(sourceFile, destinationFile);
        } catch (IOException e) {
            CodePushUtils.log(e);
            return false;
        }

        return sourceFile.delete();
    }

    private static void copyFile(File sourceFile, File destinationFile) throws IOException {
        InputStream input = new FileInputStream(sourceFile);
        try {
            OutputStream output = new FileOutputStream(destinationFile);
            try {
                byte[] buffer = new byte[COPY_BUFFER_SIZE];
                int bytesRead;
                while ((bytesRead = input.read(buffer)) > 0) {
                    output.write(buffer, 0, bytesRead);
                }
            } finally {
                output.close();
            }
        } finally {
            input.close();
        }
    }

    private static byte[] readFile(File file) throws IOException {
        long fileSize = file.length();
        if (fileSize <= 0 || fileSize > Integer.MAX_VALUE) {
            throw new IOException("Cannot read " + file.getAbsolutePath() + ", it is " + fileSize + " bytes long.");
        }

        byte[] contents = new byte[(int) fileSize];
        InputStream input = new FileInputStream(file);
        try {
            int offset = 0;
            while (offset < contents.length) {
                int bytesRead = input.read(contents, offset, contents.length - offset);
                if (bytesRead < 0) {
                    throw new IOException("Unexpected end of " + file.getAbsolutePath() + ".");
                }
                offset += bytesRead;
            }
        } finally {
            input.close();
        }

        return contents;
    }

    private static boolean isNullOrEmpty(String value) {
        return value == null || value.isEmpty();
    }
}
