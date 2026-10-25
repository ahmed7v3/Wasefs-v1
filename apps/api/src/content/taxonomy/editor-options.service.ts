import { Injectable } from "@nestjs/common";
import { contentPath } from "@wasfa/shared/content";
import { AppError, ErrorCode } from "@wasfa/shared/errors";

import { escapeLike } from "../../admin/common/keyset.js";

import { scoreSuggestion } from "./inbox-rules.js";
import { InboxRepo } from "./inbox.repo.js";

import type { ContentOptions } from "@wasfa/shared/schemas/content";

const MAX_SUGGESTIONS = 8;

/** The editor's pickers (`options`) and the internal-link suggestions. */
@Injectable()
export class EditorOptionsService {
  constructor(private readonly repo: InboxRepo) {}

  async options(): Promise<ContentOptions> {
    const [categories, tags, people] = await Promise.all([
      this.repo.categoriesWithReviewer(),
      this.repo.tagOptions(),
      this.repo.activePeople(),
    ]);
    const ref = (p: (typeof people)[number]) => ({
      id: p.id,
      name: p.nameAr,
      slug: p.slug,
      nameEn: p.nameEn,
    });
    return {
      categories: categories.map((row) => ({
        id: row.id,
        parentId: row.parentId,
        nameAr: row.nameAr,
        nameEn: row.nameEn,
        slugAr: row.slugAr,
        slugEn: row.slugEn,
        requiresMedicalReview: row.requiresMedicalReview,
        defaultReviewer:
          row.reviewerId === null
            ? null
            : { id: row.reviewerId, name: row.reviewerName ?? "", slug: row.reviewerSlug ?? "" },
      })),
      tags,
      authors: people.filter((p) => p.role !== "reviewer").map(ref),
      reviewers: people.filter((p) => p.role !== "author").map(ref),
    };
  }

  async linkSuggestions(query: { itemId: string; q: string; locale: "ar" | "en" }) {
    const item = await this.repo.itemForLinks(query.itemId);
    if (item === undefined) throw new AppError(ErrorCode.NOT_FOUND);
    const candidates = await this.repo.linkCandidates({
      ...query,
      like: `%${escapeLike(query.q)}%`,
    });
    const entities = await this.repo.entitiesOf(candidates.map((candidate) => candidate.id));
    const ranked = candidates
      .map((candidate) => ({
        candidate,
        score: scoreSuggestion({
          similarity: candidate.similarity,
          sameCategory: item.categoryId !== null && candidate.categoryId === item.categoryId,
          sharedEntities: (entities.get(candidate.id) ?? []).filter((key) => item.entities.has(key))
            .length,
        }),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SUGGESTIONS);
    return {
      items: ranked.map(({ candidate }) => ({
        title: candidate.title,
        path: contentPath(candidate.type, query.locale, candidate.slug),
        type: candidate.type,
      })),
    };
  }
}
