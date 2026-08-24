import {
  CloudFrontClient,
  CreateInvalidationCommand,
} from "@aws-sdk/client-cloudfront";
import {
  AWS_CREDENTIALS,
  AWS_REGION,
  CLOUDFRONT_DISTRIBUTION_ID,
} from "./awsConstants";

export async function invalidateCloudfrontCache({key}: {key: string}) {
  console.log(`log: Start creating cache invalidation (${key})`);
  const cloudfront = new CloudFrontClient({
    region: AWS_REGION,
    credentials: AWS_CREDENTIALS,
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
