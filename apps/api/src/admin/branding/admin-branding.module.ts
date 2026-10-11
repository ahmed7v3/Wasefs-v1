import { Module } from "@nestjs/common";

import { BrandingModule } from "../../branding/branding.module.js";

import { AdminBrandingController } from "./admin-branding.controller.js";

/** Upload and removal of the logo and favicon (`/admin/branding/assets/:key`). */
@Module({
  imports: [BrandingModule],
  controllers: [AdminBrandingController],
})
export class AdminBrandingModule {}
