import { Injectable } from "@nestjs/common";

import { decodeCursor, encodeCursor } from "../../admin/common/keyset.js";

import { ageHours, inboxDiffStats, resolveMineFilter } from "./inbox-rules.js";
import { InboxRepo } from "./inbox.repo.js";
import { PeopleRepo } from "./people.repo.js";

import type { ReviewInboxItem } from "@wasfa/shared/schemas/content";

@Injectable()
export class InboxService {
  constructor(
    private readonly repo: InboxRepo,
    private readonly people: PeopleRepo,
  ) {}

  async list(
    actorId: string,
    query: {
      categoryId?: string | undefined;
      mine?: boolean | undefined;
      cursor?: string | undefined;
      limit: number;
    },
  ): Promise<{ items: ReviewInboxItem[]; nextCursor: string | null }> {
    const mine = resolveMineFilter(
      query.mine,
      query.mine === true ? await this.people.idForUser(actorId) : null,
    );
    if (mine.kind === "none") return { items: [], nextCursor: null };

    const rows = await this.repo.inReview({
      categoryId: query.categoryId,
      mine,
      cursor: decodeCursor(query.cursor, "uuid"),
      limit: query.limit,
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const now = new Date();
    return {
      items: page.map((row) => ({
        id: row.id,
        type: row.type,
        locale: row.locale,
        slug: row.slug,
        title: row.title,
        category:
          row.categoryId === null ? null : { id: row.categoryId, name: row.categoryName ?? "" },
        author:
          row.authorId === null
            ? null
            : { id: row.authorId, name: row.authorName ?? "", slug: row.authorSlug ?? "" },
        reviewer:
          row.reviewerId === null
            ? null
            : { id: row.reviewerId, name: row.reviewerName ?? "", slug: row.reviewerSlug ?? "" },
        submittedAt: row.submittedAt.toISOString(),
        ageHours: ageHours(row.submittedAt, now),
        diffStats: inboxDiffStats(row.approved, row.submitted ?? { title: row.title, bodyMd: "" }),
        hasApprovedBefore: row.approved !== null,
      })),
      nextCursor:
        rows.length > query.limit && last !== undefined
          ? encodeCursor({ at: last.cursorAt, key: last.id })
          : null,
    };
  }
}
