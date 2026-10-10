import { Controller, Get, Res } from "@nestjs/common";

import { Public } from "../common/auth.guard.js";
import { AllowDuringMaintenance } from "../common/maintenance.guard.js";
import { SkipRateLimit } from "../common/rate-limit.js";

import { HealthService } from "./health.service.js";

import type { FastifyReply } from "fastify";

@Public()
// Probes must keep answering during maintenance, or the orchestrator would restart a healthy API.
@AllowDuringMaintenance()
@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get("live")
  @SkipRateLimit()
  live(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("ready")
  @SkipRateLimit()
  async ready(
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ status: "ok" | "unavailable" }> {
    const { ready } = await this.health.readiness();
    if (!ready) {
      reply.status(503);
      return { status: "unavailable" };
    }
    return { status: "ok" };
  }
}
