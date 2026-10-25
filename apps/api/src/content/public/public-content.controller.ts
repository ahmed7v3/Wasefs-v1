import { Controller, Get, Param, Query, Res } from "@nestjs/common";
import {
  publicListQuerySchema,
  publicListResponseSchema,
  publicGlossaryIndexSchema,
  publicPathStateSchema,
  publicPreviewResponseSchema,
  publicResolveQuerySchema,
  publicResolveResponseSchema,
  publicSitemapQuerySchema,
  publicSitemapResponseSchema,
  publicTaxonomyListQuerySchema,
  publicTaxonomyListSchema,
  publicTaxonomyPageQuerySchema,
  publicTaxonomyPageSchema,
} from "@wasfa/shared/schemas/content";

import { Public } from "../../common/auth.guard.js";
import { AllowDuringMaintenance } from "../../common/maintenance.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import {
  publicGlossaryIndexQuerySchema,
  publicPreviewParamSchema,
} from "./public-content.schemas.js";
import { PublicContentService } from "./public-content.service.js";

import type { FastifyReply } from "fastify";

class ResolveQueryDto extends createZodDto(publicResolveQuerySchema) {}
class ListQueryDto extends createZodDto(publicListQuerySchema) {}
class TaxonomyPageQueryDto extends createZodDto(publicTaxonomyPageQuerySchema) {}
class TaxonomyListQueryDto extends createZodDto(publicTaxonomyListQuerySchema) {}
class GlossaryQueryDto extends createZodDto(publicGlossaryIndexQuerySchema) {}
class SitemapQueryDto extends createZodDto(publicSitemapQuerySchema) {}
class PreviewParamDto extends createZodDto(publicPreviewParamSchema) {}

/** Public content is cached by the web data cache and by CDNs; the tags revalidate it on publish. */
const CACHE = "public, max-age=30, stale-while-revalidate=300";

/**
 * The public read API of the content platform (CONTENT-PLATFORM §11.4). Every response is parsed
 * with the shared response schema, so a column added to a table can never leak by accident.
 */
@Public()
@AllowDuringMaintenance()
@Controller("public/content")
export class PublicContentController {
  constructor(private readonly content: PublicContentService) {}

  private cached(reply: FastifyReply): void {
    reply.header("cache-control", CACHE);
  }

  @Get("resolve")
  @RateLimit(240)
  async resolve(@Query() query: ResolveQueryDto, @Res({ passthrough: true }) reply: FastifyReply) {
    this.cached(reply);
    return publicResolveResponseSchema.parse(await this.content.resolve(query));
  }

  @Get("list")
  @RateLimit(240)
  async list(@Query() query: ListQueryDto, @Res({ passthrough: true }) reply: FastifyReply) {
    this.cached(reply);
    return publicListResponseSchema.parse(await this.content.list(query));
  }

  @Get("taxonomy-page")
  @RateLimit(240)
  async taxonomyPage(
    @Query() query: TaxonomyPageQueryDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    this.cached(reply);
    return publicTaxonomyPageSchema.parse(await this.content.taxonomyPage(query));
  }

  @Get("taxonomy-list")
  @RateLimit(240)
  async taxonomyList(
    @Query() query: TaxonomyListQueryDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    this.cached(reply);
    return publicTaxonomyListSchema.parse(await this.content.taxonomyList(query));
  }

  @Get("glossary-index")
  @RateLimit(240)
  async glossaryIndex(
    @Query() query: GlossaryQueryDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    this.cached(reply);
    return publicGlossaryIndexSchema.parse(await this.content.glossaryIndex(query.locale));
  }

  @Get("path-state")
  @RateLimit(240)
  async pathState(@Res({ passthrough: true }) reply: FastifyReply) {
    this.cached(reply);
    return publicPathStateSchema.parse(await this.content.pathState());
  }

  @Get("sitemap")
  @RateLimit(240)
  async sitemap(@Query() query: SitemapQueryDto, @Res({ passthrough: true }) reply: FastifyReply) {
    this.cached(reply);
    return publicSitemapResponseSchema.parse(await this.content.sitemap(query));
  }

  /** Never cached or indexed: a draft must not outlive its token in any shared cache. */
  @Get("preview/:token")
  @RateLimit(60)
  async preview(@Param() params: PreviewParamDto, @Res({ passthrough: true }) reply: FastifyReply) {
    reply.header("cache-control", "no-store");
    reply.header("x-robots-tag", "noindex");
    return publicPreviewResponseSchema.parse(await this.content.preview(params.token));
  }
}
