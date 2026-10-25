import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";

import { AdminContentController } from "./admin-content.controller.js";
import { ContentRenderService } from "./content-render.service.js";
import { ContentItemsRepo } from "./items.repo.js";
import { ContentItemsService } from "./items.service.js";
import { PreviewTokenService } from "./preview-token.service.js";
import { ContentWorkflowService } from "./workflow.service.js";

/**
 * The content platform admin editor API (Phase 4 WP3): items, revisions, autosave, workflow actions,
 * previews and corrections. Settings, audit and the outbox queue come from their global modules.
 * `ContentItemsService` and `ContentWorkflowService` are exported for the other content slices (the bulk
 * actions run the normal workflow per item).
 */
@Module({
  imports: [AuthModule],
  controllers: [AdminContentController],
  providers: [
    ContentItemsRepo,
    ContentRenderService,
    ContentItemsService,
    ContentWorkflowService,
    PreviewTokenService,
  ],
  exports: [ContentItemsService, ContentItemsRepo, ContentWorkflowService],
})
export class ContentModule {}
