import { Module } from "@nestjs/common";

import { ContentModule } from "../content/content.module.js";
import { TaxonomyModule } from "../content/taxonomy/taxonomy.module.js";
import { MediaModule } from "../media/media.module.js";

import { PublishingApiArticlesController } from "./publishing-api-articles.controller.js";
import { PublishingApiArticlesService } from "./publishing-api-articles.service.js";
import { PublishingApiDocsController } from "./publishing-api-docs.controller.js";
import { PublishingIdempotencyService } from "./publishing-api-idempotency.js";
import { PublishingApiMediaController } from "./publishing-api-media.controller.js";
import { PublishingApiMediaService } from "./publishing-api-media.service.js";
import { PublishingApiTaxonomyController } from "./publishing-api-taxonomy.controller.js";
import { PublishingApiTaxonomyService } from "./publishing-api-taxonomy.service.js";
import { PublishingApiRepo } from "./publishing-api.repo.js";
import { PublishingModule } from "./publishing.module.js";

/**
 * The agent-facing Publishing API (`/publishing/v1`, docs/PUBLISHING-API.md): articles and their
 * workflow, media, taxonomy, people, idempotency, the OpenAPI spec and the agent guide. Every route sits
 * behind `@PublishingAuth` (the key module's guard); it builds on the content platform's own services,
 * so review, quality gates and publish caps are the ones the editors live under.
 */
@Module({
  imports: [ContentModule, TaxonomyModule, MediaModule, PublishingModule],
  controllers: [
    PublishingApiArticlesController,
    PublishingApiMediaController,
    PublishingApiTaxonomyController,
    PublishingApiDocsController,
  ],
  providers: [
    PublishingApiRepo,
    PublishingIdempotencyService,
    PublishingApiArticlesService,
    PublishingApiMediaService,
    PublishingApiTaxonomyService,
  ],
})
export class PublishingApiModule {}
