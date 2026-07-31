package com.microsoft.codepush.react;

class DownloadProgressEventDispatcher {
    interface EventEmitter {
        void emit(DownloadProgress downloadProgress);
    }

    private final EventEmitter mEventEmitter;
    private long mLastDispatchedBytes = -1;

    DownloadProgressEventDispatcher(EventEmitter eventEmitter) {
        mEventEmitter = eventEmitter;
    }

    synchronized void dispatch(DownloadProgress downloadProgress) {
        if (downloadProgress == null || downloadProgress.getReceivedBytes() <= mLastDispatchedBytes) {
            return;
        }

        mEventEmitter.emit(downloadProgress);
        mLastDispatchedBytes = downloadProgress.getReceivedBytes();
    }
}
