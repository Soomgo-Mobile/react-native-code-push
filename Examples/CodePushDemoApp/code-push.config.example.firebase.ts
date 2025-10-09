// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck

import {
    CliConfigInterface,
    ReleaseHistoryInterface,
} from "@bravemobile/react-native-code-push";
import * as fs from "fs";
import dotenv from "dotenv"; // install as devDependency
import * as admin from "firebase-admin"; // install as devDependency

dotenv.config();

const FIREBASE_SERVICE_ACCOUNT_PATH = process.env.FIREBASE_SERVICE_ACCOUNT_PATH!;
const FIREBASE_STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET!;

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(
    fs.readFileSync(FIREBASE_SERVICE_ACCOUNT_PATH, "utf8"),
  );

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: FIREBASE_STORAGE_BUCKET,
  });
}

const storage = admin.storage().bucket();

function historyJsonFileRemotePath(
    platform: "ios" | "android",
    identifier: string,
    binaryVersion: string,
) {
    return `histories/${platform}/${identifier}/${binaryVersion}.json`;
}

function bundleFileRemotePath(
    platform: "ios" | "android",
    identifier: string,
    fileName: string,
) {
    return `bundles/${platform}/${identifier}/${fileName}`;
}

const Config: CliConfigInterface = {
    bundleUploader: async (
        source: string,
        platform: "ios" | "android",
        identifier = "staging",
    ): Promise<{downloadUrl: string}> => {
        try {
            const fileName = source.split("/").pop();
            const remotePath = bundleFileRemotePath(platform, identifier, fileName!);

            const file = storage.file(remotePath);

            await file.save(fs.readFileSync(source), {
                metadata: {
                    contentType: "application/zip",
                },
            });

            await file.makePublic();

            const downloadUrl = `https://storage.googleapis.com/${FIREBASE_STORAGE_BUCKET}/${remotePath}`;

            console.log("Bundle File uploaded:", downloadUrl);

            return {
                downloadUrl,
            };
        } catch (error) {
            console.error("Error uploading bundle:", (error as Error).message);
            throw error;
        }
    },

    getReleaseHistory: async (
        targetBinaryVersion: string,
        platform: "ios" | "android",
        identifier = "staging",
    ): Promise<ReleaseHistoryInterface> => {
        const remoteJsonPath = historyJsonFileRemotePath(
            platform,
            identifier,
            targetBinaryVersion,
        );

        const file = storage.file(remoteJsonPath);

        try {
            const [exists] = await file.exists();
            if (!exists) {
                throw new Error(`Release history file not found: ${remoteJsonPath}`);
            }

            const [contents] = await file.download();
            return JSON.parse(contents.toString()) as ReleaseHistoryInterface;
        } catch (error) {
            console.error("Error getting release history:", (error as Error).message);
            throw error;
        }
    },

    setReleaseHistory: async (
        targetBinaryVersion: string,
        jsonFilePath: string,
        releaseInfo: ReleaseHistoryInterface,
        platform: "ios" | "android",
        identifier = "staging",
    ): Promise<void> => {
        // upload JSON file or call API using `releaseInfo` metadata.

        try {
            const fileContent = fs.readFileSync(jsonFilePath, "utf8");
            const remoteJsonPath = historyJsonFileRemotePath(
                platform,
                identifier,
                targetBinaryVersion,
            );

            const file = storage.file(remoteJsonPath);

            await file.save(fileContent, {
                metadata: {
                    contentType: "application/json",
                    cacheControl: "no-cache",
                },
            });

            await file.makePublic();

            const downloadUrl = `https://storage.googleapis.com/${FIREBASE_STORAGE_BUCKET}/${remoteJsonPath}`;

            console.log(
                "Release history File uploaded:",
                downloadUrl,
            );
        } catch (error) {
            console.error("Error setting release history:", (error as Error).message);
            throw error;
        }
    },
};

module.exports = Config;
