import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { uploadsStorageConfig, type UploadsStorageConfig } from "@wasfa/shared/storage";

import { API_ENV } from "../config/config.module.js";

import type { ApiEnv } from "../config/env.js";

export interface PresignedPut {
  url: string;
  /** Sent verbatim by the browser: they are part of the signature. */
  headers: Record<string, string>;
}

export interface ObjectHead {
  bytes: number;
  contentType: string;
}

/**
 * The api's only door to the uploads bucket (R2 in production, MinIO locally and in tests). It
 * presigns and inspects; the bytes never pass through the api. The client is created on first use,
 * so an api without `R2_UPLOADS_*` still boots and answers upload routes with 503.
 */
@Injectable()
export class ObjectStorage implements OnApplicationShutdown {
  private readonly config: UploadsStorageConfig | undefined;
  private s3: S3Client | undefined;

  constructor(@Inject(API_ENV) env: ApiEnv) {
    this.config = uploadsStorageConfig(env);
  }

  get configured(): boolean {
    return this.config !== undefined;
  }

  /**
   * A PUT URL valid for `expiresIn` seconds that only accepts a body of exactly `bytes` bytes of
   * type `contentType` (and, when `sha256Hex` is given, with that SHA-256: the storage verifies it).
   * R2 has no presigned POST, so the size limit has to be part of the signature.
   */
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

  async presignGet(key: string, expiresIn: number): Promise<string> {
    const { s3, bucket } = this.connect();
    return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn });
  }

  /**
   * The bytes of a (small) stored object, for the one place the api itself sends an image on to a
   * model: the assistant's image questions. Refuses anything larger than `maxBytes`.
   */
  async getBytes(key: string, maxBytes: number): Promise<Uint8Array> {
    const { s3, bucket } = this.connect();
    try {
      const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if ((result.ContentLength ?? 0) > maxBytes || !result.Body) {
        throw new AppError(ErrorCode.UPSTREAM_UNAVAILABLE, { details: { reason: "file_too_large" } });
      }
      return await result.Body.transformToByteArray();
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(ErrorCode.UPSTREAM_UNAVAILABLE, { cause: error });
    }
  }

  /** Size and type of what is stored, or `null` when there is no such object. */
  async head(key: string): Promise<ObjectHead | null> {
    const { s3, bucket } = this.connect();
    try {
      const result = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return { bytes: result.ContentLength ?? 0, contentType: result.ContentType ?? "" };
    } catch (error) {
      if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404) {
        return null;
      }
      throw new AppError(ErrorCode.UPSTREAM_UNAVAILABLE, { cause: error });
    }
  }

  /** Deleting an object that is not there is not an error. */
  async remove(key: string): Promise<void> {
    const { s3, bucket } = this.connect();
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    } catch (error) {
      throw new AppError(ErrorCode.UPSTREAM_UNAVAILABLE, { cause: error });
    }
  }

  onApplicationShutdown(): void {
    this.s3?.destroy();
  }

  private connect(): { s3: S3Client; bucket: string } {
    if (this.config === undefined) {
      throw new AppError(ErrorCode.UPSTREAM_UNAVAILABLE, {
        details: { reason: "storage_not_configured" },
      });
    }
    this.s3 ??= new S3Client({
      endpoint: this.config.endpoint,
      region: this.config.region,
      credentials: {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
      },
      // R2 and MinIO both serve `<endpoint>/<bucket>/<key>`; virtual-host style needs wildcard DNS.
      forcePathStyle: true,
      // Presigned URLs must not grow checksum query parameters the browser would not send.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
    return { s3: this.s3, bucket: this.config.bucket };
  }
}
