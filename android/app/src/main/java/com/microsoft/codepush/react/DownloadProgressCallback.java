package com.microsoft.codepush.react;

interface DownloadProgressCallback {
    /**
     * A download is starting its own progress stream: received bytes count from zero again,
     * against this download's own total. A binary patch fallback makes this happen twice
     * within one downloaded update.
     */
    void onDownloadStart();

    void call(DownloadProgress downloadProgress);
}
