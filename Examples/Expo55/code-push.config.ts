// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck

import {
    CliConfigInterface,
    ReleaseHistoryInterface,
} from "@bravemobile/react-native-code-push";
import * as fs from "fs";
import axios from "axios"; // install as devDependency
import * as SupabaseSDK from "@supabase/supabase-js"; // install as devDependency

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = SupabaseSDK.createClient(SUPABASE_URL!, SUPABASE_KEY!);
const BUCKET_NAME = "codePush";
const STORAGE_HOST = `${SUPABASE_URL}/storage/v1/object/public`;

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
        const fileName = source.split("/").pop();
        const fileStream = fs.createReadStream(source);
        const remotePath = bundleFileRemotePath(platform, identifier, fileName!);

        const {data, error} = await supabase.storage
            .from(BUCKET_NAME)
            .upload(remotePath, fileStream, {
                contentType: "application/zip",
                duplex: "half",
                upsert: true,
            });

        if (error) {
            console.error("Error uploading file:", error.message);
            throw error;
        }

        console.log("Bundle File uploaded:", `${STORAGE_HOST}/${data.fullPath}`);

        return {
            downloadUrl: `${STORAGE_HOST}/${data.fullPath}`,
        };
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
        const {data} = await axios.get(
            `${STORAGE_HOST}/${BUCKET_NAME}/${remoteJsonPath}`,
        );
        return data as ReleaseHistoryInterface;
    },

    setReleaseHistory: async (
        targetBinaryVersion: string,
        jsonFilePath: string,
        releaseInfo: ReleaseHistoryInterface,
        platform: "ios" | "android",
        identifier = "staging",
    ): Promise<void> => {
        // upload JSON file or call API using `releaseInfo` metadata.

        const fileContent = fs.readFileSync(jsonFilePath, "utf8");
        const remoteJsonPath = historyJsonFileRemotePath(
            platform,
            identifier,
            targetBinaryVersion,
        );

        const {data, error} = await supabase.storage
            .from(BUCKET_NAME)
            .upload(remoteJsonPath, Buffer.from(fileContent), {
                contentType: "application/json",
                cacheControl: "5",
                upsert: true,
            });

        if (error) {
            console.error("Error uploading file:", error.message);
            throw error;
        }

        console.log(
            "Release history File uploaded:",
            `${STORAGE_HOST}/${data.fullPath}`,
        );
    },
};

module.exports = Config;
