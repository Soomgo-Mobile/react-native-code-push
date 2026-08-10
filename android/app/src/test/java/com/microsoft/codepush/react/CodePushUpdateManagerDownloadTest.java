package com.microsoft.codepush.react;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.Charset;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * Downloading a real archive over HTTP and installing what comes out of it.
 *
 * These exercise the update manager end to end - download, unzip, restore, folder hash,
 * metadata - with only the two seams of the applier stubbed, because the wiring between
 * those steps is where an archive that is not what it claims has to be caught.
 */
public class CodePushUpdateManagerDownloadTest {

    private static final String BUNDLE_FILE_NAME = "index.android.bundle";
    /** Every archive wraps its files in one directory, which the manifest paths are relative to. */
    private static final String CONTENTS_DIR_NAME = "CodePush";
    private static final String ASSET_PATH = "assets/logo.png";

    private static final byte[] BASE_BUNDLE = bytes("the bundle inside the app binary");
    private static final byte[] TARGET_BUNDLE = bytes("the bundle the update wants to run");
    private static final byte[] PATCH = bytes("the difference between the two");
    private static final byte[] ASSET = bytes("an image the update ships with");
    private static final byte[] ERROR_PAGE = bytes("<html><body>404 Not Found</body></html>");

    @Rule
    public TemporaryFolder mTemporaryFolder = new TemporaryFolder();

    private TestArchiveServer mServer;

    private String mDocumentsDirectory;
    private String mPackageHash;
    private File mPackageFolder;

    @Before
    public void setUp() throws IOException {
        mDocumentsDirectory = mTemporaryFolder.getRoot().getAbsolutePath();
        mPackageHash = packageHashOf(fullArchiveContents());
        mPackageFolder = new File(new File(mDocumentsDirectory, CodePushConstants.CODE_PUSH_FOLDER_PREFIX), mPackageHash);

        mServer = new TestArchiveServer();
    }

    @After
    public void tearDown() throws IOException {
        mServer.close();
    }

    @Test
    public void installsAnUpdateFromItsBinaryPatchArchive() throws IOException {
        String patchUrl = serve("/patch.zip", zipOf(patchArchiveContents()));
        String fullUrl = serve("/full.zip", zipOf(fullArchiveContents()));

        updateManager(applierWriting(TARGET_BUNDLE))
                .downloadPackage(updatePackage(fullUrl, patchUrl), BUNDLE_FILE_NAME, ignoreProgress());

        assertEquals("the full archive is not downloaded when the patch installs",
                Arrays.asList("/patch.zip"), mServer.requestedPaths());
        assertInstalledContents();
    }

    @Test
    public void fallsBackToTheFullArchiveWhenThePatchUrlDoesNotServeAnArchive() throws IOException {
        // A CDN that answers an error page with a 200 is the realistic way this happens.
        String patchUrl = serve("/patch.zip", ERROR_PAGE);
        String fullUrl = serve("/full.zip", zipOf(fullArchiveContents()));

        updateManager(applierWriting(TARGET_BUNDLE))
                .downloadPackage(updatePackage(fullUrl, patchUrl), BUNDLE_FILE_NAME, ignoreProgress());

        assertEquals(Arrays.asList("/patch.zip", "/full.zip"), mServer.requestedPaths());
        assertInstalledContents();
    }

    @Test
    public void reportsAnInvalidManifestWhenThePatchUrlDoesNotServeAnArchive() throws IOException {
        String patchUrl = serve("/patch.zip", ERROR_PAGE);

        BinaryPatchResult result = updateManager(applierWriting(TARGET_BUNDLE)).downloadAndInstallPackage(
                updatePackage("https://example.test/unused.zip", patchUrl), BUNDLE_FILE_NAME, ignoreProgress(),
                patchUrl, true);

        assertFalse(result.succeeded());
        assertEquals(BinaryPatchResult.REASON_INVALID_MANIFEST, result.getFailureReason());
        assertFalse("bytes that are not an update must not reach the package folder", mPackageFolder.exists());
    }

