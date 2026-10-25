import { Module } from "@nestjs/common";

import { ContentModule } from "../content.module.js";
import { ContentItemsService } from "../items.service.js";
import { ContentWorkflowService } from "../workflow.service.js";

import { AdminContentSupportController } from "./admin-content-support.controller.js";
import { AdminPeopleController } from "./admin-people.controller.js";
import { AdminRedirectsController } from "./admin-redirects.controller.js";
import { AdminTaxonomyController } from "./admin-taxonomy.controller.js";
import { WorkflowBulkAdapter } from "./bulk-workflow.adapter.js";
import { CONTENT_BULK_PORT } from "./bulk.port.js";
import { BulkRepo } from "./bulk.repo.js";
import { BulkService } from "./bulk.service.js";
import { EditorOptionsService } from "./editor-options.service.js";
import { InboxRepo } from "./inbox.repo.js";
import { InboxService } from "./inbox.service.js";
import { PeopleRepo } from "./people.repo.js";
import { PeopleService } from "./people.service.js";
import { RedirectsRepo } from "./redirects.repo.js";
import { RedirectsService } from "./redirects.service.js";
import { TaxonomyRepo } from "./taxonomy.repo.js";
import { TaxonomyService } from "./taxonomy.service.js";

/**
 * Content taxonomy admin API (WP3): categories, tags, people, redirects, bulk actions, the reviewer
 * inbox and the editor pickers. The bulk port runs the normal editorial workflow per item
 * (`ContentWorkflowService.act`), so bulk schedule/unpublish/archive obey every state rule and gate.
 */
@Module({
  imports: [ContentModule],
  controllers: [
    AdminTaxonomyController,
    AdminPeopleController,
    AdminRedirectsController,
    AdminContentSupportController,
  ],
  providers: [
    TaxonomyRepo,
    TaxonomyService,
    PeopleRepo,
    PeopleService,
    RedirectsRepo,
    RedirectsService,
    BulkRepo,
    BulkService,
    InboxRepo,
    InboxService,
    EditorOptionsService,
    {
      provide: CONTENT_BULK_PORT,
      inject: [ContentWorkflowService, ContentItemsService],
      useFactory: (workflow: ContentWorkflowService, items: ContentItemsService) =>
        new WorkflowBulkAdapter(workflow, items),
    },
  ],
})
export class TaxonomyModule {}
