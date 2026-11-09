import { Module } from "@nestjs/common";

import { AdminPublishingKeysController } from "./admin-publishing-keys.controller.js";
import { AdminPublishingKeysService } from "./admin-publishing-keys.service.js";
import { PublishingKeyGuard } from "./publishing-key.guard.js";
import { PublishingKeyService } from "./publishing-key.service.js";
import { PublishingKeysRepo } from "./publishing-keys.repo.js";
import { PublishingMeController } from "./publishing-me.controller.js";
import {
  PublishingRequestLogInterceptor,
  PublishingRequestLogger,
} from "./publishing-request-log.js";

/**
 * Machine authentication of the Publishing API: keys, the Bearer guard, per-key limits, the request
 * log and the admin key management. Any module whose controllers use `@PublishingAuth()` imports this
 * one (the decorator's guard and interceptor resolve their dependencies from it). Settings, Redis,
 * audit and the invalidation bus come from their global modules.
 */
@Module({
  controllers: [AdminPublishingKeysController, PublishingMeController],
  providers: [
    PublishingKeysRepo,
    PublishingKeyService,
    PublishingKeyGuard,
    PublishingRequestLogger,
    PublishingRequestLogInterceptor,
    AdminPublishingKeysService,
  ],
  exports: [
    PublishingKeysRepo,
    PublishingKeyService,
    PublishingKeyGuard,
    PublishingRequestLogger,
    PublishingRequestLogInterceptor,
  ],
})
export class PublishingModule {}
