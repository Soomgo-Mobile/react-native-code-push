package com.microsoft.codepush.react;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.io.IOException;
import java.net.ConnectException;
import java.net.MalformedURLException;
import java.net.SocketException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;

import javax.net.ssl.SSLHandshakeException;

public class CodePushErrorCodeTest {

    @Test
    public void namesAConnectionThatDroppedAsANetworkFailure() {
        // The message the reported majority of Android failures arrive with.
        assertEquals(CodePushErrorCode.NETWORK,
                CodePushErrorCode.of(new SocketException("Software caused connection abort")));
    }

    @Test
    public void namesAConnectionThatTimedOutAsANetworkFailure() {
        assertEquals(CodePushErrorCode.NETWORK, CodePushErrorCode.of(new SocketTimeoutException("timeout")));
    }

    @Test
    public void namesAConnectionThatNeverOpenedAsANetworkFailure() {
        assertEquals(CodePushErrorCode.NETWORK, CodePushErrorCode.of(new ConnectException("Connection refused")));
        assertEquals(CodePushErrorCode.NETWORK, CodePushErrorCode.of(new UnknownHostException("cdn.example.test")));
        assertEquals(CodePushErrorCode.NETWORK, CodePushErrorCode.of(new SSLHandshakeException("handshake failed")));
    }

    @Test
    public void namesADownloadThatStoppedShortAsANetworkFailure() {
        // The socket raised nothing for it, so only the byte count says the body was cut off.
        Throwable error = new CodePushIncompleteDownloadException(1024, 4096);

        assertEquals(CodePushErrorCode.NETWORK, CodePushErrorCode.of(error));
        assertTrue(CodePushErrorCode.isNetworkFailure(error));
    }

    @Test
    public void namesAnErrorStatusAsAnHttpFailureRatherThanANetworkOne() {
        Throwable error = new CodePushHttpException("https://cdn.example.test/full.zip", 503);

        assertEquals(CodePushErrorCode.HTTP, CodePushErrorCode.of(error));
        assertFalse("a server that answered is not a network that failed",
                CodePushErrorCode.isNetworkFailure(error));
    }

    @Test
    public void namesAnUpdateThatIsNotWhatItClaimedAsAnIntegrityFailure() {
        assertEquals(CodePushErrorCode.INTEGRITY,
                CodePushErrorCode.of(new CodePushInvalidUpdateException("The update contents failed the data integrity check.")));
    }

    @Test
    public void readsThroughTheWrapperADownloadCatchesItsFailuresIn() {
        Throwable wrapped = new CodePushUnknownException("Error closing IO resources.",
                new SocketException("Connection reset"));

        assertEquals(CodePushErrorCode.NETWORK, CodePushErrorCode.of(wrapped));
        assertTrue(CodePushErrorCode.isNetworkFailure(wrapped));
    }

    @Test
    public void namesTheFailuresThatUsedToEscapeTheDownloadUncaught() {
        // Neither is an `IOException`, so the download's old catch let them past and left
        // the promise waiting on it unsettled. They are classified like anything else now.
        assertEquals(CodePushErrorCode.UNKNOWN,
                CodePushErrorCode.of(new CodePushMalformedDataException("not a url", new MalformedURLException())));
        assertEquals(CodePushErrorCode.UNKNOWN,
                CodePushErrorCode.of(new IllegalStateException("File is outside extraction target directory.")));
    }

    @Test
    public void leavesAFailureNothingHasAWordForUnnamed() {
        Throwable error = new IOException("the disk is full");

        assertEquals(CodePushErrorCode.UNKNOWN, CodePushErrorCode.of(error));
        assertFalse("an unnamed failure must not be retried as if the network caused it",
                CodePushErrorCode.isNetworkFailure(error));
    }
}
