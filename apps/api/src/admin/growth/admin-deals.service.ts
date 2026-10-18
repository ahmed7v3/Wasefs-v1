import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import {
  dealDetailSchema,
  dealListResponseSchema,
  dealViewSchema,
  type CreateDealInput,
  type DealListQuery,
  type DealTargetInput,
  type SimulateDealInput,
  type UpdateDealInput,
} from "@wasfa/shared/schemas/deals";

import { QuoteService } from "../../billing/quote.service.js";
import { decodeCursor, toPage } from "../common/keyset.js";

import { AdminDealsRepo } from "./admin-deals.repo.js";

import type { AuditScope } from "../../audit/audited.decorator.js";
import type { Market } from "../../catalog/market.js";
import type { AuthenticatedUser } from "../../common/current-user.js";
import type { Deal, DealTarget } from "@wasfa/db";

const conflict = () => new AppError(ErrorCode.CONFLICT);
const invalid = (field: string) =>
  new AppError(ErrorCode.VALIDATION_FAILED, { details: { fields: [field] } });

const targetView = (row: DealTarget) => ({
  id: row.id,
  kind: row.targetKind,
  userId: row.targetUserId,
  orgId: row.targetOrgId,
  referralCodeId: row.referralCodeId,
  emailDomain: row.emailDomain,
  memberOnly: row.memberOnly,
  createdAt: row.createdAt.toISOString(),
});

function dealView(row: Deal, targets: readonly DealTarget[]) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    terms: row.terms,
    notes: row.notes,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    targets: targets.map(targetView),
  };
}

const auditShape = (row: Deal) => ({
  name: row.name,
  status: row.status,
  startsAt: row.startsAt?.toISOString() ?? null,
  endsAt: row.endsAt?.toISOString() ?? null,
  terms: row.terms,
  notes: row.notes,
});

const targetAudit = (row: DealTarget) => ({
  targetId: row.id,
  kind: row.targetKind,
  userId: row.targetUserId,
  orgId: row.targetOrgId,
  referralCodeId: row.referralCodeId,
  emailDomain: row.emailDomain,
  memberOnly: row.memberOnly,
});

export type DealAction = "activate" | "pause" | "end";

@Injectable()
export class AdminDealsService {
  constructor(
    private readonly repo: AdminDealsRepo,
    private readonly quotes: QuoteService,
  ) {}

  async list(query: DealListQuery) {
    const rows = await this.repo.page(query, decodeCursor(query.cursor, "uuid"));
    const page = toPage(rows, query.limit, (row) => ({ at: row.cursorAt, key: row.deal.id }));
    const targets = await this.repo.targetsOf(page.items.map((row) => row.deal.id));
    return dealListResponseSchema.parse({
      items: page.items.map(({ deal }) =>
        dealView(
          deal,
          targets.filter((target) => target.dealId === deal.id),
        ),
      ),
      nextCursor: page.nextCursor,
    });
  }

  async get(id: string) {
    const row = await this.repo.find(id);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND);
    const [targets, usage] = await Promise.all([this.repo.targetsOf([id]), this.repo.usage(id)]);
    return dealDetailSchema.parse({ ...dealView(row, targets), usage });
  }

  async create(input: CreateDealInput, actor: AuthenticatedUser, audit: AuditScope) {
    // Going live is its own audited, fresh-auth step (`activate`): a new deal is always a draft.
    if (input.status !== "draft") throw invalid("status");
    if (!(await this.repo.targetsExist(input.targets))) throw invalid("targets");
    const row = await this.repo.create(input, actor.id);
    audit.targetId = row.id;
    audit.after = { ...auditShape(row), targets: input.targets };
    return dealViewSchema.parse(dealView(row, await this.repo.targetsOf([row.id])));
  }

  async update(id: string, input: UpdateDealInput, audit: AuditScope) {
    const existing = await this.repo.find(id);
    if (!existing) throw new AppError(ErrorCode.NOT_FOUND);
    if (existing.status === "ended") throw conflict();
    const startsAt = input.startsAt === undefined ? existing.startsAt : input.startsAt;
    const endsAt = input.endsAt === undefined ? existing.endsAt : input.endsAt;
    if (startsAt !== null && endsAt !== null && new Date(endsAt) <= new Date(startsAt)) {
      throw invalid("endsAt");
    }
    const result = await this.repo.update(id, input);
    if (result.kind === "not_found") throw new AppError(ErrorCode.NOT_FOUND);
    if (result.kind === "ended") throw conflict();
    audit.targetId = id;
    audit.before = auditShape(result.before);
    audit.after = auditShape(result.after);
    return dealViewSchema.parse(dealView(result.after, await this.repo.targetsOf([id])));
  }

  /** draft/paused to active, active to paused, anything to ended (final). */
  async transition(id: string, action: DealAction, audit: AuditScope) {
    const now = new Date();
    const current = await this.repo.find(id);
    if (!current) throw new AppError(ErrorCode.NOT_FOUND);
    if (action === "activate" && current.endsAt !== null && current.endsAt <= now) throw conflict();
    const result =
      action === "activate"
        ? await this.repo.transition(id, ["draft", "paused"], "active", now)
        : action === "pause"
          ? await this.repo.transition(id, ["active"], "paused", now)
          : await this.repo.transition(id, ["draft", "active", "paused"], "ended", now);
    if (result.kind === "not_found") throw new AppError(ErrorCode.NOT_FOUND);
    if (result.kind === "conflict") throw conflict();
    audit.targetId = id;
    audit.before = { status: result.before.status };
    audit.after = { status: result.after.status };
    return dealViewSchema.parse(dealView(result.after, await this.repo.targetsOf([id])));
  }

  async addTarget(id: string, input: DealTargetInput, audit: AuditScope) {
    const deal = await this.repo.find(id);
    if (!deal) throw new AppError(ErrorCode.NOT_FOUND);
    if (deal.status === "ended") throw conflict();
    if (!(await this.repo.targetsExist([input]))) throw invalid("target");
    const created = await this.repo.addTarget(id, input, new Date());
    if (!created) throw conflict();
    audit.targetId = id;
    audit.after = targetAudit(created);
    return targetView(created);
  }

  async removeTarget(id: string, targetId: string, audit: AuditScope) {
    const deal = await this.repo.find(id);
    if (!deal) throw new AppError(ErrorCode.NOT_FOUND);
    if (deal.status === "ended") throw conflict();
    const removed = await this.repo.removeTarget(id, targetId);
    if (!removed) throw new AppError(ErrorCode.NOT_FOUND);
    audit.targetId = id;
    audit.before = targetAudit(removed);
  }

  simulate(input: SimulateDealInput, market: Market) {
    return this.quotes.simulateDeal(input, market);
  }
}
