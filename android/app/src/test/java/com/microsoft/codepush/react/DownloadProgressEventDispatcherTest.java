package com.microsoft.codepush.react;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/**
 * The dispatcher is the seam between the download thread and the UI frame callback. These
 * pin the property the two threads rely on: per download, the JS side sees one monotonic
 * stream, and after a reset the next download's stream starts fresh instead of being
 * mistaken for the previous one running backwards.
 */
public class DownloadProgressEventDispatcherTest {

    private final List<Long> mEmittedBytes = new ArrayList<>();
    private final DownloadProgressEventDispatcher mDispatcher = new DownloadProgressEventDispatcher(
            new DownloadProgressEventDispatcher.EventEmitter() {
                @Override
                public void emit(DownloadProgress downloadProgress) {
                    mEmittedBytes.add(downloadProgress.getReceivedBytes());
                }
            });

    @Test
    public void aFrameCallbackWithNothingRecordedEmitsNothing() {
        mDispatcher.dispatchLatest();

        assertEquals(Collections.emptyList(), mEmittedBytes);
    }

    @Test
    public void emitsOnlyTheLatestRecordedProgress() {
        mDispatcher.record(new DownloadProgress(100, 60));
        mDispatcher.record(new DownloadProgress(100, 80));

        mDispatcher.dispatchLatest();

        assertEquals(Arrays.asList(80L), mEmittedBytes);
    }

    @Test
    public void aFrameCallbackFiringAfterTheCompletionEventEmitsNothingMore() {
        mDispatcher.record(new DownloadProgress(100, 90));
        mDispatcher.dispatchLatest();
        mDispatcher.record(new DownloadProgress(100, 100));
        mDispatcher.dispatchLatest();

        // The frame callback that was already scheduled when the download completed.
        mDispatcher.dispatchLatest();

        assertEquals(Arrays.asList(90L, 100L), mEmittedBytes);
    }

    @Test
    public void aResetLetsTheNextDownloadCountFromZeroAgain() {
        mDispatcher.record(new DownloadProgress(100, 100));
        mDispatcher.dispatchLatest();

        mDispatcher.reset();
        mDispatcher.record(new DownloadProgress(5000, 10));
        mDispatcher.dispatchLatest();

        assertEquals(Arrays.asList(100L, 10L), mEmittedBytes);
    }

    @Test
    public void progressRecordedBeforeAResetIsNotEmittedAfterIt() {
        mDispatcher.record(new DownloadProgress(100, 100));

        mDispatcher.reset();
        mDispatcher.dispatchLatest();

        assertEquals(Collections.emptyList(), mEmittedBytes);
    }
}
