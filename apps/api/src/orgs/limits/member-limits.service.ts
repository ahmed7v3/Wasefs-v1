import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";

import { OrgsRepo } from "../orgs.repo.js";
import { OrgsService } from "../orgs.service.js";

import { MemberLimitsRepo } from "./member-limits.repo.js";

import type { AuditScope } from "../../audit/audited.decorator.js";
import type { AuthenticatedUser } from "../../common/current-user.js";

@Injectable()
export class MemberLimitsService {
  constructor(
    private readonly orgs: OrgsService,
    private readonly orgsRepo: OrgsRepo,
    private readonly repo: MemberLimitsRepo,
  ) {}

  /** Sets (or, with `null`, removes) the monthly credit cap of one active member. org_admin only. */
  async set(
    user: AuthenticatedUser,
    orgId: string,
    targetId: string,
    monthlyCreditCap: number | null,
    audit: AuditScope,
  ): Promise<{ userId: string; monthlyCreditCap: number | null }> {
    await this.orgs.authorize(user.id, orgId, "org_admin");
    // A pending join request or a stranger has no member row to hang a limit on.
    if (!(await this.orgsRepo.findMember(orgId, targetId))) throw new AppError(ErrorCode.NOT_FOUND);
    if (monthlyCreditCap === null) {
      await this.repo.clear(orgId, targetId);
    } else {
      await this.repo.set(orgId, targetId, monthlyCreditCap, user.id);
    }
    audit.after = { monthlyCreditCap };
    return { userId: targetId, monthlyCreditCap };
  }
}
