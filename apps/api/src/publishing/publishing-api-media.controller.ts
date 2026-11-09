import { createHash } from "node:crypto";

import { Body, Controller, Get, Headers, Param, Patch, Post, Req, Res } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import {
  publishingMediaFetchSchema,
  publishingMediaFieldsSchema,
  publishingMediaPatchSchema,
} from "@wasfa/shared/schemas/publishing";
import "@fastify/multipart";

import { validationFailed, parseBody } from "./publishing-api-errors.js";
import {
  canonicalJson,
  parseIdempotencyKey,
  PublishingIdempotencyService,
  requestHash,
} from "./publishing-api-idempotency.js";
import { PUBLISH_MEDIA_MAX_BYTES } from "./publishing-api-media-sniff.js";
import { PublishingApiMediaService } from "./publishing-api-media.service.js";
import { CurrentKey, PublishingAuth, type PublishingPrincipal } from "./publishing-principal.js";

import type { FastifyReply, FastifyRequest } from "fastify";

/** Text fields a media upload may carry next to the `file` part (the library's metadata, see the spec §6). */
const FIELD_LIMIT = 12;
const FIELD_SIZE_MAX = 2_000;

interface Upload {
  fields: Record<string, unknown>;
  bytes: Buffer;
}

/** Fields that are JSON in a multipart text part. */
function coerceField(name: string, value: string): unknown {
  if (name === "decorative") return value === "true" ? true : value === "false" ? false : value;
  if (name === "focal_point") {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  }
  return value;
}

/** Reads `multipart/form-data`: text fields and exactly one `file` of at most 10 MB (413 above). */
async function readUpload(request: FastifyRequest): Promise<Upload> {
  if (!request.isMultipart()) {
    throw validationFailed({ file: "send multipart/form-data with a `file` part" });
  }
  const fields: Record<string, unknown> = {};
  let bytes: Buffer | undefined;
  try {
    const parts = request.parts({
      limits: {
        files: 1,
        fields: FIELD_LIMIT,
        parts: FIELD_LIMIT + 1,
        fieldSize: FIELD_SIZE_MAX,
        // One byte over the cap, so an oversize file is detected instead of silently truncated.
        fileSize: PUBLISH_MEDIA_MAX_BYTES + 1,
      },
    });
    for await (const part of parts) {
      if (part.type === "file") {
        if (part.fieldname !== "file" || bytes !== undefined) {
          throw validationFailed({ file: "exactly one part named `file` is accepted" });
        }
        bytes = await part.toBuffer();
        if (part.file.truncated) throw new AppError(ErrorCode.PAYLOAD_TOO_LARGE);
      } else if (typeof part.value === "string") {
        fields[part.fieldname] = coerceField(part.fieldname, part.value);
      }
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    const code = (error as { code?: unknown } | null)?.code;
    if (code === "FST_REQ_FILE_TOO_LARGE") throw new AppError(ErrorCode.PAYLOAD_TOO_LARGE);
    if (typeof code === "string" && code.startsWith("FST_")) {
      throw validationFailed({ file: "the multipart body could not be read" });
    }
    throw error;
  }
  if (bytes === undefined || bytes.length === 0) {
    throw validationFailed({ file: "a non-empty `file` part is required" });
  }
  return { fields, bytes };
}

/** `/publishing/v1/media`: upload, fetch by URL, read and relabel (scope `media:write`). */
@Controller("publishing/v1/media")
export class PublishingApiMediaController {
  constructor(
    private readonly media: PublishingApiMediaService,
    private readonly idempotency: PublishingIdempotencyService,
  ) {}

  @Post()
  @PublishingAuth("media:write")
  async upload(
    @CurrentKey() principal: PublishingPrincipal,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Headers("idempotency-key") idemHeader: string | undefined,
  ) {
    const key = parseIdempotencyKey(idemHeader);
    const upload = await readUpload(request);
    const fields = parseBody(publishingMediaFieldsSchema, upload.fields);
    // The identity of an upload is its bytes and its metadata, not the multipart boundary.
    const digest = createHash("sha256").update(upload.bytes).digest("hex");
    const result = await this.idempotency.run(
      principal.keyId,
      key,
      requestHash("POST", "/media", { file: digest, fields: canonicalJson(fields) }),
      async () => ({
        status: 202,
        body: await this.media.upload(principal, request, upload.bytes, fields),
      }),
    );
    reply.status(result.status);
    if (result.replayed) reply.header("idempotent-replayed", "true");
    return result.body;
  }

  @Post("fetch")
  @PublishingAuth("media:write")
  async fetch(
    @CurrentKey() principal: PublishingPrincipal,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Headers("idempotency-key") idemHeader: string | undefined,
    @Body() body: unknown,
  ) {
    const key = parseIdempotencyKey(idemHeader);
    const input = parseBody(publishingMediaFetchSchema, body);
    const result = await this.idempotency.run(
      principal.keyId,
      key,
      requestHash("POST", "/media/fetch", body),
      async () => ({ status: 202, body: await this.media.fetch(principal, request, input) }),
    );
    reply.status(result.status);
    if (result.replayed) reply.header("idempotent-replayed", "true");
    return result.body;
  }

  @Get(":id")
  @PublishingAuth("media:write")
  get(@Param("id") id: string) {
    return this.media.get(id);
  }

  @Patch(":id")
  @PublishingAuth("media:write")
  patch(
    @CurrentKey() principal: PublishingPrincipal,
    @Req() request: FastifyRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.media.patch(principal, request, id, parseBody(publishingMediaPatchSchema, body));
  }
}
