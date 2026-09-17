package com.microsoft.codepush.react;

import java.io.IOException;

/**
 * The response stopped before it had delivered the length it declared.
 *
 * A type of its own rather than one more unnamed I/O error, because this is a network
 * failure the socket never raised one for: the bytes simply stopped arriving, and only the
 * count says so. Everywhere a network failure is acted on has to act on this one too.
 */
public class CodePushIncompleteDownloadException extends IOException {

    public CodePushIncompleteDownloadException(long receivedBytes, long declaredBytes) {
        super("Received " + receivedBytes + " bytes, expected " + declaredBytes);
    }
}
