import {
  CloudFrontClient,
  CreateInvalidationCommand,
} from "@aws-sdk/client-cloudfront";

const CLOUDFRONT_DISTRIBUTION_ID = "DISTRIBUTION_ID";

const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;

export async function invalidateCloudfrontCache({key}: {key: string}) {
  console.log(`log: Start creating cache invalidation (${key})`);
  const cloudfront = new CloudFrontClient({
    region: "ap-northeast-2",
    credentials: {
      accessKeyId: AWS_ACCESS_KEY_ID!,
      secretAccessKey: AWS_SECRET_ACCESS_KEY!,
    },
  });

  const command = new CreateInvalidationCommand({
    DistributionId: CLOUDFRONT_DISTRIBUTION_ID,
    InvalidationBatch: {
      CallerReference: `${Date.now()}`,
      Paths: {
        Quantity: 1,
        Items: [`/${key}`],
      },
    },
  });

  try {
    const data = await cloudfront.send(command);
    console.log(`Cache invalidation created (ID: ${data.Invalidation?.Id})`);
  } catch (error) {
    console.error("Cache invalidation failed", error);
  }
}
