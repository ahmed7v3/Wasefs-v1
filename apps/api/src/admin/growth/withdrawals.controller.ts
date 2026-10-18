import { Readable } from "node:stream";

import { Body, Controller, Get, Header, Param, Post, Query, StreamableFile } from "@nestjs/common";
import {
  adminWithdrawalIdSchema,
  adminWithdrawalListQuerySchema,
  approveWithdrawalSchema,
  markWithdrawalPaidSchema,
  rejectWithdrawalSchema,
  revealDestinationSchema,
  withdrawalExportQuerySchema,
} from "@wasfa/shared/schemas/withdrawals";

import { AuditCtx, Audited, type AuditScope } from "../../audit/audited.decorator.js";
import { CurrentUser, type AuthenticatedUser } from "../../common/current-user.js";
import { RequireFreshAuth } from "../../common/fresh-auth.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import { AdminWithdrawalsService } from "./withdrawals.service.js";

class IdDto extends createZodDto(adminWithdrawalIdSchema) {}
class ListQueryDto extends createZodDto(adminWithdrawalListQuerySchema) {}
class ApproveDto extends createZodDto(approveWithdrawalSchema) {}
class RejectDto extends createZodDto(rejectWithdrawalSchema) {}
class PaidDto extends createZodDto(markWithdrawalPaidSchema) {}
class RevealDto extends createZodDto(revealDestinationSchema) {}
class ExportQueryDto extends createZodDto(withdrawalExportQuerySchema) {}

@Controller("admin/growth/withdrawals")
export class AdminWithdrawalsController {
  constructor(private readonly withdrawals: AdminWithdrawalsService) {}

  @Get()
  @RequirePermission("withdrawals.review")
  @RateLimit(60)
  list(@Query() query: ListQueryDto) {
    return this.withdrawals.list(query);
  }

  /** Declared before `:id` so `export.csv` is never read as an id. */
  @Get("export.csv")
  @RequirePermission("finance.export")
  @RateLimit(10)
  @Audited({ action: "withdrawal.export", targetType: "withdrawal_export", fields: ["week"] })
  @Header("Cache-Control", "no-store")
  exportCsv(@Query() query: ExportQueryDto, @AuditCtx() audit: AuditScope): StreamableFile {
    audit.after = { week: query.week };
    // The type travels with the file, not as a route header, so a refused query still answers JSON.
    return new StreamableFile(Readable.from(this.withdrawals.csv(query.week)), {
      type: "text/csv; charset=utf-8",
      disposition: 'attachment; filename="withdrawals.csv"',
    });
  }

  @Get(":id")
  @RequirePermission("withdrawals.review")
  @RateLimit(60)
  @Audited({ action: "withdrawal.opened", targetType: "withdrawal", targetParam: "id" })
  async detail(@Param() params: IdDto, @AuditCtx() audit: AuditScope) {
    audit.targetId = params.id;
    return this.withdrawals.detail(params.id);
  }

  @Post(":id/claim")
  @RequirePermission("withdrawals.review")
  @RateLimit(30)
  @Audited({
    action: "withdrawal.claimed",
    targetType: "withdrawal",
    targetParam: "id",
    afterFromResponse: true,
  })
  claim(
    @Param() params: IdDto,
    @CurrentUser() user: AuthenticatedUser,
    @AuditCtx() audit: AuditScope,
  ) {
    audit.targetId = params.id;
    return this.withdrawals.claim(params.id, user);
  }

  @Post(":id/approve")
  @RequirePermission("withdrawals.review")
  @RequireFreshAuth(10)
  @RateLimit(10)
  @Audited({
    action: "withdrawal.approved",
    targetType: "withdrawal",
    targetParam: "id",
    afterFromResponse: true,
  })
  approve(
    @Param() params: IdDto,
    @Body() body: ApproveDto,
    @CurrentUser() user: AuthenticatedUser,
    @AuditCtx() audit: AuditScope,
  ) {
    audit.targetId = params.id;
    return this.withdrawals.approve(params.id, user, body.override);
  }

  @Post(":id/reject")
  @RequirePermission("withdrawals.review")
  @RequireFreshAuth(10)
  @RateLimit(10)
  @Audited({ action: "withdrawal.rejected", targetType: "withdrawal", targetParam: "id" })
  reject(
    @Param() params: IdDto,
    @Body() body: RejectDto,
    @CurrentUser() user: AuthenticatedUser,
    @AuditCtx() audit: AuditScope,
  ) {
    audit.targetId = params.id;
    audit.after = { reasonKey: body.reasonKey, note: body.note };
    return this.withdrawals.reject(params.id, user, body);
  }

  /** Needs `withdrawals.pay`, not `review`: the admin who opens the money is a separate duty. */
  @Post(":id/reveal")
  @RequirePermission("withdrawals.pay")
  @RequireFreshAuth(10)
  @RateLimit(10)
  @Audited({
    action: "withdrawal.destination_revealed",
    targetType: "withdrawal",
    targetParam: "id",
  })
  reveal(
    @Param() params: IdDto,
    @Body() body: RevealDto,
    @CurrentUser() user: AuthenticatedUser,
    @AuditCtx() audit: AuditScope,
  ) {
    // The audit row names the request and the admin; the value itself is never recorded.
    audit.targetId = params.id;
    return this.withdrawals.reveal(params.id, user, body.override);
  }

  @Post(":id/mark-paid")
  @RequirePermission("withdrawals.pay")
  @RequireFreshAuth(10)
  @RateLimit(10)
  @Audited({
    action: "withdrawal.paid",
    targetType: "withdrawal",
    targetParam: "id",
    afterFromResponse: true,
  })
  markPaid(
    @Param() params: IdDto,
    @Body() body: PaidDto,
    @CurrentUser() user: AuthenticatedUser,
    @AuditCtx() audit: AuditScope,
  ) {
    audit.targetId = params.id;
    return this.withdrawals.markPaid(params.id, user, body);
  }
}
