import { Body, Controller, Get, Headers, Post, Req, Res } from "@nestjs/common";
import {
  publishingCategoryInputSchema,
  publishingTagInputSchema,
} from "@wasfa/shared/schemas/publishing";

import { parseBody } from "./publishing-api-errors.js";
import {
  parseIdempotencyKey,
  PublishingIdempotencyService,
  requestHash,
} from "./publishing-api-idempotency.js";
import { PublishingApiTaxonomyService } from "./publishing-api-taxonomy.service.js";
import { CurrentKey, PublishingAuth, type PublishingPrincipal } from "./publishing-principal.js";

import type { FastifyReply, FastifyRequest } from "fastify";

/** Categories, tags and people (docs/PUBLISHING-API.md §7.2). */
@Controller("publishing/v1")
export class PublishingApiTaxonomyController {
  constructor(
    private readonly taxonomy: PublishingApiTaxonomyService,
    private readonly idempotency: PublishingIdempotencyService,
  ) {}

  @Get("categories")
  @PublishingAuth("content:read")
  categories() {
    return this.taxonomy.categories();
  }

  @Post("categories")
  @PublishingAuth("taxonomy:write")
  async createCategory(
    @CurrentKey() principal: PublishingPrincipal,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Headers("idempotency-key") idemHeader: string | undefined,
    @Body() body: unknown,
  ) {
    const key = parseIdempotencyKey(idemHeader);
    const input = parseBody(publishingCategoryInputSchema, body);
    const result = await this.idempotency.run(
      principal.keyId,
      key,
      requestHash("POST", "/categories", body),
      async () => ({
        status: 201,
        body: await this.taxonomy.createCategory(principal, request, input),
      }),
    );
    reply.status(result.status);
    if (result.replayed) reply.header("idempotent-replayed", "true");
    return result.body;
  }

  @Get("tags")
  @PublishingAuth("content:read")
  tags() {
    return this.taxonomy.tags();
  }

  @Post("tags")
  @PublishingAuth("taxonomy:write")
  async createTag(
    @CurrentKey() principal: PublishingPrincipal,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Headers("idempotency-key") idemHeader: string | undefined,
    @Body() body: unknown,
  ) {
    const key = parseIdempotencyKey(idemHeader);
    const input = parseBody(publishingTagInputSchema, body);
    const result = await this.idempotency.run(
      principal.keyId,
      key,
      requestHash("POST", "/tags", body),
      async () => ({ status: 201, body: await this.taxonomy.createTag(principal, request, input) }),
    );
    reply.status(result.status);
    if (result.replayed) reply.header("idempotent-replayed", "true");
    return result.body;
  }

  @Get("people")
  @PublishingAuth("people:read")
  people() {
    return this.taxonomy.peopleList();
  }
}
