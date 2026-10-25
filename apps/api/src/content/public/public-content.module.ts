import { Module } from "@nestjs/common";

import { PublicContentController } from "./public-content.controller.js";
import { PublicContentRepo } from "./public-content.repo.js";
import { PublicContentService } from "./public-content.service.js";

/** Public read API of the content platform (Phase 4 WP3): resolve, lists, taxonomy, sitemaps, previews. */
@Module({
  controllers: [PublicContentController],
  providers: [PublicContentRepo, PublicContentService],
  exports: [PublicContentService],
})
export class PublicContentModule {}
