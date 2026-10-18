import { Module } from "@nestjs/common";

import { AdminSearchController } from "./admin-search.controller.js";
import { AdminSearchRepo } from "./admin-search.repo.js";
import { AdminSearchService } from "./admin-search.service.js";

@Module({
  controllers: [AdminSearchController],
  providers: [AdminSearchRepo, AdminSearchService],
})
export class AdminSearchModule {}
