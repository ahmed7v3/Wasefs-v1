import { Inject, Injectable } from "@nestjs/common";
import {
  ensureReferralCode,
  findActiveCode,
  referralCodes,
  renameReferralCode,
  type ReferralCode,
} from "@wasfa/db";

import { DB, type DbHandle } from "../common/database.js";
import { scopedRepo, type ScopedRepo } from "../common/scoped-repo.js";

/** Every query of referral codes. The rules (one personal code, one vanity edit) live in `@wasfa/db`. */
@Injectable()
export class ReferralsRepo {
  private readonly codes: ScopedRepo<typeof referralCodes>;

  constructor(@Inject(DB) private readonly handle: DbHandle) {
    this.codes = scopedRepo(handle.db, {
      table: referralCodes,
      scope: referralCodes.ownerUserId,
      id: referralCodes.id,
    });
  }

  /** The user's personal code, created on first call. */
  ensureCode(userId: string): Promise<ReferralCode> {
    return ensureReferralCode(this.handle.db, userId);
  }

  async personalCode(userId: string): Promise<ReferralCode | undefined> {
    const rows = await this.codes.list(userId);
    return rows.find((row) => row.kind === "user");
  }

  rename(userId: string, code: string): Promise<ReferralCode> {
    return renameReferralCode(this.handle.db, userId, code);
  }

  /** An active code of an active program; undefined for anything else. */
  findActive(code: string): Promise<ReferralCode | undefined> {
    return findActiveCode(this.handle.db, code);
  }
}