    @Test
    public void fallsBackToTheFullArchiveWhenApplyingThePatchRunsOutOfMemory() throws IOException {
        String patchUrl = serve("/patch.zip", zipOf(patchArchiveContents()));
        String fullUrl = serve("/full.zip", zipOf(fullArchiveContents()));
        CodePushBinaryPatch.PatchApplier outOfMemoryApplier = new CodePushBinaryPatch.PatchApplier() {
            @Override
            public int apply(byte[] base, byte[] patch, String outputPath, long expectedTargetSize) {
                throw new OutOfMemoryError("Failed to allocate the restored bundle");
            }
        };

        updateManager(outOfMemoryApplier)
                .downloadPackage(updatePackage(fullUrl, patchUrl), BUNDLE_FILE_NAME, ignoreProgress());

        assertEquals(Arrays.asList("/patch.zip", "/full.zip"), mServer.requestedPaths());
        assertInstalledContents();
    }

    /** The installed update is the full archive's contents, whichever archive it came from. */
    private void assertInstalledContents() throws IOException {
        File contentsFolder = new File(mPackageFolder, CONTENTS_DIR_NAME);
        assertArrayEquals(TARGET_BUNDLE, readFile(new File(contentsFolder, BUNDLE_FILE_NAME)));
        assertArrayEquals(ASSET, readFile(new File(contentsFolder, ASSET_PATH)));
        assertFalse(new File(contentsFolder, CodePushConstants.BINARY_PATCH_MANIFEST_FILE_NAME).exists());
        assertFalse(new File(contentsFolder, BUNDLE_FILE_NAME + ".patch").exists());

        // Written last, so its presence also says the folder hash check passed.
        JSONObject metadata = CodePushUtils.getJsonObjectFromFile(
                new File(mPackageFolder, CodePushConstants.PACKAGE_FILE_NAME).getAbsolutePath());
        String bundlePath = metadata.optString(CodePushConstants.RELATIVE_BUNDLE_PATH_KEY, null);
        assertTrue("the metadata points at the restored bundle, but says " + bundlePath,
                bundlePath != null && bundlePath.endsWith(CONTENTS_DIR_NAME + "/" + BUNDLE_FILE_NAME));

        File binaryPatchFolder = new File(
                new File(mDocumentsDirectory, CodePushConstants.CODE_PUSH_FOLDER_PREFIX),
                CodePushConstants.BINARY_PATCH_FOLDER_NAME);
        assertFalse(binaryPatchFolder.exists());
    }

    private CodePushUpdateManager updateManager(CodePushBinaryPatch.PatchApplier applier) {
        CodePushBinaryPatch binaryPatch = new CodePushBinaryPatch(new CodePushBinaryPatch.BaseBundleProvider() {
            @Override
            public byte[] readBaseBundle(String bundleFileName) {
                return BASE_BUNDLE;
            }
        }, applier);

        return new CodePushUpdateManager(mDocumentsDirectory, binaryPatch);
    }

    private static CodePushBinaryPatch.PatchApplier applierWriting(final byte[] restoredBundle) {
        return new CodePushBinaryPatch.PatchApplier() {
            @Override
            public int apply(byte[] base, byte[] patch, String outputPath, long expectedTargetSize) {
                assertArrayEquals(BASE_BUNDLE, base);
                assertArrayEquals(PATCH, patch);
                try {
                    writeFile(new File(outputPath), restoredBundle);
                } catch (IOException e) {
                    return RESULT_IO_ERROR;
                }

                return RESULT_OK;
            }
        };
    }

    private Map<String, byte[]> fullArchiveContents() {
        Map<String, byte[]> contents = new LinkedHashMap<>();
        contents.put(CONTENTS_DIR_NAME + "/" + BUNDLE_FILE_NAME, TARGET_BUNDLE);
        contents.put(CONTENTS_DIR_NAME + "/" + ASSET_PATH, ASSET);
        return contents;
    }

