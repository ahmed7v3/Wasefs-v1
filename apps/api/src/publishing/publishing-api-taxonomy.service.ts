import { Injectable } from "@nestjs/common";
import { slugify } from "@wasfa/shared/content";
import { categoryInputSchema, tagInputSchema } from "@wasfa/shared/schemas/content";
import { titleIsArabic } from "@wasfa/shared/schemas/publishing";

import { AuditService } from "../audit/audit.service.js";
import { PeopleService } from "../content/taxonomy/people.service.js";
import { TaxonomyService } from "../content/taxonomy/taxonomy.service.js";

import { validationFailed } from "./publishing-api-errors.js";

import type { PublishingPrincipal } from "./publishing-principal.js";
import type { Category, Tag } from "@wasfa/shared/schemas/content";
import type {
  publishingCategoryInputSchema,
  publishingCategorySchema,
  publishingPersonSchema,
  publishingTagInputSchema,
  publishingTagSchema,
} from "@wasfa/shared/schemas/publishing";
import type { FastifyRequest } from "fastify";
import type { z } from "zod";

type ApiCategory = z.output<typeof publishingCategorySchema>;
type ApiTag = z.output<typeof publishingTagSchema>;
type ApiPerson = z.output<typeof publishingPersonSchema>;

const categoryOf = (row: Category, parentSlug: string | null): ApiCategory => ({
  id: row.id,
  slug: row.slugAr,
  slug_en: row.slugEn,
  name_ar: row.nameAr,
  name_en: row.nameEn,
  parent_slug: parentSlug,
  requires_medical_review: row.requiresMedicalReview,
});

const tagOf = (row: Tag): ApiTag => ({
  id: row.id,
  slug: row.slugAr ?? row.slugEn,
  name_ar: row.nameAr,
  name_en: row.nameEn,
});

/** Categories, tags and people as an integrator sees them: ids, slugs, names, nothing editorial. */
@Injectable()
export class PublishingApiTaxonomyService {
  constructor(
    private readonly taxonomy: TaxonomyService,
    private readonly people: PeopleService,
    private readonly audit: AuditService,
  ) {}

  async categories(): Promise<{ items: ApiCategory[] }> {
    const { items } = await this.taxonomy.listCategories();
    const slugOf = new Map(items.map((row) => [row.id, row.slugAr]));
    return {
      items: items.map((row) =>
        categoryOf(row, row.parentId === null ? null : (slugOf.get(row.parentId) ?? null)),
      ),
    };
  }

  /**
   * A key can add a category but never one that skips review: `requires_medical_review` is always on
   * for a category created through the API (an editor can relax it in the admin).
   */
  async createCategory(
    principal: PublishingPrincipal,
    request: FastifyRequest,
    input: z.output<typeof publishingCategoryInputSchema>,
  ): Promise<ApiCategory> {
    const { items } = await this.taxonomy.listCategories();
    let parentId: string | null = null;
    let parentSlug: string | null = null;
    if (input.parent !== undefined) {
      const wanted = input.parent.toLowerCase();
      const parent = items.find(
        (row) => row.slugAr === wanted || (row.slugEn !== null && row.slugEn === wanted),
      );
      if (parent === undefined) {
        throw validationFailed({
          parent: "unknown parent category slug; GET /categories lists them",
        });
      }
      parentId = parent.id;
      parentSlug = parent.slugAr;
    }
    const created = await this.taxonomy.createCategory(
      principal.ownerUserId,
      request,
      categoryInputSchema.parse({
        slugAr: input.slug,
        nameAr: input.name_ar,
        ...(input.name_en === undefined ? {} : { nameEn: input.name_en }),
        parentId,
        requiresMedicalReview: true,
      }),
    );
    await this.record(request, principal, "content.category.created", created.id);
    return categoryOf(created, parentSlug);
  }

  async tags(): Promise<{ items: ApiTag[] }> {
    return { items: (await this.taxonomy.listTags()).items.map(tagOf) };
  }

  async createTag(
    principal: PublishingPrincipal,
    request: FastifyRequest,
    input: z.output<typeof publishingTagInputSchema>,
  ): Promise<ApiTag> {
    const slug = input.slug ?? slugify(input.name_en ?? input.name_ar);
    if (slug === "") {
      throw validationFailed({
        slug: "could not derive a slug from the name: send one (a-z, 0-9, hyphens)",
      });
    }
    const arabicSite =
      input.slug === undefined && titleIsArabic(input.name_ar) && input.name_en === undefined;
    const created = await this.taxonomy.createTag(
      principal.ownerUserId,
      request,
      tagInputSchema.parse({
        nameAr: input.name_ar,
        ...(input.name_en === undefined ? {} : { nameEn: input.name_en }),
        ...(arabicSite ? { slugAr: slug } : { slugEn: slug }),
      }),
    );
    await this.record(request, principal, "content.tag.created", created.id);
    return tagOf(created);
  }

  /** Active people only, without licence numbers, bios or accounts. */
  async peopleList(): Promise<{ items: ApiPerson[] }> {
    const { items } = await this.people.list();
    return {
      items: items
        .filter((person) => person.active)
        .map((person) => ({
          id: person.id,
          slug: person.slug,
          name_ar: person.nameAr,
          name_en: person.nameEn,
          role: person.role,
        })),
    };
  }

  private record(
    request: FastifyRequest,
    principal: PublishingPrincipal,
    action: string,
    targetId: string,
  ): Promise<void> {
    return this.audit.recordFor(
      request,
      {
        actorId: null,
        action,
        targetType: action.includes("category") ? "content_category" : "content_tag",
        targetId,
        after: {
          actor: `api_key:${principal.keyId}`,
          key_name: principal.keyName,
          owner_user_id: principal.ownerUserId,
        },
      },
      { verbatim: true },
    );
  }
}
