import { Controller, Get, Query, Req } from "@nestjs/common";
import {
  adminSearchQuerySchema,
  adminSearchResponseSchema,
} from "@wasfa/shared/schemas/admin-billing-console";

import { AuditService } from "../../audit/audit.service.js";
import { CurrentUser, type AuthenticatedUser } from "../../common/current-user.js";
import { RequireAnyPermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import { AdminSearchService } from "./admin-search.service.js";

import type { FastifyRequest } from "fastify";

class SearchQueryDto extends createZodDto(adminSearchQuerySchema) {}

@Controller("admin/search")
export class AdminSearchController {
  constructor(
    private readonly searchService: AdminSearchService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequireAnyPermission("users.read", "billing.read", "referrals.read")
  @RateLimit(60)
  async search(
    @Query() query: SearchQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: FastifyRequest,
  ) {
    const result = await this.searchService.search(query.q, user);
    if (result.userResultCount > 0) {
      await this.audit.recordFor(request, {
        action: "admin.search",
        targetType: "search",
        after: { resultCount: result.userResultCount },
      });
    }
    return adminSearchResponseSchema.parse({ items: result.items });
  }
}
