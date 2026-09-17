package com.microsoft.codepush.react;

/**
 * The native HDiffPatch applier, which is what actually turns the bundle inside the app
 * binary into the bundle an update wants to run.
 *
 * The library is loaded on first use rather than when the class is loaded, and a load
 * failure is reported as a result code instead of an error: an app whose build did not
 * produce the library still has to install its updates, it just has to download them in
 * full.
 */
public class HDiffPatchNative implements CodePushBinaryPatch.PatchApplier {

    private static final String LIBRARY_NAME = "codepush-binarypatch";

    private static boolean sLibraryLoadAttempted = false;
    private static boolean sLibraryLoaded = false;

    @Override
    public int apply(byte[] base, byte[] patch, String outputPath, long expectedTargetSize) {
        if (!loadLibrary()) {
            return RESULT_LIBRARY_UNAVAILABLE;
        }

        return applyPatch(base, patch, outputPath, expectedTargetSize);
    }

    private static synchronized boolean loadLibrary() {
        if (!sLibraryLoadAttempted) {
            sLibraryLoadAttempted = true;
            try {
                System.loadLibrary(LIBRARY_NAME);
                sLibraryLoaded = true;
            } catch (UnsatisfiedLinkError e) {
                CodePushUtils.log("Unable to load the binary patch library: " + e.getMessage());
            }
        }

        return sLibraryLoaded;
    }

    /**
     * Writes the bundle that `patch` produces from `base` to `outputPath`.
     *
     * The base bundle and the patch are passed as arrays because the applier needs random
     * access to both, while the restored bundle is written straight to a file, so the two
     * bundles are never in memory at the same time.
     *
     * @return one of the RESULT_* codes of {@link CodePushBinaryPatch.PatchApplier}
     */
    private static native int applyPatch(byte[] base, byte[] patch, String outputPath, long expectedTargetSize);
}
