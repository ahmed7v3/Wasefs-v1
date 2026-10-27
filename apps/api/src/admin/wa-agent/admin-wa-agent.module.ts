import { Module } from "@nestjs/common";

import { FilesModule } from "../../files/files.module.js";
import { WaAgentModule } from "../../wa-agent/wa-agent.module.js";

import { AdminWaAgentController } from "./admin-wa-agent.controller.js";
import { AdminWaAgentRepo } from "./admin-wa-agent.repo.js";
import { AdminWaAgentService } from "./admin-wa-agent.service.js";

/** The admin panel of the WhatsApp AI agent (`/admin/wa-agent`). */
@Module({
  imports: [WaAgentModule, FilesModule],
  controllers: [AdminWaAgentController],
  providers: [AdminWaAgentRepo, AdminWaAgentService],
})
export class AdminWaAgentModule {}
