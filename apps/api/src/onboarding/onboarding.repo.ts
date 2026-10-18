import { Inject, Injectable } from "@nestjs/common";
import {
  onboardingProgress,
  organizationMembers,
  organizations,
  userProfiles,
  users,
  type Database,
  type OnboardingProgress,
  type UserProfile,
} from "@wasfa/db";
import { and, eq, exists, sql } from "drizzle-orm";

import { DB, type DbHandle } from "../common/database.js";

import type { AccountType, OnboardingStep, OrgType } from "@wasfa/shared/identity";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface OnboardingAccount {
  name: string;
  phone: string | null;
  accountType: AccountType;
  emailVerified: boolean;
  phoneVerified: boolean;
}

/** The fields of an organization that the wizard edits. */
export interface OrgFields {
  name: string;
  type: OrgType;
  country: string;
  city: string | null;
}

export interface OnboardingOrg extends OrgFields {
  id: string;
}

export interface ProfileFields {
  profession: NonNullable<UserProfile["profession"]>;
  usageIntent: string[];
  country: string;
  city: string | null;
}

export interface ProgressUpdate {
  currentStep: OnboardingStep;
  completedSteps: OnboardingStep[];
  data: Record<string, unknown>;
}

const accountColumns = {
  name: users.name,
  phone: users.phone,
  accountType: users.accountType,
  emailVerified: users.emailVerified,
  phoneVerified: users.phoneVerified,
};

const orgColumns = {
  id: organizations.id,
  name: organizations.name,
  type: organizations.type,
  country: organizations.country,
  city: organizations.city,
};

/**
 * Everything one `PUT /onboarding/:step` touches, bound to one transaction and one user. The user
 * id is fixed at construction, so none of these methods can reach another user's rows. The progress
 * row is locked for the whole transaction, which serializes two tabs submitting at once.
 */
export class OnboardingTx {
  constructor(
    private readonly tx: Tx,
    private readonly userId: string,
    readonly progress: OnboardingProgress,
  ) {}

  async account(): Promise<OnboardingAccount> {
    const [row] = await this.tx.select(accountColumns).from(users).where(eq(users.id, this.userId));
    if (!row) throw new Error("onboarding: user row missing");
    return row;
  }

  async setAccountType(accountType: AccountType): Promise<void> {
    await this.tx.update(users).set({ accountType }).where(eq(users.id, this.userId));
  }

  async setName(name: string): Promise<void> {
    await this.tx.update(users).set({ name }).where(eq(users.id, this.userId));
  }

  /** The organization, if the caller is still its `org_admin`. */
  async administeredOrg(orgId: string): Promise<OnboardingOrg | null> {
    const [row] = await this.tx
      .select(orgColumns)
      .from(organizations)
      .innerJoin(organizationMembers, eq(organizationMembers.orgId, organizations.id))
      .where(
        and(
          eq(organizations.id, orgId),
          eq(organizationMembers.userId, this.userId),
          eq(organizationMembers.role, "org_admin"),
          eq(organizationMembers.status, "active"),
        ),
      );
    return row ?? null;
  }

  /** Updates the organization only while the caller is its `org_admin` (checked again in the statement). */
  async updateOrganization(orgId: string, fields: OrgFields): Promise<void> {
    await this.tx
      .update(organizations)
      .set(fields)
      .where(
        and(
          eq(organizations.id, orgId),
          exists(
            this.tx
              .select({ one: sql`1` })
              .from(organizationMembers)
              .where(
                and(
                  eq(organizationMembers.orgId, orgId),
                  eq(organizationMembers.userId, this.userId),
                  eq(organizationMembers.role, "org_admin"),
                  eq(organizationMembers.status, "active"),
                ),
              ),
          ),
        ),
      );
  }

  /** Creates the organization with the caller as its founder and first `org_admin`. */
  async createOrganization(fields: OrgFields): Promise<OnboardingOrg> {
    const [created] = await this.tx
      .insert(organizations)
      .values({ ...fields, createdBy: this.userId })
      .returning(orgColumns);
    if (!created) throw new Error("onboarding: organization insert returned no row");
    await this.tx
      .insert(organizationMembers)
      .values({ orgId: created.id, userId: this.userId, role: "org_admin" });
    return created;
  }

  async saveProfile(fields: ProfileFields): Promise<void> {
    await this.tx
      .insert(userProfiles)
      .values({ userId: this.userId, ...fields })
      .onConflictDoUpdate({
        target: userProfiles.userId,
        // `$onUpdate` does not fire for the conflict branch.
        set: { ...fields, updatedAt: new Date() },
      });
  }

  /** `completed_at` is set exactly when the wizard reaches `done` (a CHECK enforces the pairing). */
  async saveProgress(update: ProgressUpdate): Promise<void> {
    await this.tx
      .update(onboardingProgress)
      .set({
        ...update,
        completedAt: update.currentStep === "done" ? sql`now()` : null,
      })
      .where(eq(onboardingProgress.userId, this.userId));
  }
}

/** The only place the onboarding wizard touches the database. */
@Injectable()
export class OnboardingRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async findProgress(userId: string): Promise<OnboardingProgress | null> {
    const [row] = await this.handle.db
      .select()
      .from(onboardingProgress)
      .where(eq(onboardingProgress.userId, userId));
    return row ?? null;
  }

  /** The row is created on first use, not at sign-up. */
  async getOrCreateProgress(userId: string): Promise<OnboardingProgress> {
    await this.handle.db.insert(onboardingProgress).values({ userId }).onConflictDoNothing();
    const row = await this.findProgress(userId);
    if (!row) throw new Error("onboarding: progress row missing after insert");
    return row;
  }

  async findAccount(userId: string): Promise<OnboardingAccount | null> {
    const [row] = await this.handle.db
      .select(accountColumns)
      .from(users)
      .where(eq(users.id, userId));
    return row ?? null;
  }

  async findProfile(userId: string): Promise<UserProfile | null> {
    const [row] = await this.handle.db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId));
    return row ?? null;
  }

  /** The organization, only while the caller is still a member of it. */
  async findMemberOrg(userId: string, orgId: string): Promise<OnboardingOrg | null> {
    const [row] = await this.handle.db
      .select(orgColumns)
      .from(organizations)
      .innerJoin(organizationMembers, eq(organizationMembers.orgId, organizations.id))
      .where(and(eq(organizations.id, orgId), eq(organizationMembers.userId, userId)));
    return row ?? null;
  }

  /**
   * Runs `work` in one transaction that holds the user's progress row locked (`FOR UPDATE`),
   * creating the row first when this is the user's first visit.
   */
  withLockedProgress<T>(userId: string, work: (tx: OnboardingTx) => Promise<T>): Promise<T> {
    return this.handle.db.transaction(async (tx) => {
      await tx.insert(onboardingProgress).values({ userId }).onConflictDoNothing();
      const [progress] = await tx
        .select()
        .from(onboardingProgress)
        .where(eq(onboardingProgress.userId, userId))
        .for("update");
      if (!progress) throw new Error("onboarding: progress row missing after insert");
      return work(new OnboardingTx(tx, userId, progress));
    });
  }
}
