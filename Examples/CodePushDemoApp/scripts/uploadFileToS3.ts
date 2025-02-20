import fs from "fs";
import {S3Client} from "@aws-sdk/client-s3";
import {Upload} from "@aws-sdk/lib-storage";

const BUCKET_NAME = "code-push-bucket";
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;

interface Params {
  pathToLocalFile: string;
  key: string;
}

export async function uploadFileToS3({pathToLocalFile, key}: Params) {
  const s3Client = new S3Client({
    region: "ap-northeast-2",
    credentials: {
      accessKeyId: AWS_ACCESS_KEY_ID!,
      secretAccessKey: AWS_SECRET_ACCESS_KEY!,
    },
  });

  const fileStream = fs.createReadStream(pathToLocalFile);

  const uploader = new Upload({
    client: s3Client,
    params: {
      Bucket: BUCKET_NAME,
      Key: key,
      Body: fileStream,
      ACL: "public-read",
    },
  });

  const {Location} = await uploader.done();
  console.log(`log: 🎉 File uploaded successfully [${Location}]`);
}
