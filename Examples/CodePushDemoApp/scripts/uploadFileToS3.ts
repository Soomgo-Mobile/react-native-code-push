import fs from "fs";
import {S3Client} from "@aws-sdk/client-s3";
import {Upload} from "@aws-sdk/lib-storage";
import {
  AWS_CREDENTIALS,
  AWS_REGION,
  CODE_PUSH_S3_BUCKET_NAME,
} from "./awsConstants";

interface Params {
  pathToLocalFile: string;
  key: string;
}

export async function uploadFileToS3({pathToLocalFile, key}: Params) {
  const s3Client = new S3Client({
    region: AWS_REGION,
    credentials: AWS_CREDENTIALS,
  });

  const fileStream = fs.createReadStream(pathToLocalFile);

  const uploader = new Upload({
    client: s3Client,
    params: {
      Bucket: CODE_PUSH_S3_BUCKET_NAME,
      Key: key,
      Body: fileStream,
      ACL: "public-read",
    },
  });

  const {Location} = await uploader.done();
  console.log(`log: 🎉 File uploaded successfully [${Location}]`);
}
