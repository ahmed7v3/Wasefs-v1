import { Module } from "@nestjs/common";

import { SiteHealthController } from "./site-health.controller.js";
import { SiteHealthService } from "./site-health.service.js";

/** Web-vitals beacon, crawler hit counters and the admin site-health read model (Phase 4 WP1 §2.6, §5.8). */
@Module({
  controllers: [SiteHealthController],
  providers: [SiteHealthService],
})
export class SiteHealthModule {}
