package com.microsoft.codepush.react;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * The record of installing an update from its update archives: which archives were tried,
 * whether the update was installed from one of them, why the full archive had to be
 * downloaded when it was not, and how long the work took.
 *
 * The record exists for an app that wants to judge an archive rollout with its own telemetry,
 * so it travels to whoever asked for the download and nowhere else. It is not part of the
 * update's metadata, it is never written to disk, and nothing here sends it anywhere.
 */
class ArchiveAttemptLog {

    static final String ARCHIVE_ASSET_DIFF = "asset-diff";
    static final String ARCHIVE_BINARY_PATCH = "binary-patch";

    private static final String APPLY_DURATION_MS_KEY = "applyDurationMs";
    private static final String ARCHIVE_KEY = "archive";
    private static final String ATTEMPTS_KEY = "attempts";
    private static final String DURATION_MS_KEY = "durationMs";
    private static final String FALLBACK_REASON_KEY = "fallbackReason";
    private static final String STATUS_KEY = "status";
    private static final String TOTAL_DURATION_MS_KEY = "totalDurationMs";

    private static final String STATUS_APPLIED = "applied";
    private static final String STATUS_FALLBACK = "fallback";

    /** One archive being tried, timed from the moment it was started. */
    private static class Attempt {
        final String archive;
        final long startTimeMs = System.currentTimeMillis();

        /** How long the applier took, once it has restored the bundle. */
        long applyDurationMs = -1;

        boolean fellBack;
        String fallbackReason;
        long durationMs = -1;

        /** Whether the server answered this archive's URL with a status instead of the archive. */
        boolean wasNotServed;

        Attempt(String archive) {
            this.archive = archive;
        }
    }

    private final List<Attempt> mAttempts = new ArrayList<>();

    /** When the first archive was started, which is where a fallback's total time runs from. */
    private long mFirstAttemptStartTimeMs = -1;
    private long mTotalDurationMs = -1;

    /** Starts trying one archive. Everything recorded next is about this archive. */
    void beginAttempt(String archive) {
        if (mFirstAttemptStartTimeMs < 0) {
            mFirstAttemptStartTimeMs = System.currentTimeMillis();
        }
        mAttempts.add(new Attempt(archive));
    }

    /**
     * The applier restored the bundle. Whether the update installs is decided by the checks
     * that follow, so this is not yet the attempt succeeding.
     */
    void recordBundleRestored(long applyDurationMs) {
        current().applyDurationMs = applyDurationMs;
    }

    /**
     * Whether the current archive's attempt got as far as restoring the bundle. A failure
     * after that point is on the asset side of the archive, which the archives do not share -
     * unlike the bundle patch, which they carry byte for byte.
     */
    boolean currentAttemptRestoredBundle() {
        return current().applyDurationMs >= 0;
    }

    /**
     * Whether the current archive never arrived, because the server answered its URL with a
     * status rather than with the archive.
     *
     * A verdict on one URL, and the archives are at URLs of their own: a release whose diff
     * has been cleaned up still has its patch archive. This is the one failure before the
     * bundle is restored that says nothing about the archives left to try.
     */
    boolean currentAttemptWasNotServed() {
        return current().wasNotServed;
    }

    /**
     * The attempt at the current archive ended in one of the reasons the appliers report.
     *
     * The attempt is timed here rather than when it is read, because what happens next is
     * another archive being downloaded and that is not time this attempt spent.
     */
    void recordFallback(String failureReason) {
        Attempt attempt = current();
        attempt.fellBack = true;
        attempt.fallbackReason = failureReason;
        long now = System.currentTimeMillis();
        attempt.durationMs = now - attempt.startTimeMs;
        mTotalDurationMs = now - mFirstAttemptStartTimeMs;
    }

    /**
     * The attempt ended in an error rather than in a verdict of its own.
     *
     * An error raised after the bundle was restored is the restored update failing the checks
     * that every update passes before it is installed. Before that point the appliers have no
     * word for what happened - the archive not being downloadable, say - and inventing one
     * here would put a value on the wire that no platform reports, so the fallback is
     * reported without a reason.
     */
    void recordFallbackAfterError(Throwable error) {
        current().wasNotServed = CodePushErrorCode.HTTP.equals(CodePushErrorCode.of(error));
        recordFallback(currentAttemptRestoredBundle() ? ArchiveRestoreResult.REASON_PACKAGE_VERIFICATION_FAILED : null);
    }

    /** The archive being tried, for the log lines that name which one failed. */
    String currentArchive() {
        return current().archive;
    }

    private Attempt current() {
        return mAttempts.get(mAttempts.size() - 1);
    }

    /**
     * What the attempts ended in, as the app reads it.
     *
     * The result times the whole patch path: from the first archive starting to download to
     * the last attempt being finished with, whichever way it ended. The attempts array retells
     * the archives one by one, each timed over its own try and carrying the time its applier
     * took when it got as far as restoring the bundle.
     */
    JSONObject result() {
        Attempt last = current();
        boolean applied = !last.fellBack;
        long now = System.currentTimeMillis();

        JSONObject result = new JSONObject();
        CodePushUtils.setJSONValueForKey(result, STATUS_KEY, applied ? STATUS_APPLIED : STATUS_FALLBACK);
        CodePushUtils.setJSONValueForKey(result, ARCHIVE_KEY, last.archive);
        if (last.fallbackReason != null) {
            CodePushUtils.setJSONValueForKey(result, FALLBACK_REASON_KEY, last.fallbackReason);
        }

        // A path that was given up on was timed when it was, before the full download it
        // must not include. One that installed is timed here, because nothing else marks
        // the moment it finished - and mTotalDurationMs cannot stand in for it, because an
        // earlier attempt that fell back froze it partway through the path.
        CodePushUtils.setJSONValueForKey(result, TOTAL_DURATION_MS_KEY,
                applied ? now - mFirstAttemptStartTimeMs : mTotalDurationMs);

        JSONArray attempts = new JSONArray();
        for (Attempt attempt : mAttempts) {
            JSONObject entry = new JSONObject();
            CodePushUtils.setJSONValueForKey(entry, ARCHIVE_KEY, attempt.archive);
            if (attempt.fallbackReason != null) {
                CodePushUtils.setJSONValueForKey(entry, FALLBACK_REASON_KEY, attempt.fallbackReason);
            }
            CodePushUtils.setJSONValueForKey(entry, DURATION_MS_KEY,
                    attempt.fellBack ? attempt.durationMs : now - attempt.startTimeMs);
            // An attempt that never restored the bundle has no apply to report.
            if (attempt.applyDurationMs >= 0) {
                CodePushUtils.setJSONValueForKey(entry, APPLY_DURATION_MS_KEY, attempt.applyDurationMs);
            }
            attempts.put(entry);
        }
        CodePushUtils.setJSONValueForKey(result, ATTEMPTS_KEY, attempts);

        return result;
    }
}
