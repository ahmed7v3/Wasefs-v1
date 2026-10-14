import { randomUUID } from "node:crypto";

import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { MinioContainer } from "@testcontainers/minio";

/** Chainguard's MinIO, pinned like the dev compose (MinIO no longer publishes to Docker Hub). */
export const MINIO_IMAGE =
  "cgr.dev/chainguard/minio@sha256:dc455cdd4db6e390b1b26514f15ff37681a777bf8dab41aac445a0259f751e56";

export interface TestStorage {
  /** The `R2_UPLOADS_*` env the api and worker are configured with. */
  env: Record<string, string>;
  /** Direct S3 access for assertions and for setting up objects behind the api's back. */
  s3: S3Client;
  bucket: string;
  stop: () => Promise<void>;
}

/**
 * MinIO (S3 API, the same code path as R2) in Testcontainers. Set `TEST_S3_ENDPOINT`,
 * `TEST_S3_ACCESS_KEY` and `TEST_S3_SECRET_KEY` to use an already-running one (`minio` in
 * `infra/docker/compose.dev.yml`); each run then creates its own bucket.
 */
export async function startStorage(): Promise<TestStorage> {
  const external = process.env.TEST_S3_ENDPOINT;
  let endpoint: string;
  let accessKeyId: string;
  let secretAccessKey: string;
  let stop = async (): Promise<void> => undefined;
  if (external) {
    endpoint = external;
    accessKeyId = process.env.TEST_S3_ACCESS_KEY ?? "";
    secretAccessKey = process.env.TEST_S3_SECRET_KEY ?? "";
  } else {
    const container = await new MinioContainer(MINIO_IMAGE).start();
    endpoint = container.getConnectionUrl();
    accessKeyId = container.getUsername();
    secretAccessKey = container.getPassword();
    stop = async () => {
      await container.stop();
    };
  }
  const bucket = `wasfa-test-${randomUUID().slice(0, 8)}`;
  const s3 = new S3Client({
    endpoint,
    region: "auto",
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  return {
    env: {
      R2_UPLOADS_ENDPOINT: endpoint,
      R2_UPLOADS_BUCKET: bucket,
      R2_UPLOADS_ACCESS_KEY_ID: accessKeyId,
      R2_UPLOADS_SECRET_ACCESS_KEY: secretAccessKey,
    },
    s3,
    bucket,
    stop: async () => {
      s3.destroy();
      await stop();
    },
  };
}
