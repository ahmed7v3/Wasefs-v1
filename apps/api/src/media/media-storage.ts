import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { mediaStorageConfig, type UploadsStorageConfig } from "@wasfa/shared/storage";

import { API_ENV } from "../config/config.module.js";

import type { ApiEnv } from "../config/env.js";

export interface PresignedPut {
  url: string;
  /** Sent verbatim by the browser: they are part of the signature. */
  headers: Record<string, string>;
}

/**
 * The api's only door to the PUBLIC media bucket. It presigns the staging upload and checks that
 * the object arrived; the bytes never pass through the api. The bucket comes from `R2_MEDIA_BUCKET`
 * and can never be the private uploads bucket (`mediaStorageConfig` refuses that). The client is
 * created on first use, so an api without media configuration still boots and answers 503.
 */
@Injectable()
export class MediaStorage implements OnApplicationShutdown {
  private readonly config: UploadsStorageConfig | undefined;
  private s3: S3Client | undefined;

  constructor(@Inject(API_ENV) env: ApiEnv) {
    this.config = mediaStorageConfig(env);
  }

  get bucket(): string | undefined {
    return this.config?.bucket;
  }

  /** A PUT URL that only accepts exactly `bytes` bytes of `contentType` whose SHA-256 is `sha256Hex`. */
  async presignPut(options: {
    key: string;
    contentType: string;
    bytes: number;
    sha256Hex: string;
    expiresIn: number;
  }): Promise<PresignedPut> {
    const { s3, bucket } = this.connect();
    const checksum = Buffer.from(options.sha256Hex, "hex").toString("base64");
    const url = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: bucket,
        Key: options.key,
        ContentType: options.contentType,
        ContentLength: options.bytes,
        ChecksumSHA256: checksum,
      }),
      {
        expiresIn: options.expiresIn,
        // Without these the checksum would move into the query string and the length would stay unsigned.
        signableHeaders: new Set(["content-type", "content-length", "x-amz-checksum-sha256"]),
        unhoistableHeaders: new Set(["x-amz-checksum-sha256"]),
      },
    );
    return {
      url,
      headers: { "Content-Type": options.contentType, "x-amz-checksum-sha256": checksum },
    };
  }

  /** Size of the stored object, or `null` when there is none. */
  async headBytes(key: string): Promise<number | null> {
    const { s3, bucket } = this.connect();
    try {
      const result = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return result.ContentLength ?? 0;
    } catch (error) {
      if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404) {
        return null;
      }
      throw new AppError(ErrorCode.UPSTREAM_UNAVAILABLE, { cause: error });
    }
  }

  onApplicationShutdown(): void {
    this.s3?.destroy();
  }

  private connect(): { s3: S3Client; bucket: string } {
    if (this.config === undefined) {
      throw new AppError(ErrorCode.UPSTREAM_UNAVAILABLE, {
        details: { reason: "media_storage_not_configured" },
      });
    }
    this.s3 ??= new S3Client({
      endpoint: this.config.endpoint,
      region: this.config.region,
      credentials: {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
      },
      forcePathStyle: true,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
    return { s3: this.s3, bucket: this.config.bucket };
  }
}
