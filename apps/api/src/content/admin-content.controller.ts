import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import {
  autosaveContentSchema,
  contentActionBodySchema,
  contentActionParamsSchema,
  contentIdParamSchema,
  contentListQuerySchema,
  contentRevisionParamsSchema,
  createContentItemSchema,
  createCorrectionSchema,
  renderPreviewSchema,
  updateContentItemSchema,
} from "@wasfa/shared/schemas/content";

import { AuditService } from "../audit/audit.service.js";
import { AuditCtx, Audited, type AuditScope } from "../audit/audited.decorator.js";
import { CurrentUser, type AuthenticatedUser } from "../common/current-user.js";
import { RequirePermission } from "../common/permissions.guard.js";
import { RateLimit } from "../common/rate-limit.js";
import { createZodDto } from "../common/validation.js";

import { ContentRenderService } from "./content-render.service.js";
import { ContentItemsService } from "./items.service.js";
import { PreviewTokenService } from "./preview-token.service.js";
import { ContentWorkflowService } from "./workflow.service.js";

import type { ContentAction } from "@wasfa/shared/content/constants";
import type { FastifyRequest } from "fastify";

class ListQueryDto extends createZodDto(contentListQuerySchema) {}
class CreateItemDto extends createZodDto(createContentItemSchema) {}
class UpdateItemDto extends createZodDto(updateContentItemSchema) {}
class AutosaveDto extends createZodDto(autosaveContentSchema) {}
class RenderPreviewDto extends createZodDto(renderPreviewSchema) {}
class ActionBodyDto extends createZodDto(contentActionBodySchema) {}
class ActionParamsDto extends createZodDto(contentActionParamsSchema) {}
class IdParamDto extends createZodDto(contentIdParamSchema) {}
class RevisionParamsDto extends createZodDto(contentRevisionParamsSchema) {}
class CorrectionDto extends createZodDto(createCorrectionSchema) {}

/** Audit verb per workflow action (`content.item.<verb>`). */
export const ACTION_AUDIT_VERB: Record<ContentAction, string> = {
  submit: "submitted",
  approve: "approved",
  request_changes: "changes_requested",
  schedule: "scheduled",
  unschedule: "unscheduled",
  publish: "published",
  unpublish: "unpublished",
  archive: "archived",
  unarchive: "unarchived",
};

/** Actions that need a recent sign-in, like `@RequireFreshAuth(10)` (that guard is per route; these share one). */
const FRESH_AUTH_ACTIONS: ReadonlySet<ContentAction> = new Set(["archive", "unpublish"]);
const FRESH_AUTH_MINUTES = 10;

/**
 * The admin content API (CONTENT-PLATFORM §11.4), editor slice. The route guard asks for
 * `content.read` on the action route; the permission each action really needs (submit: write,
 * approve: review, publish: publish, archive: manage) is enforced by the workflow state machine.
 */
@Controller("admin/content")
export class AdminContentController {
  constructor(
    private readonly items: ContentItemsService,
    private readonly workflow: ContentWorkflowService,
    private readonly renderer: ContentRenderService,
    private readonly previews: PreviewTokenService,
    private readonly audit: AuditService,
  ) {}

  @Get("items")
  @RequirePermission("content.read")
  @RateLimit(120)
  list(@Query() query: ListQueryDto) {
    return this.items.list(query);
  }

