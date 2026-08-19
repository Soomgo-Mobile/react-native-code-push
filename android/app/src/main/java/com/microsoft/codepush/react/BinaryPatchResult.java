package com.microsoft.codepush.react;

/**
 * Outcome of restoring an update from its binary patch archive.
 *
 * A failed result is not an error the user hears about: it is the signal to download the
 * update's full archive instead. The reason strings are the vocabulary the appliers of
 * every platform report, and the logs a rollout is judged from are read for exactly these
 * words, so they must not be reworded.
 */
public class BinaryPatchResult {

    /** The bundle inside the app binary could not be opened or read. */
    public static final String REASON_BASE_BUNDLE_UNAVAILABLE = "base_bundle_unavailable";

    /** The bundle inside the app binary is not the one the patch was computed against. */
    public static final String REASON_BASE_HASH_MISMATCH = "base_hash_mismatch";

    /** The manifest is missing, malformed, points outside the archive, or asks for too much. */
    public static final String REASON_INVALID_MANIFEST = "invalid_manifest";

    /** The patch was produced by a format or a codec this client cannot apply. */
    public static final String REASON_UNSUPPORTED_FORMAT = "unsupported_format";

    /** The applier refused the patch, or the restored bundle could not be written. */
    public static final String REASON_PATCH_APPLY_FAILED = "patch_apply_failed";

    /** The restored bundle is not the one the manifest promised. */
    public static final String REASON_TARGET_VERIFICATION_FAILED = "target_verification_failed";

    /**
     * The update restored from the patch did not pass the checks every update passes before
     * it is installed - the folder hash above all.
     *
     * This one is reported by the caller rather than by the applier: by the time it applies,
     * the applier has already handed back a bundle it was happy with.
     */
    public static final String REASON_PACKAGE_VERIFICATION_FAILED = "package_verification_failed";

    private final boolean mSucceeded;
    private final String mFailureReason;

    private BinaryPatchResult(boolean succeeded, String failureReason) {
        mSucceeded = succeeded;
        mFailureReason = failureReason;
    }

    public static BinaryPatchResult success() {
        return new BinaryPatchResult(true, null);
    }

    public static BinaryPatchResult failure(String failureReason) {
        return new BinaryPatchResult(false, failureReason);
    }

    public boolean succeeded() {
        return mSucceeded;
    }

    /** Why the full archive has to be downloaded instead, or null when the patch was applied. */
    public String getFailureReason() {
        return mFailureReason;
    }
}
