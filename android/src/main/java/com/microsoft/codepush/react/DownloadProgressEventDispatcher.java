package com.microsoft.codepush.react;

/**
 * Serializes progress events from the download thread and the UI frame callback into one
 * monotonic stream per download: whatever order the two threads dispatch in, the JS side
 * never sees the same download run backwards. The latest progress lives here rather than
 * with the caller so that reading it and dispatching it happen under one lock.
 */
class DownloadProgressEventDispatcher {
    interface EventEmitter {
        void emit(DownloadProgress downloadProgress);
    }

    private final EventEmitter mEventEmitter;
    private DownloadProgress mLatestDownloadProgress = null;
    private long mLastDispatchedBytes = -1;

    DownloadProgressEventDispatcher(EventEmitter eventEmitter) {
        mEventEmitter = eventEmitter;
    }

    synchronized void record(DownloadProgress downloadProgress) {
        mLatestDownloadProgress = downloadProgress;
    }

    synchronized void dispatchLatest() {
        if (mLatestDownloadProgress == null || mLatestDownloadProgress.getReceivedBytes() <= mLastDispatchedBytes) {
            return;
        }

        mEventEmitter.emit(mLatestDownloadProgress);
        mLastDispatchedBytes = mLatestDownloadProgress.getReceivedBytes();
    }

    /**
     * Forgets the download dispatched so far. The next download counts its bytes from zero,
     * and without the reset the monotonic guard would swallow its events as the previous
     * download running backwards.
     */
    synchronized void reset() {
        mLatestDownloadProgress = null;
        mLastDispatchedBytes = -1;
    }
}
