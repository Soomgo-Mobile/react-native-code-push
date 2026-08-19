package com.microsoft.codepush.react;

import org.json.JSONObject;

/**
 * The record of one attempt at installing an update from its binary patch archive: whether
 * the update was installed from the patch, why the full archive had to be downloaded when it
 * was not, and how long the work took.
 *
 * The record exists for an app that wants to judge a patch rollout with its own telemetry, so
 * it travels to whoever asked for the download and nowhere else. It is not part of the
 * update's metadata, it is never written to disk, and nothing here sends it anywhere.
 */
class BinaryPatchAttempt {

    private static final String APPLY_DURATION_MS_KEY = "applyDurationMs";
    private static final String FALLBACK_REASON_KEY = "fallbackReason";
    private static final String STATUS_KEY = "status";

    private static final String STATUS_APPLIED = "applied";
    private static final String STATUS_FALLBACK = "fallback";

    private final long mStartTimeMs = System.currentTimeMillis();

    /** How long the applier took, once it has restored the bundle. */
    private long mApplyDurationMs = -1;

    private boolean mFellBack;
    private String mFallbackReason;
    private long mAttemptDurationMs;

    /**
     * The applier restored the bundle. Whether the update installs is decided by the checks
     * that follow, so this is not yet the attempt succeeding.
     */
    void recordBundleRestored(long applyDurationMs) {
        mApplyDurationMs = applyDurationMs;
    }

    /**
     * The attempt ended in one of the reasons the appliers report.
     *
     * The attempt is timed here rather than when it is read, because what happens next is the
     * full archive being downloaded and that is not time the patch spent.
     */
    void recordFallback(String failureReason) {
        mFellBack = true;
        mFallbackReason = failureReason;
        mAttemptDurationMs = System.currentTimeMillis() - mStartTimeMs;
    }

    /**
     * The attempt ended in an error rather than in a verdict of its own.
     *
     * An error raised after the bundle was restored is the restored update failing the checks
     * that every update passes before it is installed. Before that point the appliers have no
     * word for what happened - the patch archive not being downloadable, say - and inventing
     * one here would put a value on the wire that no platform reports, so the fallback is
     * reported without a reason.
     */
    void recordFallbackAfterError() {
        recordFallback(bundleWasRestored() ? BinaryPatchResult.REASON_PACKAGE_VERIFICATION_FAILED : null);
    }

    private boolean bundleWasRestored() {
        return mApplyDurationMs >= 0;
    }

    /**
     * What the attempt ended in, as the app reads it.
     *
     * An attempt that never fell back is one the update was installed from, and it reports the
     * time the applier took. A fallback reports how long the attempt ran before it was given
     * up on, because there is no completed apply to time.
     */
    JSONObject result() {
        JSONObject result = new JSONObject();
        if (!mFellBack) {
            CodePushUtils.setJSONValueForKey(result, STATUS_KEY, STATUS_APPLIED);
            CodePushUtils.setJSONValueForKey(result, APPLY_DURATION_MS_KEY, Math.max(mApplyDurationMs, 0));
            return result;
        }

        CodePushUtils.setJSONValueForKey(result, STATUS_KEY, STATUS_FALLBACK);
        if (mFallbackReason != null) {
            CodePushUtils.setJSONValueForKey(result, FALLBACK_REASON_KEY, mFallbackReason);
        }

        CodePushUtils.setJSONValueForKey(result, APPLY_DURATION_MS_KEY, mAttemptDurationMs);
        return result;
    }
}
