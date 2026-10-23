import { Module } from "@nestjs/common";

import { AssetsController } from "./assets.controller.js";
import { BrandingQueue } from "./branding-queue.js";
import { BrandingRepo } from "./branding.repo.js";
import { BrandingService } from "./branding.service.js";

/** Logos, favicon, symbol and the generated icon set uploaded from the admin panel, stored in `site_assets` and served at `/assets/:key`. */
@Module({
  controllers: [AssetsController],
  providers: [BrandingRepo, BrandingQueue, BrandingService],
  exports: [BrandingService],
})
export class BrandingModule {}