  @Post("items")
  @RequirePermission("content.write")
  @RateLimit(60)
  @Audited({ action: "content.item.created", targetType: "content_item" })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateItemDto,
    @AuditCtx() audit: AuditScope,
  ) {
    const detail = await this.items.create(await this.items.actorFor(user), body);
    audit.targetId = detail.id;
    audit.after = { status: detail.status, type: detail.type, locale: detail.locale };
    return detail;
  }

  @Get("items/:id")
  @RequirePermission("content.read")
  @RateLimit(240)
  async get(@CurrentUser() user: AuthenticatedUser, @Param() params: IdParamDto) {
    return this.items.get(params.id, await this.items.actorFor(user));
  }

  @Patch("items/:id")
  @RequirePermission("content.write")
  @RateLimit(60)
  @Audited({ action: "content.item.updated", targetType: "content_item" })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: IdParamDto,
    @Body() body: UpdateItemDto,
    @AuditCtx() audit: AuditScope,
  ) {
    const detail = await this.items.update(await this.items.actorFor(user), params.id, body);
    audit.after = {
      status: detail.status,
      revision: detail.currentRevision.number,
      payloadChanged: body.payload !== undefined,
      metaChanged: body.meta !== undefined,
    };
    return detail;
  }

  /** Autosave is neither a revision nor a business event: one mutable row per user and item, not audited. */
  @Put("items/:id/autosave")
  @RequirePermission("content.write")
  @RateLimit(120)
  async autosave(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: IdParamDto,
    @Body() body: AutosaveDto,
  ) {
    return this.items.autosave(await this.items.actorFor(user), params.id, body);
  }

  @Post("render-preview")
  @HttpCode(200)
  @RequirePermission("content.write")
  @RateLimit(30)
  renderPreview(@Body() body: RenderPreviewDto) {
    return this.renderer.preview(body);
  }

  @Post("items/:id/actions/:action")
  @HttpCode(200)
  @RequirePermission("content.read")
  @RateLimit(60)
  async act(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: FastifyRequest,
    @Param() params: ActionParamsDto,
    @Body() body: ActionBodyDto,
  ) {
    if (
      FRESH_AUTH_ACTIONS.has(params.action) &&
      Date.now() - user.session.reauthAt.getTime() > FRESH_AUTH_MINUTES * 60_000
    ) {
      throw new AppError(ErrorCode.AUTH_REQUIRED, {
        details: { reason: "reauth", maxAgeMinutes: FRESH_AUTH_MINUTES },
      });
    }
    const actor = await this.items.actorFor(user);
    const outcome = await this.workflow.act(params.id, params.action, body, actor);
    // The verb depends on the path parameter, so this route records its audit row itself.
    await this.audit.recordFor(
      request,
      {
        action: `content.item.${ACTION_AUDIT_VERB[params.action]}`,
        targetType: "content_item",
        targetId: params.id,
        before: { status: outcome.from },
        after: {
          status: outcome.to,
          // Gates or the daily cap the owner chose to publish past.
          ...(outcome.overridden.length > 0 ? { ownerOverride: outcome.overridden } : {}),
        },
      },
      { verbatim: true },
    );
    return this.items.get(params.id, actor);
  }

  @Post("items/:id/preview-token")
  @HttpCode(200)
  @RequirePermission("content.write")
  @RateLimit(30)
  previewToken(@Param() params: IdParamDto) {
    return this.previews.create(params.id);
  }

  @Get("items/:id/revisions")
  @RequirePermission("content.read")
  @RateLimit(120)
  revisions(@Param() params: IdParamDto) {
    return this.items.listRevisions(params.id);
  }

  @Get("items/:id/revisions/:revisionId")
  @RequirePermission("content.read")
  @RateLimit(120)
  revision(@Param() params: RevisionParamsDto) {
    return this.items.getRevision(params.id, params.revisionId);
  }

  @Post("items/:id/revisions/:revisionId/restore")
  @HttpCode(200)
  @RequirePermission("content.write")
  @RateLimit(30)
  @Audited({ action: "content.item.restored", targetType: "content_item" })
  async restore(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: RevisionParamsDto,
    @AuditCtx() audit: AuditScope,
  ) {
    const detail = await this.items.restore(
      await this.items.actorFor(user),
      params.id,
      params.revisionId,
    );
    audit.after = { revision: detail.currentRevision.number };
    return detail;
  }

  @Post("items/:id/corrections")
  @HttpCode(200)
  @RequirePermission("content.publish")
  @RateLimit(30)
  @Audited({ action: "content.item.correction_added", targetType: "content_item" })
  async correction(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: IdParamDto,
    @Body() body: CorrectionDto,
  ) {
    return this.items.addCorrection(await this.items.actorFor(user), params.id, body.summary);
  }
}
