import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import {
  mediaStorageConfig,
  uploadsStorageConfig,
  type UploadsStorageConfig,
} from "@wasfa/shared/storage";

import type { WorkerEnv } from "../config/env.js";

/**
 * The worker's side of the uploads bucket (R2 in production, MinIO locally and in tests): read the
 * upload, store the processed image, delete what is no longer needed. The api presigns; it never
 * passes bytes. Keys are built by `@wasfa/shared/storage`, never by hand.
 */
export class ObjectStore {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(config: UploadsStorageConfig) {
    this.bucket = config.bucket;
    this.s3 = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      // R2 and MinIO both serve `<endpoint>/<bucket>/<key>`; virtual-host style needs wildcard DNS.
      forcePathStyle: true,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }

  /** The object's bytes, or `null` when it does not exist. Larger than `maxBytes` throws before reading. */
  async get(key: string, maxBytes: number): Promise<Buffer | null> {
    try {
      const result = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if ((result.ContentLength ?? 0) > maxBytes) {
        throw new Error(`Object is larger than ${String(maxBytes)} bytes`);
      }
      const body = await result.Body?.transformToByteArray();
      return body === undefined ? null : Buffer.from(body);
    } catch (error) {
      if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  async put(key: string, body: Buffer, contentType: string, cacheControl?: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ...(cacheControl === undefined ? {} : { CacheControl: cacheControl }),
      }),
    );
  }

  /** Deleting an object that is not there succeeds. */
  async remove(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  close(): void {
    this.s3.destroy();
  }
}

/** The store for `R2_UPLOADS_*`, or `undefined` when they are not set (image jobs then fail loudly). */
export function createObjectStore(env: WorkerEnv): ObjectStore | undefined {
  const config = uploadsStorageConfig(env);
  return config === undefined ? undefined : new ObjectStore(config);
}

/**
 * The store for the PUBLIC media bucket (`R2_MEDIA_BUCKET`), or `undefined` when it is not set.
 * Never the uploads bucket: `mediaStorageConfig` refuses a media bucket equal to it.
 */
export function createMediaStore(env: WorkerEnv): ObjectStore | undefined {
  const config = mediaStorageConfig(env);
  return config === undefined ? undefined : new ObjectStore(config);
}
