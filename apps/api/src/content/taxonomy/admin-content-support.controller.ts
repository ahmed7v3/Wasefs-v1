import { Body, Controller, Get, HttpCode, Post, Query, Req } from "@nestjs/common";
import {
  bulkActionSchema,
  linkSuggestionsQuerySchema,
  reviewInboxQuerySchema,
} from "@wasfa/shared/schemas/content";

import { CurrentUser, type AuthenticatedUser } from "../../common/current-user.js";
import { RequireFreshAuth } from "../../common/fresh-auth.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto, parseWithSchema } from "../../common/validation.js";

import { BulkService } from "./bulk.service.js";
import { EditorOptionsService } from "./editor-options.service.js";
import { InboxService } from "./inbox.service.js";

import type { FastifyRequest } from "fastify";

class InboxQueryDto extends createZodDto(reviewInboxQuerySchema) {}
class LinksQueryDto extends createZodDto(linkSuggestionsQuerySchema) {}

/** Bulk actions, the reviewer inbox and the pickers of the editor. */
@Controller("admin/content")
export class AdminContentSupportController {
  constructor(
    private readonly bulk: BulkService,
    private readonly inbox: InboxService,
    private readonly options: EditorOptionsService,
  ) {}

  // Names and slugs only: read-only accounts need the pickers to filter the content list.
  @Get("options")
  @RequirePermission("content.read")
  @RateLimit(240)
  getOptions() {
    return this.options.options();
  }

  @Get("link-suggestions")
  @RequirePermission("content.write")
  @RateLimit(120)
  linkSuggestions(@Query() query: LinksQueryDto) {
    return this.options.linkSuggestions(query);
  }

  @Get("review-inbox")
  @RequirePermission("content.review")
  @RateLimit(240)
  reviewInbox(@CurrentUser() actor: AuthenticatedUser, @Query() query: InboxQueryDto) {
    return this.inbox.list(actor.id, query);
  }

  @Post("bulk")
  @HttpCode(200)
  @RequirePermission("content.manage")
  @RequireFreshAuth(10)
  @RateLimit(20)
  runBulk(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: FastifyRequest,
    @Body() body: unknown,
  ) {
    return this.bulk.run(actor, request, parseWithSchema(bulkActionSchema, body));
  }
}
