import fs from "fs";
import {GetObjectCommand, S3Client} from "@aws-sdk/client-s3";
import {
  AWS_CREDENTIALS,
  AWS_REGION,
  CODE_PUSH_S3_BUCKET_NAME,
} from "./awsConstants";

interface Params {
  pathToLocalFile: string;
  key: string;
}

export async function downloadFileFromS3({pathToLocalFile, key}: Params) {
  const s3Client = new S3Client({
    region: AWS_REGION,
    credentials: AWS_CREDENTIALS,
  });

  const response = await s3Client.send(new GetObjectCommand({
    Bucket: CODE_PUSH_S3_BUCKET_NAME,
    Key: key,
  }));

  if (!response.Body) {
    throw new Error(`S3 object "${key}" has no response body.`);
  }

  await fs.promises.writeFile(
    pathToLocalFile,
    await response.Body.transformToByteArray(),
  );
}
