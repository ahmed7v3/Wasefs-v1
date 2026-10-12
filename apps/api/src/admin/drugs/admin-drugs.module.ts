import { Module } from "@nestjs/common";

import { DrugsModule } from "../../drugs/drugs.module.js";

import { AdminDrugImportsController } from "./admin-drug-imports.controller.js";
import { AdminDrugImportsRepo } from "./admin-drug-imports.repo.js";
import { AdminDrugImportsService } from "./admin-drug-imports.service.js";
import { AdminDrugsController } from "./admin-drugs.controller.js";
import { AdminDrugsRepo } from "./admin-drugs.repo.js";
import { AdminDrugsService } from "./admin-drugs.service.js";
import { DrugImportStore } from "./drug-import.store.js";

/** Drug database admin under `/admin/drugs`: browser, edit, aliases, merge, and the import wizard (Task 2.7). */
@Module({
  imports: [DrugsModule],
  controllers: [AdminDrugsController, AdminDrugImportsController],
  providers: [
    AdminDrugsRepo,
    AdminDrugsService,
    AdminDrugImportsRepo,
    AdminDrugImportsService,
    DrugImportStore,
  ],
})
export class AdminDrugsModule {}
