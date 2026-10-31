import { Controller, Delete, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { waAgentDlqIdParamSchema, waAgentDlqQuerySchema } from "@wasfa/shared/schemas/wa-agent";

import { Audited } from "../../audit/audited.decorator.js";
import { RequireFreshAuth } from "../../common/fresh-auth.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";
import { DlqService } from "../../wa-agent/transport/dlq.service.js";

class DlqIdParamDto extends createZodDto(waAgentDlqIdParamSchema) {}
class DlqQueryDto extends createZodDto(waAgentDlqQuerySchema) {}

/**
 * The agent's dead-letter stream: stream entries whose handler failed five times. Listing is
 * `wa_agent.read`; replay and discard are `wa_agent.write` with a fresh login, audited by the
 * entry id only (no payload in the audit row).
 */
@Controller("admin/wa-agent/dlq")
export class WaAgentDlqController {
  constructor(private readonly dlq: DlqService) {}

  @Get()
  @RequirePermission("wa_agent.read")
  @RateLimit(60)
  list(@Query() query: DlqQueryDto) {
    return this.dlq.list(query.limit);
  }

  @Post(":id/replay")
  @HttpCode(200)
  @RequirePermission("wa_agent.write")
  @RequireFreshAuth(10)
  @RateLimit(30)
  @Audited({ action: "wa_agent.dlq.replay", targetType: "wa_agent_dlq" })
  async replay(@Param() params: DlqIdParamDto) {
    return { status: await this.dlq.replay(params.id) };
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("wa_agent.write")
  @RequireFreshAuth(10)
  @RateLimit(30)
  @Audited({ action: "wa_agent.dlq.discard", targetType: "wa_agent_dlq" })
  async discard(@Param() params: DlqIdParamDto): Promise<void> {
    await this.dlq.discard(params.id);
  }
}
