import { Readable } from "node:stream";

import { Controller, Get, Header, Query, StreamableFile } from "@nestjs/common";
import {
  referralOverviewQuerySchema,
  referralTreeQuerySchema,
} from "@wasfa/shared/schemas/admin-growth";

import { AuditCtx, Audited, type AuditScope } from "../../audit/audited.decorator.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import { AdminReferralsService } from "./admin-referrals.service.js";

class OverviewQueryDto extends createZodDto(referralOverviewQuerySchema) {}
class TreeQueryDto extends createZodDto(referralTreeQuerySchema) {}

/** Referral overview and tree (Task 3.13; ADMIN-CONSOLE-SPEC §6.1). */
@Controller("admin/growth/referrals")
export class AdminReferralsController {
  constructor(private readonly referrals: AdminReferralsService) {}

  @Get("overview")
  @RequirePermission("referrals.read")
  @RateLimit(30)
  overview(@Query() query: OverviewQueryDto) {
    return this.referrals.overview(query);
  }

  @Get("tree")
  @RequirePermission("referrals.read")
  @RateLimit(60)
  tree(@Query() query: TreeQueryDto) {
    return this.referrals.tree(query);
  }

  @Get("tree.csv")
  @RequirePermission("finance.export")
  @RateLimit(10)
  @Audited({
    action: "referral.tree_export",
    targetType: "referral_tree_export",
    fields: ["userId"],
  })
  @Header("Cache-Control", "no-store")
  async treeCsv(
    @Query() query: TreeQueryDto,
    @AuditCtx() audit: AuditScope,
  ): Promise<StreamableFile> {
    audit.targetId = query.userId;
    audit.after = { userId: query.userId, depth: query.depth };
    return new StreamableFile(Readable.from(await this.referrals.treeCsv(query)), {
      type: "text/csv; charset=utf-8",
      disposition: 'attachment; filename="referral-tree.csv"',
    });
  }
}
