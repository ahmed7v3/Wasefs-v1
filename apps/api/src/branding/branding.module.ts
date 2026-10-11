import { Module } from "@nestjs/common";

import { AssetsController } from "./assets.controller.js";
import { BrandingRepo } from "./branding.repo.js";
import { BrandingService } from "./branding.service.js";

/** Logo and favicon uploaded from the admin panel, stored in `site_assets` and served at `/assets/:key`. */
@Module({
  controllers: [AssetsController],
  providers: [BrandingRepo, BrandingService],
  exports: [BrandingService],
})
export class BrandingModule {}
