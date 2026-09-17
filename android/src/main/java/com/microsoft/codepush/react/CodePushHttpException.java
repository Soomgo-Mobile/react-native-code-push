package com.microsoft.codepush.react;

import java.io.IOException;

/**
 * The server answered a download with a status that is not a body to install.
 *
 * An I/O exception rather than one of this package's unchecked ones, because every caller
 * of a download already handles `IOException` and this is one more way a download does not
 * arrive - and because the alternative, an unchecked exception, would escape the download
 * path uncaught.
 *
 * The message reads the way the other platform's does, so one release answered with the
 * same status reads the same in both platforms' reports.
 */
public class CodePushHttpException extends IOException {

    private final int mStatusCode;

    public CodePushHttpException(String url, int statusCode) {
        super("Received " + statusCode + " response from " + url);
        mStatusCode = statusCode;
    }

    /** The status the server answered with. */
    public int getStatusCode() {
        return mStatusCode;
    }
}
