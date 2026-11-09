import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";

import { MediaService } from "../media/media.service.js";

import { notFound, validationFailed } from "./publishing-api-errors.js";
import { mapMediaMeta } from "./publishing-api-mapper.js";
import { assertAcceptableImage, PUBLISH_MEDIA_MAX_BYTES } from "./publishing-api-media-sniff.js";
import { fetchPublicBytes, type FetchOptions } from "./publishing-api-ssrf.js";

import type { PublishingPrincipal } from "./publishing-principal.js";
import type { MediaAsset, PatchMediaInput } from "@wasfa/shared/schemas/media";
import type { PublishingMediaFetch, PublishingMediaFields } from "@wasfa/shared/schemas/publishing";
import type { FastifyRequest } from "fastify";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ApiMedia {
  id: string;
  status: "processing" | "ready" | "rejected";
  deduplicated?: boolean;
  width: number | null;
  height: number | null;
  mime: string | null;
  alt: string | null;
  alt_en: string | null;
  caption: string | null;
  credit: string | null;
  licence: string;
  reject_reason: string | null;
}

export function toApiMedia(asset: MediaAsset, deduplicated?: boolean): ApiMedia {
  return {
    id: asset.id,
    // A staged asset is on its way to the worker; to an integrator both mean "not ready yet".
    status:
      asset.status === "ready" ? "ready" : asset.status === "rejected" ? "rejected" : "processing",
    ...(deduplicated === undefined ? {} : { deduplicated }),
    width: asset.width,
    height: asset.height,
    mime: asset.mime,
    alt: asset.altAr,
    alt_en: asset.altEn,
    caption: asset.caption,
    credit: asset.credit,
    licence: asset.licence,
    reject_reason: asset.rejectReason,
  };
}

/** Rights validation answers in the library's field names; the API's are snake_case. */
function translateMediaError(error: unknown): unknown {
  if (!(error instanceof AppError) || error.code !== ErrorCode.VALIDATION_FAILED) return error;
  const fields = Array.isArray(error.details?.fields) ? error.details.fields.map(String) : [];
  if (fields.length === 0) return error;
  const names: Record<string, string> = { licenceRef: "licence_ref", credit: "credit" };
  return validationFailed(
    Object.fromEntries(
      fields.map((field) => [
        names[field] ?? field,
        field === "credit"
          ? "required for a cc-by licence"
          : "required for a public-domain licence (where it was found)",
      ]),
    ),
  );
}

/** Only fill what the existing asset leaves blank: a repeat upload must not overwrite someone's alt text. */
function blankOnly(existing: MediaAsset, patch: PatchMediaInput): PatchMediaInput {
  const out: PatchMediaInput = {};
  const blank = (value: string | null): boolean => value === null || value.trim() === "";
  if (patch.altAr !== undefined && blank(existing.altAr)) out.altAr = patch.altAr;
  if (patch.altEn !== undefined && blank(existing.altEn)) out.altEn = patch.altEn;
  if (patch.caption !== undefined && blank(existing.caption)) out.caption = patch.caption;
  if (patch.credit !== undefined && blank(existing.credit)) out.credit = patch.credit;
  return out;
}

@Injectable()
export class PublishingApiMediaService {
  constructor(private readonly media: MediaService) {}

  /** `POST /media`: bytes the request carried. */
  upload(
    principal: PublishingPrincipal,
    request: FastifyRequest,
    bytes: Buffer,
    fields: PublishingMediaFields,
  ): Promise<ApiMedia> {
    return this.ingest(principal, request, bytes, fields);
  }

  /** `POST /media/fetch`: the server downloads under the SSRF guard, then the same path as an upload. */
  async fetch(
    principal: PublishingPrincipal,
    request: FastifyRequest,
    input: PublishingMediaFetch,
    options: Partial<FetchOptions> = {},
  ): Promise<ApiMedia> {
    const { source_url: sourceUrl, ...fields } = input;
    const fetched = await fetchPublicBytes(sourceUrl, {
      maxBytes: PUBLISH_MEDIA_MAX_BYTES,
      ...options,
    });
    return this.ingest(principal, request, fetched.bytes, fields);
  }

  async get(id: string): Promise<ApiMedia> {
    if (!UUID.test(id)) throw notFound();
    return toApiMedia(await this.media.get(id));
  }

  /** Only assets this key's owner uploaded (through the API or the admin): the library's other images are not for a key to relabel. */
  async patch(
    principal: PublishingPrincipal,
    request: FastifyRequest,
    id: string,
    fields: Partial<PublishingMediaFields>,
  ): Promise<ApiMedia> {
    if (!UUID.test(id)) throw notFound();
    const createdBy = await this.media.createdBy(id);
    if (createdBy === undefined || createdBy !== principal.ownerUserId) throw notFound();
    const patch = mapMediaMeta(fields);
    try {
      return toApiMedia(await this.media.patch(principal.ownerUserId, request, id, patch));
    } catch (error) {
      throw translateMediaError(error);
    }
  }

  private async ingest(
    principal: PublishingPrincipal,
    request: FastifyRequest,
    bytes: Buffer,
    fields: PublishingMediaFields,
  ): Promise<ApiMedia> {
    const { mime, sha256 } = assertAcceptableImage(bytes);
    const { asset, deduplicated } = await this.media.ingestBytes(request, {
      body: bytes,
      mime,
      sha256,
      ownerUserId: principal.ownerUserId,
      actor: `api_key:${principal.keyId}`,
    });
    const wanted = mapMediaMeta(fields);
    const patch = deduplicated ? blankOnly(asset, wanted) : wanted;
    if (Object.keys(patch).length === 0) return toApiMedia(asset, deduplicated);
    try {
      const updated = await this.media.patch(principal.ownerUserId, request, asset.id, patch);
      return toApiMedia(updated, deduplicated);
    } catch (error) {
      throw translateMediaError(error);
    }
  }
}
