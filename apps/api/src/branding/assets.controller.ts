import { Controller, Get, Headers, Param, Query, Res } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import {
  BRANDING_ASSET_VERSION_LENGTH,
  brandingAssetParamSchema,
  brandingAssetQuerySchema,
} from "@wasfa/shared/schemas/branding";

import { Public } from "../common/auth.guard.js";
import { AllowDuringMaintenance } from "../common/maintenance.guard.js";
import { RateLimit } from "../common/rate-limit.js";
import { createZodDto } from "../common/validation.js";

import { BrandingRepo } from "./branding.repo.js";

import type { FastifyReply } from "fastify";

class AssetParamDto extends createZodDto(brandingAssetParamSchema) {}
class AssetQueryDto extends createZodDto(brandingAssetQuerySchema) {}

const IMMUTABLE = "public, max-age=31536000, immutable";
const REVALIDATE = "public, max-age=300";
/** An SVG shown as an image runs no script; this makes the same true if someone opens its URL directly. */
const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

/** `If-None-Match` may list several tags, weak ones (`W/`) included, or `*`. */
function matches(header: string | undefined, etag: string): boolean {
  if (header === undefined) return false;
  return header
    .split(",")
    .map((tag) => tag.trim().replace(/^W\//, ""))
    .some((tag) => tag === "*" || tag === etag);
}

@Controller("assets")
export class AssetsController {
  constructor(private readonly repo: BrandingRepo) {}

  /**
   * The logo and favicon uploaded from the admin panel. Public by design: they are drawn on the
   * sign-in page and in search results, and hold nothing private. The key is a closed set and only
   * validated bytes are ever stored (see `inspectAssetUpload`); the response forbids sniffing, and
   * an SVG additionally gets a CSP that blocks everything but its own inline styles.
   */
  @Public()
  @AllowDuringMaintenance()
  @Get(":key")
  @RateLimit(240)
  async asset(
    @Param() params: AssetParamDto,
    @Query() query: AssetQueryDto,
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const row = await this.repo.find(params.key);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND);

    const etag = `"${row.sha256}"`;
    // `?v=` is the first characters of the digest: the same bytes can be cached for a year.
    const versioned = query.v === row.sha256.slice(0, BRANDING_ASSET_VERSION_LENGTH);
    reply
      .header("etag", etag)
      .header("cache-control", versioned ? IMMUTABLE : REVALIDATE)
      .header("x-content-type-options", "nosniff")
      // The web app (another origin) draws these; the API default is same-site only.
      .header("cross-origin-resource-policy", "cross-origin");

    if (matches(ifNoneMatch, etag)) {
      await reply.status(304).send();
      return;
    }
    if (row.contentType === "image/svg+xml") {
      reply.header("content-security-policy", SVG_CSP).header("content-disposition", "inline");
    }
    await reply.status(200).type(row.contentType).send(row.data);
  }
}
