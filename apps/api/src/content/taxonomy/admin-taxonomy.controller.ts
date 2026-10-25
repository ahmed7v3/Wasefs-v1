import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from "@nestjs/common";
import {
  categoryInputSchema,
  contentIdParamSchema,
  mergeTagsSchema,
  reorderCategoriesSchema,
  tagInputSchema,
} from "@wasfa/shared/schemas/content";

import { CurrentUser, type AuthenticatedUser } from "../../common/current-user.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import { TaxonomyService } from "./taxonomy.service.js";

import type { FastifyRequest } from "fastify";

class CategoryDto extends createZodDto(categoryInputSchema) {}
class ReorderDto extends createZodDto(reorderCategoriesSchema) {}
class TagDto extends createZodDto(tagInputSchema) {}
class MergeDto extends createZodDto(mergeTagsSchema) {}
class IdDto extends createZodDto(contentIdParamSchema) {}

/** Categories and tags: reads `content.read`, writes `content.manage` (CONTENT-PLATFORM section 11.4). */
@Controller("admin/content")
export class AdminTaxonomyController {
  constructor(private readonly taxonomy: TaxonomyService) {}

  @Get("categories")
  @RequirePermission("content.read")
  @RateLimit(240)
  categories() {
    return this.taxonomy.listCategories();
  }

  @Post("categories")
  @RequirePermission("content.manage")
  @RateLimit(60)
  createCategory(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: FastifyRequest,
    @Body() body: CategoryDto,
  ) {
    return this.taxonomy.createCategory(actor.id, request, body);
  }

  @Post("categories/reorder")
  @HttpCode(200)
  @RequirePermission("content.manage")
  @RateLimit(60)
  reorderCategories(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: FastifyRequest,
    @Body() body: ReorderDto,
  ) {
    return this.taxonomy.reorderCategories(actor.id, request, body.parentId, body.ids);
  }

  @Patch("categories/:id")
  @RequirePermission("content.manage")
  @RateLimit(60)
  updateCategory(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: FastifyRequest,
    @Param() params: IdDto,
    @Body() body: CategoryDto,
  ) {
    return this.taxonomy.updateCategory(actor.id, request, params.id, body);
  }

  @Delete("categories/:id")
  @HttpCode(204)
  @RequirePermission("content.manage")
  @RateLimit(60)
  deleteCategory(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: FastifyRequest,
    @Param() params: IdDto,
  ) {
    return this.taxonomy.deleteCategory(actor.id, request, params.id);
  }

  @Get("tags")
  @RequirePermission("content.read")
  @RateLimit(240)
  tags() {
    return this.taxonomy.listTags();
  }

  @Post("tags")
  @RequirePermission("content.manage")
  @RateLimit(60)
  createTag(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: FastifyRequest,
    @Body() body: TagDto,
  ) {
    return this.taxonomy.createTag(actor.id, request, body);
  }

  @Post("tags/merge")
  @HttpCode(200)
  @RequirePermission("content.manage")
  @RateLimit(30)
  mergeTags(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: FastifyRequest,
    @Body() body: MergeDto,
  ) {
    return this.taxonomy.mergeTags(actor.id, request, body.fromId, body.intoId);
  }

  @Patch("tags/:id")
  @RequirePermission("content.manage")
  @RateLimit(60)
  updateTag(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: FastifyRequest,
    @Param() params: IdDto,
    @Body() body: TagDto,
  ) {
    return this.taxonomy.updateTag(actor.id, request, params.id, body);
  }

  @Delete("tags/:id")
  @HttpCode(204)
  @RequirePermission("content.manage")
  @RateLimit(60)
  deleteTag(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: FastifyRequest,
    @Param() params: IdDto,
  ) {
    return this.taxonomy.deleteTag(actor.id, request, params.id);
  }
}