    private Map<String, byte[]> patchArchiveContents() {
        JSONObject manifest = new JSONObject();
        CodePushUtils.setJSONValueForKey(manifest, CodePushConstants.BINARY_PATCH_FORMAT_VERSION_KEY,
                CodePushConstants.BINARY_PATCH_FORMAT_VERSION);
        CodePushUtils.setJSONValueForKey(manifest, CodePushConstants.BINARY_PATCH_ALGORITHM_KEY,
                CodePushConstants.BINARY_PATCH_ALGORITHM);
        CodePushUtils.setJSONValueForKey(manifest, CodePushConstants.BINARY_PATCH_BUNDLE_PATH_KEY, BUNDLE_FILE_NAME);
        CodePushUtils.setJSONValueForKey(manifest, CodePushConstants.BINARY_PATCH_FILE_KEY, BUNDLE_FILE_NAME + ".patch");
        CodePushUtils.setJSONValueForKey(manifest, CodePushConstants.BINARY_PATCH_BASE_BUNDLE_HASH_KEY, sha256(BASE_BUNDLE));
        CodePushUtils.setJSONValueForKey(manifest, CodePushConstants.BINARY_PATCH_TARGET_BUNDLE_HASH_KEY, sha256(TARGET_BUNDLE));
        CodePushUtils.setJSONValueForKey(manifest, CodePushConstants.BINARY_PATCH_TARGET_BUNDLE_SIZE_KEY, TARGET_BUNDLE.length);

        Map<String, byte[]> contents = new LinkedHashMap<>();
        contents.put(CONTENTS_DIR_NAME + "/" + CodePushConstants.BINARY_PATCH_MANIFEST_FILE_NAME, bytes(manifest.toString()));
        contents.put(CONTENTS_DIR_NAME + "/" + BUNDLE_FILE_NAME + ".patch", PATCH);
        contents.put(CONTENTS_DIR_NAME + "/" + ASSET_PATH, ASSET);
        return contents;
    }

    private JSONObject updatePackage(String downloadUrl, String binaryPatchDownloadUrl) {
        JSONObject updatePackage = new JSONObject();
        CodePushUtils.setJSONValueForKey(updatePackage, CodePushConstants.PACKAGE_HASH_KEY, mPackageHash);
        CodePushUtils.setJSONValueForKey(updatePackage, CodePushConstants.DOWNLOAD_URL_KEY, downloadUrl);
        CodePushUtils.setJSONValueForKey(updatePackage, CodePushConstants.BINARY_PATCH_DOWNLOAD_URL_KEY, binaryPatchDownloadUrl);
        return updatePackage;
    }

    private String serve(String path, byte[] body) {
        return mServer.serve(path, body);
    }

    /**
     * Serves the archives over a loopback socket, so the download really goes through
     * `HttpURLConnection` the way it does on a device. Written on a plain socket rather than
     * against an HTTP library because a unit test here has neither the JDK's server nor a
     * dependency that could stand in for it.
     */
    private static class TestArchiveServer {

        private final ServerSocket mSocket;
        private final Map<String, byte[]> mBodies = new HashMap<>();
        private final List<String> mRequestedPaths = Collections.synchronizedList(new ArrayList<String>());

        TestArchiveServer() throws IOException {
            mSocket = new ServerSocket(0, 0, InetAddress.getByName("127.0.0.1"));
            Thread serverThread = new Thread(new Runnable() {
                @Override
                public void run() {
                    serveUntilClosed();
                }
            });
            serverThread.setDaemon(true);
            serverThread.start();
        }

        synchronized String serve(String path, byte[] body) {
            mBodies.put(path, body);
            return "http://127.0.0.1:" + mSocket.getLocalPort() + path;
        }

        List<String> requestedPaths() {
            return new ArrayList<>(mRequestedPaths);
        }

        void close() throws IOException {
            mSocket.close();
        }

        private void serveUntilClosed() {
            while (!mSocket.isClosed()) {
                Socket connection;
                try {
                    connection = mSocket.accept();
                } catch (IOException e) {
                    // The socket was closed while waiting, which is how the test ends.
                    return;
                }

                try {
                    try {
                        respond(connection);
                    } finally {
                        connection.close();
                    }
                } catch (IOException e) {
                    // A broken connection is the client's business, not the server's.
                }
            }
        }

