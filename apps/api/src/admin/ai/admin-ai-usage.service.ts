import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";

import { decodeCursor, toPage, type Cursor, type Page } from "../common/keyset.js";

import {
  AdminAiUsageRepo,
  type UsageFilters,
  type UsageRowData,
  type UsageTotalsData,
} from "./admin-ai-usage.repo.js";
import { csvRow } from "./usage-csv.js";

import type { AiUsageFilter, AiUsageRow } from "@wasfa/shared/schemas/admin-ai";

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
/** Rows per database round trip while exporting, and the most one export may hold. */
const EXPORT_BATCH = 1_000;
export const EXPORT_MAX_ROWS = 100_000;

const CSV_HEADER = [
  "created_at",
  "task",
  "model",
  "provider",
  "owner_user_id",
  "owner_org_id",
  "user_id",
  "input_tokens",
  "cached_input_tokens",
  "output_tokens",
  "thinking_tokens",
  "search_count",
  "cost_usd_micros",
  "credits_charged",
  "latency_ms",
  "outcome",
  "cache_hit",
  "request_id",
] as const;

/** A date means the whole UTC day, so `to=2026-10-01` includes everything on the first. */
export function toFilters(filter: AiUsageFilter): UsageFilters {
  const from = filter.from === undefined ? undefined : new Date(filter.from);
  let toExclusive: Date | undefined;
  if (filter.to !== undefined) {
    const to = new Date(filter.to);
    toExclusive = new Date(to.getTime() + (DATE_ONLY.test(filter.to) ? DAY_MS : 1));
  }
  if (from && toExclusive && from >= toExclusive) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, { details: { fields: ["from", "to"] } });
  }
  return {
    userId: filter.userId,
    orgId: filter.orgId,
    task: filter.task,
    model: filter.model,
    outcome: filter.outcome,
    from,
    toExclusive,
  };
}

function toView(row: UsageRowData): AiUsageRow {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    task: row.task,
    modelKey: row.modelKey,
    providerKey: row.providerKey,
    ownerUserId: row.ownerUserId,
    ownerOrgId: row.ownerOrgId,
    userId: row.userId,
    inputTokens: row.inputTokens,
    cachedInputTokens: row.cachedInputTokens,
    outputTokens: row.outputTokens,
    thinkingTokens: row.thinkingTokens,
    searchCount: row.searchCount,
    costUsdMicros: row.costUsdMicros,
    creditsCharged: row.creditsCharged,
    latencyMs: row.latencyMs,
    outcome: row.outcome,
    cacheHit: row.cacheHit,
    requestId: row.requestId,
  };
}

/** The usage explorer: filtered keyset list, totals over the same filters, and a streamed CSV. */
@Injectable()
export class AdminAiUsageService {
  constructor(private readonly repo: AdminAiUsageRepo) {}

  async list(
    filter: AiUsageFilter,
    cursor: string | undefined,
    limit: number,
  ): Promise<Page<AiUsageRow>> {
    const filters = toFilters(filter);
    const rows = await this.repo.list(filters, decodeCursor(cursor, "uuid"), limit);
    const page = toPage(rows, limit, (row) => ({ at: row.cursorAt, key: row.id }));
    return { items: page.items.map(toView), nextCursor: page.nextCursor };
  }

  totals(filter: AiUsageFilter): Promise<UsageTotalsData> {
    return this.repo.totals(toFilters(filter));
  }

  /** Validates the filters up front (so a bad range is a 400, not a broken download) and returns the stream. */
  csv(filter: AiUsageFilter): AsyncGenerator<string> {
    return this.rows(toFilters(filter));
  }

  private async *rows(filters: UsageFilters): AsyncGenerator<string> {
    yield csvRow(CSV_HEADER);
    let cursor: Cursor | undefined;
    let written = 0;
    while (written < EXPORT_MAX_ROWS) {
      const batch = Math.min(EXPORT_BATCH, EXPORT_MAX_ROWS - written);
      const rows = await this.repo.list(filters, cursor, batch);
      const shown = rows.slice(0, batch);
      for (const row of shown) {
        yield csvRow([
          row.createdAt.toISOString(),
          row.task,
          row.modelKey,
          row.providerKey,
          row.ownerUserId,
          row.ownerOrgId,
          row.userId,
          row.inputTokens,
          row.cachedInputTokens,
          row.outputTokens,
          row.thinkingTokens,
          row.searchCount,
          row.costUsdMicros,
          row.creditsCharged,
          row.latencyMs,
          row.outcome,
          row.cacheHit,
          row.requestId,
        ]);
      }
      written += shown.length;
      const last = shown.at(-1);
      if (rows.length <= batch || last === undefined) return;
      cursor = { at: last.cursorAt, key: last.id };
    }
  }
}
