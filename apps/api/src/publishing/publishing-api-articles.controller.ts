import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import {
  publishingArticleInputSchema,
  publishingArticlePatchSchema,
  publishingDeleteQuerySchema,
  publishingExternalIdParamSchema,
  publishingListQuerySchema,
  publishingPublishBodySchema,
  publishingScheduleBodySchema,
  publishingSubmitBodySchema,
} from "@wasfa/shared/schemas/publishing";

import { parseIfMatch, PublishingApiArticlesService } from "./publishing-api-articles.service.js";
import { parseBody } from "./publishing-api-errors.js";
import {
  parseIdempotencyKey,
  PublishingIdempotencyService,
  requestHash,
} from "./publishing-api-idempotency.js";
import { CurrentKey, PublishingAuth, type PublishingPrincipal } from "./publishing-principal.js";

import type { FastifyReply, FastifyRequest } from "fastify";

/*
 * `/publishing/v1/articles`: the agent-facing content API (docs/PUBLISHING-API.md §7). Every route is
 * `@PublishingAuth(scope)`; the route table (publishing-api-route-table.ts) lists the same routes and a
 * test keeps the two equal. Bodies are parsed here with the shared snake_case schemas.
 */
@Controller("publishing/v1/articles")
export class PublishingApiArticlesController {
  constructor(
    private readonly articles: PublishingApiArticlesService,
    private readonly idempotency: PublishingIdempotencyService,
  ) {}

  @Post()
  @PublishingAuth("content:write")
  async create(
    @CurrentKey() principal: PublishingPrincipal,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Headers("idempotency-key") idemHeader: string | undefined,
    @Body() body: unknown,
  ) {
    const key = parseIdempotencyKey(idemHeader);
    const input = parseBody(publishingArticleInputSchema, body);
    const result = await this.idempotency.run(
      principal.keyId,
      key,
      requestHash("POST", "/articles", body),
      async () => {
        const written = await this.articles.create(principal, request, input);
        return { status: written.status, body: written.article };
      },
    );
    reply.status(result.status);
    if (result.replayed) reply.header("idempotent-replayed", "true");
    etag(reply, result.body);
    return result.body;
  }

  @Post("validate")
  @HttpCode(200)
  @PublishingAuth("content:write")
  validate(@CurrentKey() principal: PublishingPrincipal, @Body() body: unknown) {
    return this.articles.validate(principal, parseBody(publishingArticleInputSchema, body));
  }

  @Put("by-external-id/:external_id")
  @PublishingAuth("content:write")
  async upsert(
    @CurrentKey() principal: PublishingPrincipal,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Headers("if-match") ifMatch: string | undefined,
    @Param("external_id") externalId: string,
    @Body() body: unknown,
  ) {
    const params = parseBody(publishingExternalIdParamSchema, { external_id: externalId });
    const input = parseBody(publishingArticleInputSchema, body);
    const written = await this.articles.upsert(
      principal,
      request,
      params.external_id,
      input,
      parseIfMatch(ifMatch),
    );
    reply.status(written.status);
    etag(reply, written.article);
    return written.article;
  }

  @Get()
  @PublishingAuth("content:read")
  list(@CurrentKey() principal: PublishingPrincipal, @Query() query: unknown) {
    return this.articles.list(principal, parseBody(publishingListQuerySchema, query));
  }

  @Get(":id")
  @PublishingAuth("content:read")
  async get(
    @CurrentKey() principal: PublishingPrincipal,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("id") id: string,
  ) {
    const article = await this.articles.get(principal, id);
    etag(reply, article);
    return article;
  }

  @Patch(":id")
  @PublishingAuth("content:write")
  async patch(
    @CurrentKey() principal: PublishingPrincipal,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Headers("if-match") ifMatch: string | undefined,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const article = await this.articles.patch(
      principal,
      request,
      id,
      parseBody(publishingArticlePatchSchema, body),
      parseIfMatch(ifMatch),
    );
    etag(reply, article);
    return article;
  }

  @Post(":id/submit")
  @HttpCode(200)
  @PublishingAuth("content:write")
  async submit(
    @CurrentKey() principal: PublishingPrincipal,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Headers("if-match") ifMatch: string | undefined,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    parseBody(publishingSubmitBodySchema, body ?? {});
    const article = await this.articles.submit(principal, request, id, parseIfMatch(ifMatch));
    etag(reply, article);
    return article;
  }

  @Post(":id/publish")
  @HttpCode(200)
  @PublishingAuth("content:publish")
  async publish(
    @CurrentKey() principal: PublishingPrincipal,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Headers("if-match") ifMatch: string | undefined,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const parsed = parseBody(publishingPublishBodySchema, body ?? {});
    const article = await this.articles.publish(
      principal,
      request,
      id,
      parsed,
      parseIfMatch(ifMatch),
    );
    etag(reply, article);
    return article;
  }

  @Post(":id/schedule")
  @HttpCode(200)
  @PublishingAuth("content:publish")
  async schedule(
    @CurrentKey() principal: PublishingPrincipal,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Headers("if-match") ifMatch: string | undefined,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const parsed = parseBody(publishingScheduleBodySchema, body);
    const article = await this.articles.schedule(
      principal,
      request,
      id,
      parsed.scheduled_at,
      parseIfMatch(ifMatch),
    );
    etag(reply, article);
    return article;
  }

  @Post(":id/unpublish")
  @HttpCode(200)
  @PublishingAuth("content:publish")
  async unpublish(
    @CurrentKey() principal: PublishingPrincipal,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("id") id: string,
  ) {
    const article = await this.articles.unpublish(principal, request, id);
    etag(reply, article);
    return article;
  }

  @Delete(":id")
  @PublishingAuth("content:write")
  remove(
    @CurrentKey() principal: PublishingPrincipal,
    @Req() request: FastifyRequest,
    @Param("id") id: string,
    @Query() query: unknown,
  ) {
    const parsed = parseBody(publishingDeleteQuerySchema, query);
    return this.articles.remove(principal, request, id, parsed.redirect_to);
  }

  @Get(":id/revisions")
  @PublishingAuth("content:read")
  revisions(@CurrentKey() principal: PublishingPrincipal, @Param("id") id: string) {
    return this.articles.revisions(principal, id);
  }
}

/** `ETag: "<revision>"` on every article answer, for `If-Match`. */
function etag(reply: FastifyReply, body: unknown): void {
  const revision = (body as { revision?: unknown } | null)?.revision;
  if (typeof revision === "number") reply.header("etag", `"${String(revision)}"`);
}
