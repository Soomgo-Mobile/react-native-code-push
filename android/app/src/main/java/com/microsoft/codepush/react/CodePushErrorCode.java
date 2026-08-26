package com.microsoft.codepush.react;

import java.net.SocketException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;

import javax.net.ssl.SSLException;

/**
 * What kind of failure a download ended in, in the words JS reads it by.
 *
 * React Native fills the code of a promise rejected with a bare throwable with
 * `EUNSPECIFIED`, which left the message the only thing telling one failure apart from
 * another - and a message is written for a person, not for a report to group by.
 *
 * The categories are the ones that ask for different things to happen next, which is why
 * there are four of them rather than one per way a download can fail. A category no
 * caller would act differently on is a category that only makes the reports wider.
 */
public class CodePushErrorCode {

    /** The network did not carry the download: the socket dropped, timed out, or never opened. */
    public static final String NETWORK = "CODE_PUSH_NETWORK";

    /** The server answered, with a status that is not a body to install. */
    public static final String HTTP = "CODE_PUSH_HTTP";

    /**
     * The downloaded contents do not hash to the release's package hash, or hold no JS
     * bundle by the name the app looks for. Downloading them again cannot help.
     */
    public static final String INTEGRITY = "CODE_PUSH_INTEGRITY";

    /** Nothing here has a word for it, and inventing one would only be a guess. */
    public static final String UNKNOWN = "CODE_PUSH_UNKNOWN";

    private CodePushErrorCode() {
    }

    /**
     * The category of a failure, read through its causes: the download wraps some of what it
     * catches, and the wrapper is never the part that says what went wrong.
     */
    public static String of(Throwable error) {
        for (Throwable cause = error; cause != null; cause = cause.getCause()) {
            if (cause instanceof CodePushHttpException) {
                return HTTP;
            }

            if (cause instanceof CodePushInvalidUpdateException) {
                return INTEGRITY;
            }

            if (isTransportFailure(cause)) {
                return NETWORK;
            }
        }

        return UNKNOWN;
    }

    /**
     * Whether the download failed because the network did not carry it.
     *
     * A server that answered is not this, however it answered: the connection worked, and
     * asking a different URL over it is worth doing. A connection that never opened or that
     * dropped is, and every URL behind it is equally out of reach.
     */
    public static boolean isNetworkFailure(Throwable error) {
        return NETWORK.equals(of(error));
    }

    private static boolean isTransportFailure(Throwable error) {
        // `SocketException` is the one that covers the reported majority - the connection
        // reset and the connection aborted an app being backgrounded mid-download leaves
        // behind - along with the connection that was refused or had no route.
        //
        // A download that stopped short belongs here too. The socket raised nothing for it,
        // so only the byte count says the network dropped the rest of the body.
        return error instanceof SocketTimeoutException
                || error instanceof SocketException
                || error instanceof UnknownHostException
                || error instanceof SSLException
                || error instanceof CodePushIncompleteDownloadException;
    }
}
