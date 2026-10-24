import { Module } from "@nestjs/common";

import { BrandingModule } from "../../branding/branding.module.js";

import { AdminBrandingController } from "./admin-branding.controller.js";

/** Listing, upload, removal and revert of the brand images (`/admin/branding/assets/:key`). */
@Module({
  imports: [BrandingModule],
  controllers: [AdminBrandingController],
})
export class AdminBrandingModule {}
