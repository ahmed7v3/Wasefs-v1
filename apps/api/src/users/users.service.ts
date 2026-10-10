import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { isPlaceholderEmail, USAGE_INTENTS, type UsageIntent } from "@wasfa/shared/identity";
import {
  ACCOUNT_DELETION_GRACE_DAYS,
  type MeResponse,
  type SessionItem,
  type UpdateMeInput,
} from "@wasfa/shared/schemas/user";

import { OnboardingService } from "../onboarding/onboarding.service.js";
import { RbacService } from "../rbac/rbac.service.js";

import { UsersRepo } from "./users.repo.js";

import type { AuthenticatedUser } from "../common/current-user.js";

const DAY_MS = 24 * 60 * 60 * 1000;

const isUsageIntent = (value: string): value is UsageIntent =>
  (USAGE_INTENTS as readonly string[]).includes(value);

@Injectable()
export class UsersService {
  constructor(
    private readonly repo: UsersRepo,
    private readonly onboarding: OnboardingService,
    private readonly rbac: RbacService,
  ) {}

  async me(user: AuthenticatedUser): Promise<MeResponse> {
    const [account, profile, memberships, onboarding] = await Promise.all([
      this.repo.findAccount(user.id),
      this.repo.findProfile(user.id),
      this.repo.memberships(user.id),
      this.onboarding.summary(user),
    ]);
    if (!account) throw new AppError(ErrorCode.AUTH_REQUIRED);

    return {
      id: account.id,
      name: account.name,
      // Phone-only accounts carry a placeholder address; it is never shown.
      email: isPlaceholderEmail(account.email) ? null : account.email,
      emailVerified: account.emailVerified,
      phone: account.phone,
      phoneVerified: account.phoneVerified,
      image: account.image,
      accountType: account.accountType,
      locale: account.locale,
      twoFactorEnabled: account.twoFactorEnabled,
      roles: user.roles,
      permissions: user.permissions,
      profile: {
        displayName: profile?.displayName ?? null,
        profession: profile?.profession ?? null,
        usageIntent: (profile?.usageIntent ?? []).filter(isUsageIntent),
        country: profile?.country ?? null,
        city: profile?.city ?? null,
      },
      onboarding,
      organizations: memberships,
      canUseTools: (account.emailVerified || account.phoneVerified) && onboarding.done,
      createdAt: account.createdAt.toISOString(),
    };
  }

  async update(user: AuthenticatedUser, input: UpdateMeInput): Promise<MeResponse> {
    await this.repo.updateAccount(user.id, { name: input.name, locale: input.locale });
    return this.me(user);
  }

  async sessions(user: AuthenticatedUser): Promise<{ items: SessionItem[] }> {
    const rows = await this.repo.liveSessions(user.id);
    const items = [...rows]
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map((row): SessionItem => ({
        id: row.id,
        current: row.id === user.session.id,
        createdAt: row.createdAt.toISOString(),
        lastSeenAt: row.updatedAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        ipAddress: row.ipAddress,
        userAgent: row.userAgent,
      }));
    return { items };
  }

  async revokeSession(user: AuthenticatedUser, sessionId: string): Promise<void> {
    // Ending the session you are using is sign-out (`/auth/sign-out`), which also clears the cookie.
    if (sessionId === user.session.id) {
      throw new AppError(ErrorCode.CONFLICT, { details: { reason: "current_session" } });
    }
    if (!(await this.repo.revokeSession(user.id, sessionId))) {
      throw new AppError(ErrorCode.NOT_FOUND);
    }
  }

  async revokeOtherSessions(user: AuthenticatedUser): Promise<{ revoked: number }> {
    return { revoked: await this.repo.revokeOtherSessions(user.id, user.session.id) };
  }

  /** Starts the 14-day deletion window and ends every session, this one included. */
  async deleteAccount(user: AuthenticatedUser): Promise<{ anonymizeAfter: string }> {
    const result = await this.repo.deleteAccount(user.id);
    if ("blocked" in result) {
      // Other members would be left in an organization nobody can administer.
      throw new AppError(ErrorCode.CONFLICT, { details: { reason: result.blocked } });
    }
    await this.rbac.bustUser(user.id);
    return {
      anonymizeAfter: new Date(
        result.deletedAt.getTime() + ACCOUNT_DELETION_GRACE_DAYS * DAY_MS,
      ).toISOString(),
    };
  }
}
