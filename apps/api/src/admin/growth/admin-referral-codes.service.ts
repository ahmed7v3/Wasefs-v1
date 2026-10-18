import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { initialsOf } from "@wasfa/shared/rewards";
import {
  codeListSchema,
  codeViewSchema,
  type CodeListQuery,
  type CreateCodeInput,
} from "@wasfa/shared/schemas/admin-growth";

import { decodeCursor, toPage } from "../common/keyset.js";

import { AdminDealsService } from "./admin-deals.service.js";
import { AdminReferralCodesRepo } from "./admin-referral-codes.repo.js";

import type { AuditScope } from "../../audit/audited.decorator.js";
import type { AuthenticatedUser } from "../../common/current-user.js";
import type { ReferralCode } from "@wasfa/db";

const invalid = (field: string) =>
  new AppError(ErrorCode.VALIDATION_FAILED, { details: { fields: [field] } });

interface CodeRow {
  code: ReferralCode;
  programKey: string;
  ownerName: string | null;
  orgName: string | null;
  referrals: number;
}

function view(row: CodeRow, dealIds: string[]) {
  return codeViewSchema.parse({
    id: row.code.id,
    code: row.code.code,
    kind: row.code.kind,
    active: row.code.active,
    programId: row.code.programId,
    programKey: row.programKey,
    ownerUserId: row.code.ownerUserId,
    ownerInitials: row.ownerName === null ? null : initialsOf(row.ownerName),
    ownerOrgId: row.code.ownerOrgId,
    ownerOrgName: row.orgName,
    referrals: row.referrals,
    dealIds,
    createdAt: row.code.createdAt.toISOString(),
  });
}

@Injectable()
export class AdminReferralCodesService {
  constructor(
    private readonly repo: AdminReferralCodesRepo,
    private readonly deals: AdminDealsService,
  ) {}

  async list(query: CodeListQuery) {
    const rows = await this.repo.page(query, decodeCursor(query.cursor, "uuid"));
    const page = toPage(rows, query.limit, (row) => ({ at: row.cursorAt, key: row.code.id }));
    const deals = await this.repo.dealIdsOf(page.items.map((row) => row.code.id));
    return codeListSchema.parse({
      items: page.items.map((row) => view(row, deals.get(row.code.id) ?? [])),
      nextCursor: page.nextCursor,
    });
  }

  private async viewOf(id: string) {
    const row = await this.repo.find(id);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND);
    return view(row, (await this.repo.dealIdsOf([id])).get(id) ?? []);
  }

  /**
   * A partner code needs its owner, an organization code its organization; a campaign code belongs to
   * nobody. A deal is attached through the deals service (a `referral_code` target), after checking
   * that it can take targets, so a refused deal never leaves a code behind.
   */
  async create(input: CreateCodeInput, actor: AuthenticatedUser, audit: AuditScope) {
    if (input.dealId) {
      const deal = await this.deals.get(input.dealId);
      if (deal.status === "ended") throw invalid("dealId");
    }
    const programId = input.programId ?? (await this.repo.defaultProgramId(input.kind));
    if (programId === null) throw invalid("programId");
    const created = await this.repo.create({
      kind: input.kind,
      code: input.code,
      programId,
      ownerUserId: input.ownerUserId,
      orgId: input.orgId,
      createdBy: actor.id,
    });
    if (created.kind === "code_taken") throw new AppError(ErrorCode.CONFLICT);
    if (created.kind === "program_missing") throw invalid("programId");
    if (created.kind === "owner_missing")
      throw invalid(input.ownerUserId ? "ownerUserId" : "orgId");
    if (input.dealId) {
      // The deals service owns the target rules (duplicates, welcome credits); this audit row names the deal.
      await this.deals.addTarget(
        input.dealId,
        { kind: "referral_code", referralCodeId: created.row.id, memberOnly: false },
        {},
      );
    }
    audit.targetId = created.row.id;
    audit.after = {
      code: created.row.code,
      kind: created.row.kind,
      programId,
      ownerUserId: created.row.ownerUserId,
      orgId: created.row.ownerOrgId,
      dealId: input.dealId ?? null,
    };
    return this.viewOf(created.row.id);
  }

  async setActive(id: string, active: boolean, reason: string, audit: AuditScope) {
    const result = await this.repo.setActive(id, active);
    if (!result) throw new AppError(ErrorCode.NOT_FOUND);
    audit.targetId = id;
    audit.before = { active: result.before.active, code: result.before.code };
    audit.after = { active: result.after.active, reason };
    return this.viewOf(id);
  }
}