        private void respond(Socket connection) throws IOException {
            BufferedReader request = new BufferedReader(
                    new InputStreamReader(connection.getInputStream(), Charset.forName("UTF-8")));
            String requestLine = request.readLine();
            for (String header = request.readLine(); header != null && !header.isEmpty(); header = request.readLine()) {
                // The headers are read to the blank line so the request is fully consumed.
            }

            String path = requestLine == null ? "" : requestLine.split(" ")[1];
            mRequestedPaths.add(path);
            byte[] body = bodyFor(path);

            OutputStream response = connection.getOutputStream();
            if (body == null) {
                response.write(bytes("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"));
            } else {
                response.write(bytes("HTTP/1.1 200 OK\r\nContent-Length: " + body.length
                        + "\r\nConnection: close\r\n\r\n"));
                response.write(body);
            }
            response.flush();
            // Half-close and wait for the client to hang up, so the response is not cut off
            // by closing the socket underneath it.
            connection.shutdownOutput();
            while (connection.getInputStream().read() >= 0) {
                // Drains whatever the client sends before it closes.
            }
        }

        private synchronized byte[] bodyFor(String path) {
            return mBodies.get(path);
        }
    }

    private static byte[] zipOf(Map<String, byte[]> contents) throws IOException {
        ByteArrayOutputStream archive = new ByteArrayOutputStream();
        ZipOutputStream zipStream = new ZipOutputStream(archive);
        try {
            for (Map.Entry<String, byte[]> entry : contents.entrySet()) {
                zipStream.putNextEntry(new ZipEntry(entry.getKey()));
                zipStream.write(entry.getValue());
                zipStream.closeEntry();
            }
        } finally {
            zipStream.close();
        }

        return archive.toByteArray();
    }

    /**
     * The package hash of update contents, computed the way the CLI computes it: the sorted
     * `<relative path>:<sha256>` entries, stringified as a JSON array, hashed.
     */
    private static String packageHashOf(Map<String, byte[]> contents) {
        List<String> manifest = new ArrayList<>();
        for (Map.Entry<String, byte[]> entry : contents.entrySet()) {
            manifest.add(entry.getKey() + ":" + sha256(entry.getValue()));
        }
        Collections.sort(manifest);

        StringBuilder entries = new StringBuilder("[");
        for (int i = 0; i < manifest.size(); i++) {
            if (i > 0) {
                entries.append(",");
            }
            entries.append('"').append(manifest.get(i)).append('"');
        }
        entries.append("]");

        return sha256(bytes(entries.toString()));
    }

    private static DownloadProgressCallback ignoreProgress() {
        return new DownloadProgressCallback() {
            @Override
            public void call(DownloadProgress downloadProgress) {
            }
        };
    }

    private static void writeFile(File file, byte[] contents) throws IOException {
        OutputStream output = new FileOutputStream(file);
        try {
            output.write(contents);
        } finally {
            output.close();
        }
    }

    private static byte[] readFile(File file) throws IOException {
        byte[] contents = new byte[(int) file.length()];
        InputStream input = new FileInputStream(file);
        try {
            int offset = 0;
            while (offset < contents.length) {
                int bytesRead = input.read(contents, offset, contents.length - offset);
                if (bytesRead < 0) {
                    throw new IOException("Unexpected end of " + file);
                }
                offset += bytesRead;
            }
        } finally {
            input.close();
        }

        return contents;
    }

    private static byte[] bytes(String text) {
        return text.getBytes(Charset.forName("UTF-8"));
    }

    private static String sha256(byte[] data) {
        MessageDigest digest;
        try {
            digest = MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }

        StringBuilder hex = new StringBuilder();
        for (byte hashByte : digest.digest(data)) {
            hex.append(String.format("%02x", hashByte));
        }

        return hex.toString();
    }
}
