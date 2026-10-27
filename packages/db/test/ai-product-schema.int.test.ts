import { AI_MODES, AI_TASKS } from "@wasfa/shared/ai";
import { routeModelsSchema } from "@wasfa/shared/schemas/admin-ai";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb } from "../src/client.js";
import { API_DB_ROLE, setApiRolePassword } from "../src/migrations.js";
import {
  aiModels,
  aiProviders,
  aiTaskRoutes,
  aiUsage,
  chatMessages,
  chats,
  creditLedger,
  creditReservations,
  creditWallets,
  files,
  organizations,
  planAssignments,
  planEntitlements,
  plans,
  rxAnalyses,
  users,
} from "../src/schema/index.js";
import { seedDefaults } from "../src/seed-data.js";

import { startTestDb, violatedConstraint, type TestDb } from "./db-fixture.js";

/** One default route per task and mode. */
const ROUTE_COUNT = AI_TASKS.length * AI_MODES.length;

/*
 * Constraint names are part of the contract (the API maps a violated name to an error), so they are
 * listed here by hand rather than derived from the schema: renaming one must be a visible decision.
 */
const CHECKS = [
  "ai_models_capabilities_check",
  "ai_models_price_input_check",
  "ai_models_price_cached_input_check",
  "ai_models_price_output_check",
  "ai_models_price_search_check",
  "ai_models_credit_multiplier_check",
  "ai_models_price_source_check",
  "ai_providers_kind_check",
  "ai_providers_data_policy_check",
  "ai_spend_daily_counts_check",
  "ai_task_routes_task_check",
  "ai_task_routes_mode_check",
  "ai_task_routes_models_check",
  "ai_task_routes_version_check",
  "ai_usage_owner_check",
  "ai_usage_task_check",
  "ai_usage_outcome_check",
  "ai_usage_tokens_check",
  "ai_usage_search_count_check",
  "ai_usage_cost_check",
  "ai_usage_credits_check",
  "ai_usage_latency_check",
  "chat_messages_role_check",
  "chat_messages_status_check",
  "chat_messages_parts_check",
  "chat_messages_credits_check",
  "chats_owner_check",
  "credit_ledger_kind_check",
  "credit_ledger_amount_check",
  "credit_ledger_balance_after_check",
  "credit_reservations_amount_check",
  "credit_reservations_settled_amount_check",
  "credit_reservations_status_check",
  "credit_wallets_owner_check",
  "credit_wallets_balance_check",
  "drug_aliases_lang_check",
  "drug_import_batches_source_check",
  "drug_import_batches_status_check",
  "drug_import_batches_counts_check",
  "drug_ingredients_strength_check",
  "drugs_status_check",
  "drugs_country_check",
  "drugs_strength_check",
  "ai_eval_items_kind_check",
  "ai_eval_results_cost_check",
  "ai_eval_results_latency_check",
  "ai_eval_runs_status_check",
  "ai_eval_runs_cost_check",
  "files_owner_check",
  "files_purpose_check",
  "files_mime_check",
  "files_bytes_check",
  "files_status_check",
  "files_sha256_check",
  "files_dhash_check",
  "plan_assignments_owner_check",
  "plan_assignments_period_check",
  "plan_entitlements_task_check",
  "plan_entitlements_modes_check",
  "plan_entitlements_daily_cap_check",
  "plan_entitlements_monthly_cap_check",
  "plan_entitlements_max_pages_check",
  "plans_key_check",
  "plans_audience_check",
  "plans_visibility_check",
  "plans_monthly_credits_check",
  "rx_analyses_owner_check",
  "rx_analyses_status_check",
  "rx_analyses_mode_check",
  "rx_analyses_credits_check",
  "rx_analyses_patient_initials_check",
  "rx_analyses_prescriber_initials_check",
  "rx_corrections_item_index_check",
  "rx_corrections_field_check",
  "rx_pages_page_no_check",
] as const;
const UNIQUES = [
  "ai_models_provider_model_key",
  "ai_providers_key_key",
  "credit_ledger_idempotency_key_key",
  "credit_wallets_owner_user_key",
  "credit_wallets_owner_org_key",
  "active_ingredients_normalized_key",
  "drug_aliases_drug_normalized_key",
  "ai_eval_sets_key_key",
  "files_r2_key_key",
  "plans_key_key",
] as const;
const PRIMARY_KEYS = [
  "ai_spend_daily_pkey",
  "drug_ingredients_pkey",
  "ai_eval_results_pkey",
  "plan_entitlements_pkey",
  "rx_pages_pkey",
] as const;
const INDEXES = [
  "ai_task_routes_key",
  "ai_usage_created_at_idx",
  "ai_usage_owner_user_created_idx",
  "ai_usage_owner_org_created_idx",
  "chat_messages_chat_created_idx",
  "chats_user_updated_idx",
  "credit_ledger_wallet_created_idx",
  "credit_reservations_open_expires_idx",
  "active_ingredients_normalized_trgm_idx",
  "drug_aliases_normalized_trgm_idx",
  "drugs_normalized_en_trgm_idx",
  "drugs_normalized_ar_trgm_idx",
  "files_sha256_idx",
  "files_owner_user_dhash_idx",
  "files_owner_org_dhash_idx",
  "files_expires_at_idx",
  "plan_assignments_owner_user_starts_idx",
  "plan_assignments_owner_org_starts_idx",
  "plans_one_default_idx",
  "rx_analyses_owner_user_created_idx",
  "rx_analyses_owner_org_created_idx",
  "rx_analyses_cache_idx",
] as const;
/** [constraint, ON DELETE rule] */
const FOREIGN_KEYS: readonly (readonly [string, string])[] = [
  ["ai_models_provider_id_ai_providers_id_fk", "restrict"],
  ["ai_spend_daily_provider_id_ai_providers_id_fk", "restrict"],
  ["ai_spend_daily_model_id_ai_models_id_fk", "restrict"],
  ["ai_task_routes_plan_id_plans_id_fk", "cascade"],
  ["ai_usage_model_id_ai_models_id_fk", "set null"],
  ["ai_usage_provider_id_ai_providers_id_fk", "set null"],
  ["ai_usage_owner_user_id_users_id_fk", "restrict"],
  ["ai_usage_owner_org_id_organizations_id_fk", "cascade"],
  ["ai_usage_user_id_users_id_fk", "set null"],
  ["chat_messages_chat_id_chats_id_fk", "cascade"],
  ["chat_messages_ai_usage_id_ai_usage_id_fk", "set null"],
  ["chat_summaries_chat_id_chats_id_fk", "cascade"],
  ["chat_summaries_through_message_id_chat_messages_id_fk", "cascade"],
  ["chats_owner_user_id_users_id_fk", "restrict"],
  ["chats_owner_org_id_organizations_id_fk", "cascade"],
  ["chats_user_id_users_id_fk", "set null"],
  ["credit_ledger_wallet_id_credit_wallets_id_fk", "restrict"],
  ["credit_ledger_reservation_id_credit_reservations_id_fk", "restrict"],
  ["credit_ledger_ai_usage_id_ai_usage_id_fk", "set null"],
  ["credit_ledger_actor_id_users_id_fk", "set null"],
  ["credit_reservations_wallet_id_credit_wallets_id_fk", "restrict"],
  ["credit_wallets_owner_user_id_users_id_fk", "restrict"],
  ["credit_wallets_owner_org_id_organizations_id_fk", "cascade"],
  ["active_ingredients_import_batch_id_drug_import_batches_id_fk", "set null"],
  ["drug_aliases_drug_id_drugs_id_fk", "cascade"],
  ["drug_aliases_import_batch_id_drug_import_batches_id_fk", "set null"],
  ["drug_import_batches_committed_by_users_id_fk", "set null"],
  ["drug_ingredients_drug_id_drugs_id_fk", "cascade"],
  ["drug_ingredients_ingredient_id_active_ingredients_id_fk", "cascade"],
  ["drugs_import_batch_id_drug_import_batches_id_fk", "set null"],
  ["ai_eval_items_set_id_ai_eval_sets_id_fk", "cascade"],
  ["ai_eval_results_run_id_ai_eval_runs_id_fk", "cascade"],
  ["ai_eval_results_item_id_ai_eval_items_id_fk", "cascade"],
  ["ai_eval_runs_set_id_ai_eval_sets_id_fk", "restrict"],
  ["ai_eval_runs_started_by_users_id_fk", "set null"],
  ["files_owner_user_id_users_id_fk", "restrict"],
  ["files_owner_org_id_organizations_id_fk", "cascade"],
  ["files_created_by_users_id_fk", "set null"],
  ["plan_assignments_owner_user_id_users_id_fk", "restrict"],
  ["plan_assignments_owner_org_id_organizations_id_fk", "cascade"],
  ["plan_assignments_plan_id_plans_id_fk", "restrict"],
  ["plan_assignments_assigned_by_users_id_fk", "set null"],
  ["plan_entitlements_plan_id_plans_id_fk", "cascade"],
  ["rx_analyses_owner_user_id_users_id_fk", "restrict"],
  ["rx_analyses_owner_org_id_organizations_id_fk", "cascade"],
  ["rx_analyses_created_by_users_id_fk", "set null"],
  ["rx_analyses_reservation_id_credit_reservations_id_fk", "set null"],
  ["rx_analyses_cache_of_rx_analyses_id_fk", "set null"],
  ["rx_corrections_analysis_id_rx_analyses_id_fk", "cascade"],
  ["rx_corrections_user_id_users_id_fk", "set null"],
  ["rx_pages_analysis_id_rx_analyses_id_fk", "cascade"],
  ["rx_pages_file_id_files_id_fk", "restrict"],
];

const DELETE_RULE: Record<string, string> = {
  a: "no action",
  r: "restrict",
  c: "cascade",
  n: "set null",
  d: "set default",
};

let fixture: TestDb;
let api: ReturnType<typeof createDb>;
const API_PASSWORD = "api-password-1";

function urlFor(base: string, user: string, password: string): string {
  const url = new URL(base);
  url.username = user;
  url.password = encodeURIComponent(password);
  return url.toString();
}

beforeAll(async () => {
  fixture = await startTestDb();
  await setApiRolePassword(fixture.handle.db, API_PASSWORD);
  api = createDb({ url: urlFor(fixture.url, API_DB_ROLE, API_PASSWORD), max: 1 });
}, 180_000);

afterAll(async () => {
  await api?.close();
  await fixture?.stop();
});

/** Runs a statement that must be rejected and returns the name of the constraint that rejected it. */
async function rejection(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
  } catch (error) {
    return violatedConstraint(error);
  }
  throw new Error("expected the database to reject the statement");
}

/** The SQLSTATE of a failed statement, or undefined when it succeeded. */
async function sqlState(run: Promise<unknown>): Promise<string | undefined> {
  try {
    await run;
    return undefined;
  } catch (error) {
    const candidate = (error as { cause?: unknown } | null)?.cause ?? error;
    return (candidate as { code?: string }).code;
  }
}

let counter = 0;
const unique = (prefix: string) => `${prefix}-${String(++counter)}`;

function db() {
  return fixture.handle.db;
}

async function newUser() {
  const [row] = await db()
    .insert(users)
    .values({ name: "Test", email: `${unique("user")}@example.com` })
    .returning();
  if (!row) throw new Error("insert returned no row");
  return row;
}

async function newOrg(createdBy: string) {
  const [row] = await db()
    .insert(organizations)
    .values({ name: "Org", type: "pharmacy", country: "EG", createdBy })
    .returning();
  if (!row) throw new Error("insert returned no row");
  return row;
}

async function newPlan() {
  const [row] = await db()
    .insert(plans)
    .values({ key: unique("plan").replace("-", "_"), nameAr: "خطة", nameEn: "Plan" })
    .returning();
  if (!row) throw new Error("insert returned no row");
  return row;
}

async function newWallet(ownerUserId: string, balance = 10) {
  const [row] = await db().insert(creditWallets).values({ ownerUserId, balance }).returning();
  if (!row) throw new Error("insert returned no row");
  return row;
}

describe("Phase 2 schema: names", () => {
  it("has every CHECK constraint", async () => {
    const rows = await db().execute<{ conname: string }>(
      sql`select conname from pg_constraint where contype = 'c' and connamespace = 'public'::regnamespace`,
    );
    const present = new Set(rows.map((row) => row.conname));
    expect(CHECKS.filter((name) => !present.has(name))).toEqual([]);
  });

  it("has every foreign key, with the ON DELETE rule the design calls for", async () => {
    const rows = await db().execute<{ conname: string; confdeltype: string }>(
      sql`select conname, confdeltype from pg_constraint where contype = 'f' and connamespace = 'public'::regnamespace`,
    );
    const present = new Map(rows.map((row) => [row.conname, DELETE_RULE[row.confdeltype]]));
    expect(FOREIGN_KEYS.map(([name]) => [name, present.get(name)])).toEqual(
      FOREIGN_KEYS.map(([name, rule]) => [name, rule]),
    );
  });

  it("has every unique constraint and composite primary key", async () => {
    const rows = await db().execute<{ conname: string }>(
      sql`select conname from pg_constraint where contype in ('u', 'p') and connamespace = 'public'::regnamespace`,
    );
    const present = new Set(rows.map((row) => row.conname));
    expect([...UNIQUES, ...PRIMARY_KEYS].filter((name) => !present.has(name))).toEqual([]);
  });

  it("has every index", async () => {
    const rows = await db().execute<{ indexname: string }>(
      sql`select indexname from pg_indexes where schemaname = 'public'`,
    );
    const present = new Set(rows.map((row) => row.indexname));
    expect(INDEXES.filter((name) => !present.has(name))).toEqual([]);
  });
});

describe("owner pattern", () => {
  /** A valid row for each owned table, with the owner columns supplied by the test. */
  const insertors: Record<
    string,
    (owner: { ownerUserId?: string; ownerOrgId?: string }) => Promise<unknown>
  > = {
    plan_assignments: async (owner) =>
      db()
        .insert(planAssignments)
        .values({ ...owner, planId: (await newPlan()).id }),
    credit_wallets: async (owner) => db().insert(creditWallets).values(owner),
    files: async (owner) =>
      db()
        .insert(files)
        .values({
          ...owner,
          purpose: "rx_page",
          r2Key: unique("key"),
          mime: "image/jpeg",
          bytes: 1000,
        }),
    rx_analyses: async (owner) =>
      db()
        .insert(rxAnalyses)
        .values({ ...owner, mode: "fast", skillVersion: "v1" }),
    chats: async (owner) => db().insert(chats).values(owner),
  };

  for (const [table, insert] of Object.entries(insertors)) {
    it(`${table}: accepts exactly one owner, rejects none or both`, async () => {
      const user = await newUser();
      const org = await newOrg(user.id);
      const other = await newUser();
      await insert({ ownerUserId: other.id });
      await insert({ ownerOrgId: org.id });
      expect(await rejection(() => insert({}))).toBe(`${table}_owner_check`);
      expect(await rejection(() => insert({ ownerUserId: user.id, ownerOrgId: org.id }))).toBe(
        `${table}_owner_check`,
      );
    });
  }

  it("ai_usage: allows no owner (system call) but not two", async () => {
    const user = await newUser();
    const org = await newOrg(user.id);
    const base = { task: "chat", modelKey: "m", outcome: "ok" } as const;
    await db().insert(aiUsage).values(base);
    await db()
      .insert(aiUsage)
      .values({ ...base, ownerUserId: user.id });
    expect(
      await rejection(() =>
        db()
          .insert(aiUsage)
          .values({ ...base, ownerUserId: user.id, ownerOrgId: org.id }),
      ),
    ).toBe("ai_usage_owner_check");
  });

  it("keeps one wallet per owner", async () => {
    const user = await newUser();
    const org = await newOrg(user.id);
    await db().insert(creditWallets).values({ ownerUserId: user.id });
    await db().insert(creditWallets).values({ ownerOrgId: org.id });
    expect(await rejection(() => db().insert(creditWallets).values({ ownerUserId: user.id }))).toBe(
      "credit_wallets_owner_user_key",
    );
    expect(await rejection(() => db().insert(creditWallets).values({ ownerOrgId: org.id }))).toBe(
      "credit_wallets_owner_org_key",
    );
  });

  it("deleting an organization removes what it owns; a user with data cannot be deleted", async () => {
    const user = await newUser();
    const org = await newOrg(user.id);
    const [chat] = await db().insert(chats).values({ ownerOrgId: org.id }).returning();
    if (!chat) throw new Error("insert returned no row");
    await db().insert(chatMessages).values({ chatId: chat.id, role: "user", content: "hi" });
    await db().insert(creditWallets).values({ ownerOrgId: org.id });

    await db().execute(sql`delete from organizations where id = ${org.id}`);
    const left = await db().execute<{ count: number }>(
      sql`select (select count(*) from chats where id = ${chat.id})::int
        + (select count(*) from chat_messages where chat_id = ${chat.id})::int
        + (select count(*) from credit_wallets where owner_org_id = ${org.id})::int as count`,
    );
    expect(left[0]?.count).toBe(0);

    const owner = await newUser();
    await newWallet(owner.id);
    expect(await rejection(() => db().execute(sql`delete from users where id = ${owner.id}`))).toBe(
      "credit_wallets_owner_user_id_users_id_fk",
    );
  });
});

describe("plans", () => {
  it("allows one default plan only", async () => {
    await db()
      .insert(plans)
      .values({ key: "default_a", nameAr: "أ", nameEn: "A", isDefault: true });
    expect(
      await rejection(() =>
        db().insert(plans).values({ key: "default_b", nameAr: "ب", nameEn: "B", isDefault: true }),
      ),
    ).toBe("plans_one_default_idx");
    await db().insert(plans).values({ key: "default_c", nameAr: "ج", nameEn: "C" });
    // The seed test below needs the default flag free.
    await db().execute(sql`delete from plans where key like 'default_%'`);
  });

  it("rejects a malformed key, a negative grant and an unknown audience or visibility", async () => {
    const base = { nameAr: "خ", nameEn: "P" };
    expect(
      await rejection(() =>
        db()
          .insert(plans)
          .values({ ...base, key: "Bad Key" }),
      ),
    ).toBe("plans_key_check");
    expect(
      await rejection(() =>
        db()
          .insert(plans)
          .values({ ...base, key: "neg", monthlyCredits: -1 }),
      ),
    ).toBe("plans_monthly_credits_check");
    expect(
      await rejection(() =>
        db()
          .insert(plans)
          .values({ ...base, key: "aud", audience: "x" as never }),
      ),
    ).toBe("plans_audience_check");
    expect(
      await rejection(() =>
        db()
          .insert(plans)
          .values({ ...base, key: "vis", visibility: "x" as never }),
      ),
    ).toBe("plans_visibility_check");
  });

  it("checks entitlements: task, modes, caps and page limit", async () => {
    const plan = await newPlan();
    const base = { planId: plan.id, task: "rx_extract" as const, modes: ["fast" as const] };
    expect(
      await rejection(() =>
        db()
          .insert(planEntitlements)
          .values({ ...base, task: "x" as never }),
      ),
    ).toBe("plan_entitlements_task_check");
    expect(
      await rejection(() =>
        db()
          .insert(planEntitlements)
          .values({ ...base, modes: ["fast", "x" as never] }),
      ),
    ).toBe("plan_entitlements_modes_check");
    expect(
      await rejection(() =>
        db()
          .insert(planEntitlements)
          .values({ ...base, dailyCap: -1 }),
      ),
    ).toBe("plan_entitlements_daily_cap_check");
    expect(
      await rejection(() =>
        db()
          .insert(planEntitlements)
          .values({ ...base, monthlyCap: -1 }),
      ),
    ).toBe("plan_entitlements_monthly_cap_check");
    for (const maxPagesPerRx of [0, 5]) {
      expect(
        await rejection(() =>
          db()
            .insert(planEntitlements)
            .values({ ...base, maxPagesPerRx }),
        ),
      ).toBe("plan_entitlements_max_pages_check");
    }
    await db()
      .insert(planEntitlements)
      .values({ ...base, dailyCap: null, maxPagesPerRx: 4 });
    expect(await rejection(() => db().insert(planEntitlements).values(base))).toBe(
      "plan_entitlements_pkey",
    );
  });

  it("rejects an assignment that ends before it starts", async () => {
    const user = await newUser();
    const plan = await newPlan();
    const startsAt = new Date("2026-01-02T00:00:00Z");
    expect(
      await rejection(() =>
        db().insert(planAssignments).values({
          ownerUserId: user.id,
          planId: plan.id,
          startsAt,
          endsAt: startsAt,
        }),
      ),
    ).toBe("plan_assignments_period_check");
    await db()
      .insert(planAssignments)
      .values({ ownerUserId: user.id, planId: plan.id, startsAt, endsAt: null });
  });

  it("will not delete a plan that is assigned, and removes the entitlements and routes of an unused one", async () => {
    const user = await newUser();
    const assigned = await newPlan();
    await db().insert(planAssignments).values({ ownerUserId: user.id, planId: assigned.id });
    expect(
      await rejection(() => db().execute(sql`delete from plans where id = ${assigned.id}`)),
    ).toBe("plan_assignments_plan_id_plans_id_fk");

    const unused = await newPlan();
    await db()
      .insert(planEntitlements)
      .values({ planId: unused.id, task: "chat", modes: ["fast"] });
    await db()
      .insert(aiTaskRoutes)
      .values({
        task: "chat",
        planId: unused.id,
        mode: "fast",
        models: [{ modelId: "m", params: {} }],
      });
    await db().execute(sql`delete from plans where id = ${unused.id}`);
    const left = await db().execute<{ count: number }>(
      sql`select ((select count(*) from plan_entitlements where plan_id = ${unused.id})
        + (select count(*) from ai_task_routes where plan_id = ${unused.id}))::int as count`,
    );
    expect(left[0]?.count).toBe(0);
  });
});

describe("AI control tables", () => {
  it("keeps one route per task, plan and mode, with the default plan as a single value", async () => {
    const route = {
      task: "summarize" as const,
      mode: "balanced" as const,
      models: [{ modelId: "m", params: {} }],
    };
    await db().insert(aiTaskRoutes).values(route);
    expect(await rejection(() => db().insert(aiTaskRoutes).values(route))).toBe(
      "ai_task_routes_key",
    );
    const plan = await newPlan();
    await db()
      .insert(aiTaskRoutes)
      .values({ ...route, planId: plan.id });
    await db()
      .insert(aiTaskRoutes)
      .values({ ...route, mode: "deep" });
    // The seed test below expects no default routes yet.
    await db().execute(sql`delete from ai_task_routes where plan_id is null`);
  });

  it("requires a non-empty model list and a positive version", async () => {
    const base = { task: "classify", mode: "fast" } as const;
    expect(
      await rejection(() =>
        db()
          .insert(aiTaskRoutes)
          .values({ ...base, models: [] }),
      ),
    ).toBe("ai_task_routes_models_check");
    expect(
      await rejection(() =>
        db()
          .insert(aiTaskRoutes)
          .values({ ...base, models: {} as never }),
      ),
    ).toBe("ai_task_routes_models_check");
    expect(
      await rejection(() =>
        db()
          .insert(aiTaskRoutes)
          .values({ ...base, models: [{ modelId: "m", params: {} }], version: 0 }),
      ),
    ).toBe("ai_task_routes_version_check");
  });

  it("checks providers and models, and keeps a model unique per provider", async () => {
    const providerBase = { kind: "fake", dataPolicy: "zdr" } as const;
    expect(
      await rejection(() =>
        db()
          .insert(aiProviders)
          .values({ ...providerBase, key: unique("p"), kind: "x" as never }),
      ),
    ).toBe("ai_providers_kind_check");
    expect(
      await rejection(() =>
        db()
          .insert(aiProviders)
          .values({ ...providerBase, key: unique("p"), dataPolicy: "x" as never }),
      ),
    ).toBe("ai_providers_data_policy_check");

    const [provider] = await db()
      .insert(aiProviders)
      .values({ ...providerBase, key: unique("p") })
      .returning();
    if (!provider) throw new Error("insert returned no row");
    expect(provider.enabled).toBe(false);

    const model = { providerId: provider.id, modelId: "m1", displayName: "M1" };
    await db().insert(aiModels).values(model);
    expect(await rejection(() => db().insert(aiModels).values(model))).toBe(
      "ai_models_provider_model_key",
    );
    expect(
      await rejection(() =>
        db()
          .insert(aiModels)
          .values({ ...model, modelId: "m2", capabilities: ["x" as never] }),
      ),
    ).toBe("ai_models_capabilities_check");
    expect(
      await rejection(() =>
        db()
          .insert(aiModels)
          .values({ ...model, modelId: "m3", priceInputUsdMicrosPerM: -1 }),
      ),
    ).toBe("ai_models_price_input_check");
    expect(
      await rejection(() =>
        db()
          .insert(aiModels)
          .values({ ...model, modelId: "m4", priceCachedInputUsdMicrosPerM: -1 }),
      ),
    ).toBe("ai_models_price_cached_input_check");
    expect(
      await rejection(() =>
        db()
          .insert(aiModels)
          .values({ ...model, modelId: "m5", creditMultiplierBp: 0 }),
      ),
    ).toBe("ai_models_credit_multiplier_check");
    expect(
      await rejection(() =>
        db()
          .insert(aiModels)
          .values({ ...model, modelId: "m6", priceSource: "x" as never }),
      ),
    ).toBe("ai_models_price_source_check");
    expect(
      await rejection(() => db().execute(sql`delete from ai_providers where id = ${provider.id}`)),
    ).toBe("ai_models_provider_id_ai_providers_id_fk");
  });

  it("keeps usage history when a model or provider goes away, and rejects negative counters", async () => {
    const [provider] = await db()
      .insert(aiProviders)
      .values({ key: unique("p"), kind: "fake", dataPolicy: "zdr" })
      .returning();
    if (!provider) throw new Error("insert returned no row");
    const [model] = await db()
      .insert(aiModels)
      .values({ providerId: provider.id, modelId: "gone", displayName: "Gone" })
      .returning();
    if (!model) throw new Error("insert returned no row");

    const base = { task: "chat", modelKey: "gone", outcome: "ok" } as const;
    const [usage] = await db()
      .insert(aiUsage)
      .values({ ...base, modelId: model.id, providerId: provider.id, costUsdMicros: 1_500_000 })
      .returning();
    if (!usage) throw new Error("insert returned no row");

    await db().execute(sql`delete from ai_models where id = ${model.id}`);
    await db().execute(sql`delete from ai_providers where id = ${provider.id}`);
    const [kept] = await db().select().from(aiUsage).where(eq(aiUsage.id, usage.id));
    expect(kept).toMatchObject({
      modelId: null,
      providerId: null,
      modelKey: "gone",
      costUsdMicros: 1_500_000,
    });

    expect(
      await rejection(() =>
        db()
          .insert(aiUsage)
          .values({ ...base, inputTokens: -1 }),
      ),
    ).toBe("ai_usage_tokens_check");
    expect(
      await rejection(() =>
        db()
          .insert(aiUsage)
          .values({ ...base, searchCount: -1 }),
      ),
    ).toBe("ai_usage_search_count_check");
    expect(
      await rejection(() =>
        db()
          .insert(aiUsage)
          .values({ ...base, costUsdMicros: -1 }),
      ),
    ).toBe("ai_usage_cost_check");
    expect(
      await rejection(() =>
        db()
          .insert(aiUsage)
          .values({ ...base, creditsCharged: -1 }),
      ),
    ).toBe("ai_usage_credits_check");
    expect(
      await rejection(() =>
        db()
          .insert(aiUsage)
          .values({ ...base, latencyMs: -1 }),
      ),
    ).toBe("ai_usage_latency_check");
    expect(
      await rejection(() =>
        db()
          .insert(aiUsage)
          .values({ ...base, task: "x" as never }),
      ),
    ).toBe("ai_usage_task_check");
    expect(
      await rejection(() =>
        db()
          .insert(aiUsage)
          .values({ ...base, outcome: "x" as never }),
      ),
    ).toBe("ai_usage_outcome_check");
  });
});

describe("credits", () => {
  it("never lets a balance go below zero", async () => {
    const user = await newUser();
    expect(await rejection(() => newWallet(user.id, -1))).toBe("credit_wallets_balance_check");
    await newWallet(user.id, 5);
    expect(
      await rejection(() =>
        db().execute(
          sql`update credit_wallets set balance = balance - 6 where owner_user_id = ${user.id}`,
        ),
      ),
    ).toBe("credit_wallets_balance_check");
  });

  it("checks reservations: positive amount, settlement within the amount, known status", async () => {
    const user = await newUser();
    const wallet = await newWallet(user.id);
    const base = {
      walletId: wallet.id,
      amount: 5,
      purpose: "rx",
      expiresAt: new Date("2030-01-01T00:00:00Z"),
    };
    expect(
      await rejection(() =>
        db()
          .insert(creditReservations)
          .values({ ...base, amount: 0 }),
      ),
    ).toBe("credit_reservations_amount_check");
    expect(
      await rejection(() =>
        db()
          .insert(creditReservations)
          .values({ ...base, settledAmount: 6 }),
      ),
    ).toBe("credit_reservations_settled_amount_check");
    expect(
      await rejection(() =>
        db()
          .insert(creditReservations)
          .values({ ...base, settledAmount: -1 }),
      ),
    ).toBe("credit_reservations_settled_amount_check");
    expect(
      await rejection(() =>
        db()
          .insert(creditReservations)
          .values({ ...base, status: "x" as never }),
      ),
    ).toBe("credit_reservations_status_check");
    const [ok] = await db()
      .insert(creditReservations)
      .values({ ...base, settledAmount: 5, status: "settled" })
      .returning();
    expect(ok?.status).toBe("settled");
  });

  it("checks ledger rows and rejects a repeated idempotency key", async () => {
    const user = await newUser();
    const wallet = await newWallet(user.id);
    const entry = { walletId: wallet.id, kind: "grant", amount: 30, balanceAfter: 30 } as const;
    const key = unique("idem");
    await db()
      .insert(creditLedger)
      .values({ ...entry, idempotencyKey: key });
    expect(
      await rejection(() =>
        db()
          .insert(creditLedger)
          .values({ ...entry, idempotencyKey: key }),
      ),
    ).toBe("credit_ledger_idempotency_key_key");
    expect(
      await rejection(() =>
        db()
          .insert(creditLedger)
          .values({ ...entry, amount: 0, idempotencyKey: unique("idem") }),
      ),
    ).toBe("credit_ledger_amount_check");
    expect(
      await rejection(() =>
        db()
          .insert(creditLedger)
          .values({ ...entry, balanceAfter: -1, idempotencyKey: unique("idem") }),
      ),
    ).toBe("credit_ledger_balance_after_check");
    expect(
      await rejection(() =>
        db()
          .insert(creditLedger)
          .values({ ...entry, kind: "x" as never, idempotencyKey: unique("idem") }),
      ),
    ).toBe("credit_ledger_kind_check");
    // A debit is a negative amount.
    await db()
      .insert(creditLedger)
      .values({
        ...entry,
        kind: "usage_settle",
        amount: -3,
        balanceAfter: 27,
        idempotencyKey: unique("idem"),
      });
  });

  it("keeps the ledger when someone tries to delete its wallet or reservation", async () => {
    const user = await newUser();
    const wallet = await newWallet(user.id);
    const [reservation] = await db()
      .insert(creditReservations)
      .values({
        walletId: wallet.id,
        amount: 2,
        purpose: "chat",
        expiresAt: new Date("2030-01-01T00:00:00Z"),
      })
      .returning();
    if (!reservation) throw new Error("insert returned no row");
    await db()
      .insert(creditLedger)
      .values({
        walletId: wallet.id,
        kind: "usage_reserve",
        amount: -2,
        balanceAfter: 8,
        reservationId: reservation.id,
        idempotencyKey: unique("idem"),
      });
    expect(
      await rejection(() => db().execute(sql`delete from credit_wallets where id = ${wallet.id}`)),
    ).toBe("credit_ledger_wallet_id_credit_wallets_id_fk");
    expect(
      await rejection(() =>
        db().execute(sql`delete from credit_reservations where id = ${reservation.id}`),
      ),
    ).toBe("credit_ledger_reservation_id_credit_reservations_id_fk");
  });
});

describe("the API role and the append-only ledger", () => {
  async function ledgerRowAsApi() {
    const user = await newUser();
    const wallet = await newWallet(user.id);
    const key = unique("api-idem");
    await api.db.insert(creditLedger).values({
      walletId: wallet.id,
      kind: "grant",
      amount: 5,
      balanceAfter: 15,
      idempotencyKey: key,
    });
    return key;
  }

  it("can append to and read the ledger", async () => {
    const key = await ledgerRowAsApi();
    const rows = await api.db.select().from(creditLedger);
    expect(rows.some((row) => row.idempotencyKey === key)).toBe(true);
  });

  it("cannot UPDATE, DELETE or TRUNCATE credit_ledger (permission denied)", async () => {
    const key = await ledgerRowAsApi();
    expect(await sqlState(api.db.execute(sql`update credit_ledger set amount = 999`))).toBe(
      "42501",
    );
    expect(await sqlState(api.db.execute(sql`delete from credit_ledger`))).toBe("42501");
    expect(await sqlState(api.db.execute(sql`truncate credit_ledger`))).toBe("42501");
    const rows = await db().select().from(creditLedger);
    const row = rows.find((candidate) => candidate.idempotencyKey === key);
    expect(row?.amount).toBe(5);
  });

  it("can still read and write the other Phase 2 tables (balance changes in the same transaction)", async () => {
    const user = await newUser();
    const wallet = await newWallet(user.id, 10);
    await api.db.execute(
      sql`update credit_wallets set balance = balance - 2 where id = ${wallet.id}`,
    );
    const [after] = await api.db
      .select()
      .from(creditWallets)
      .where(eq(creditWallets.id, wallet.id));
    expect(after?.balance).toBe(8);
    expect(await sqlState(api.db.execute(sql`delete from ai_usage where false`))).toBeUndefined();
  });

  it("leaves the owner role able to maintain the ledger (migrations and retention run as the owner)", async () => {
    expect(
      await sqlState(db().execute(sql`update credit_ledger set reason = reason where false`)),
    ).toBeUndefined();
  });
});

describe("files", () => {
  const base = { purpose: "rx_page", mime: "image/png", bytes: 1000 } as const;
  const insertFile = async (overrides: Partial<typeof files.$inferInsert> = {}) => {
    const user = await newUser();
    return db()
      .insert(files)
      .values({ ownerUserId: user.id, r2Key: unique("key"), ...base, ...overrides });
  };

  it("accepts jpeg, png and webp only", async () => {
    for (const mime of ["image/jpeg", "image/png", "image/webp"] as const)
      await insertFile({ mime });
    for (const mime of ["image/gif", "image/svg+xml", "application/pdf", "image/jpeg2"]) {
      expect(await rejection(() => insertFile({ mime: mime as never }))).toBe("files_mime_check");
    }
  });

  it("keeps the size between 1 byte and 15 MB, and hashes in the right shape", async () => {
    await insertFile({ bytes: 1 });
    await insertFile({ bytes: 15 * 1024 * 1024 });
    for (const bytes of [0, 15 * 1024 * 1024 + 1]) {
      expect(await rejection(() => insertFile({ bytes }))).toBe("files_bytes_check");
    }
    await insertFile({ sha256: "a".repeat(64), dhash: "0123456789abcdef" });
    expect(await rejection(() => insertFile({ sha256: "A".repeat(64) }))).toBe(
      "files_sha256_check",
    );
    expect(await rejection(() => insertFile({ sha256: "a".repeat(63) }))).toBe(
      "files_sha256_check",
    );
    expect(await rejection(() => insertFile({ dhash: "xyz" }))).toBe("files_dhash_check");
  });

  it("rejects an unknown purpose or status and a repeated storage key", async () => {
    expect(await rejection(() => insertFile({ purpose: "x" as never }))).toBe(
      "files_purpose_check",
    );
    expect(await rejection(() => insertFile({ status: "x" as never }))).toBe("files_status_check");
    const key = unique("same");
    await insertFile({ r2Key: key });
    expect(await rejection(() => insertFile({ r2Key: key }))).toBe("files_r2_key_key");
  });
});

describe("prescriptions and chats", () => {
  it("limits initials to 8 characters and checks status, mode and credits", async () => {
    const user = await newUser();
    const base = { ownerUserId: user.id, mode: "fast", skillVersion: "v1" } as const;
    await db()
      .insert(rxAnalyses)
      .values({ ...base, patientInitials: "A.B.", prescriberInitials: "C.D." });
    expect(
      await rejection(() =>
        db()
          .insert(rxAnalyses)
          .values({ ...base, patientInitials: "123456789" }),
      ),
    ).toBe("rx_analyses_patient_initials_check");
    expect(
      await rejection(() =>
        db()
          .insert(rxAnalyses)
          .values({ ...base, prescriberInitials: "123456789" }),
      ),
    ).toBe("rx_analyses_prescriber_initials_check");
    expect(
      await rejection(() =>
        db()
          .insert(rxAnalyses)
          .values({ ...base, status: "x" as never }),
      ),
    ).toBe("rx_analyses_status_check");
    expect(
      await rejection(() =>
        db()
          .insert(rxAnalyses)
          .values({ ...base, mode: "x" as never }),
      ),
    ).toBe("rx_analyses_mode_check");
    expect(
      await rejection(() =>
        db()
          .insert(rxAnalyses)
          .values({ ...base, creditsCharged: -1 }),
      ),
    ).toBe("rx_analyses_credits_check");
  });

  it("keeps an analysis when the one it was copied from is deleted, and removes pages with it", async () => {
    const user = await newUser();
    const base = { ownerUserId: user.id, mode: "fast", skillVersion: "v1" } as const;
    const [original] = await db().insert(rxAnalyses).values(base).returning();
    if (!original) throw new Error("insert returned no row");
    const [copy] = await db()
      .insert(rxAnalyses)
      .values({ ...base, cacheOf: original.id })
      .returning();
    if (!copy) throw new Error("insert returned no row");
    await db().execute(sql`delete from rx_analyses where id = ${original.id}`);
    const [kept] = await db().select().from(rxAnalyses).where(eq(rxAnalyses.id, copy.id));
    expect(kept?.cacheOf).toBeNull();
  });

  it("numbers pages 1 to 4, once each, and protects a file that a page uses", async () => {
    const user = await newUser();
    const [analysis] = await db()
      .insert(rxAnalyses)
      .values({ ownerUserId: user.id, mode: "fast", skillVersion: "v1" })
      .returning();
    const [file] = await db()
      .insert(files)
      .values({
        ownerUserId: user.id,
        purpose: "rx_page",
        r2Key: unique("key"),
        mime: "image/webp",
        bytes: 10,
      })
      .returning();
    if (!analysis || !file) throw new Error("insert returned no row");
    for (const pageNo of [0, 5]) {
      expect(
        await rejection(() =>
          db().execute(
            sql`insert into rx_pages (analysis_id, page_no, file_id) values (${analysis.id}, ${pageNo}, ${file.id})`,
          ),
        ),
      ).toBe("rx_pages_page_no_check");
    }
    await db().execute(
      sql`insert into rx_pages (analysis_id, page_no, file_id) values (${analysis.id}, 1, ${file.id})`,
    );
    expect(
      await rejection(() =>
        db().execute(
          sql`insert into rx_pages (analysis_id, page_no, file_id) values (${analysis.id}, 1, ${file.id})`,
        ),
      ),
    ).toBe("rx_pages_pkey");
    expect(await rejection(() => db().execute(sql`delete from files where id = ${file.id}`))).toBe(
      "rx_pages_file_id_files_id_fk",
    );
  });

  it("checks chat messages: role, status, array parts, non-negative credits", async () => {
    const user = await newUser();
    const [chat] = await db()
      .insert(chats)
      .values({ ownerUserId: user.id, userId: user.id })
      .returning();
    if (!chat) throw new Error("insert returned no row");
    const base = { chatId: chat.id, role: "user" } as const;
    const [message] = await db().insert(chatMessages).values(base).returning();
    expect(message).toMatchObject({ content: "", parts: [], status: "done", creditsCharged: 0 });
    expect(
      await rejection(() =>
        db()
          .insert(chatMessages)
          .values({ ...base, role: "x" as never }),
      ),
    ).toBe("chat_messages_role_check");
    expect(
      await rejection(() =>
        db()
          .insert(chatMessages)
          .values({ ...base, status: "x" as never }),
      ),
    ).toBe("chat_messages_status_check");
    expect(
      await rejection(() =>
        db()
          .insert(chatMessages)
          .values({ ...base, parts: {} }),
      ),
    ).toBe("chat_messages_parts_check");
    expect(
      await rejection(() =>
        db()
          .insert(chatMessages)
          .values({ ...base, creditsCharged: -1 }),
      ),
    ).toBe("chat_messages_credits_check");
  });
});

describe("seed", () => {
  it("is idempotent: the second run inserts nothing and changes nothing", async () => {
    const first = await seedDefaults(db());
    expect(first).toMatchObject({
      aiProviders: 2,
      aiModels: 6,
      aiTaskRoutes: ROUTE_COUNT,
    });
    // `free` only: the paid plans (plus, pro, clinic) are seeded with their prices by seedBilling (Phase 3).
    expect(first.plans).toBe(1);
    expect(first.planEntitlements).toBeGreaterThan(0);

    const snapshot = async () => ({
      plans: await db().execute(sql`select * from plans order by key`),
      entitlements: await db().execute(sql`select * from plan_entitlements order by plan_id, task`),
      providers: await db().execute(sql`select * from ai_providers order by key`),
      models: await db().execute(sql`select * from ai_models order by model_id, provider_id`),
      routes: await db().execute(sql`select * from ai_task_routes order by task, mode`),
    });
    const before = await snapshot();
    expect(await seedDefaults(db())).toMatchObject({
      plans: 0,
      planEntitlements: 0,
      aiProviders: 0,
      aiModels: 0,
      aiTaskRoutes: 0,
    });
    expect(await snapshot()).toEqual(before);
  });

  it("seeds the free and pro plans, disabled keyless providers, priced models and a route for every task and mode", async () => {
    await seedDefaults(db());
    const free = (
      await db().execute<Record<string, unknown>>(sql`select * from plans where key = 'free'`)
    )[0];
    expect(free).toMatchObject({ is_default: true, monthly_credits: 30, visibility: "public" });
    const pro = (
      await db().execute<Record<string, unknown>>(sql`select * from plans where key = 'pro'`)
    )[0];
    expect(pro).toMatchObject({ is_default: false, visibility: "hidden" });

    const freeEntitlements = await db().execute<Record<string, unknown>>(
      sql`select e.* from plan_entitlements e join plans p on p.id = e.plan_id where p.key = 'free' order by e.task`,
    );
    expect(freeEntitlements.map((row) => row.task)).toEqual([
      "chat",
      "classify",
      "rx_extract",
      "rx_verify",
      "summarize",
      "title_gen",
    ]);
    expect(freeEntitlements.find((row) => row.task === "rx_extract")).toMatchObject({
      allowed: true,
      daily_cap: 3,
      modes: ["fast", "balanced"],
      max_pages_per_rx: 4,
      web_search: false,
    });

    const proEntitlements = await db().execute<Record<string, unknown>>(
      sql`select e.* from plan_entitlements e join plans p on p.id = e.plan_id where p.key = 'pro'`,
    );
    expect(proEntitlements).toHaveLength(AI_TASKS.length);
    expect(proEntitlements.every((row) => row.allowed === true && row.web_search === true)).toBe(
      true,
    );

    const providers = await db().execute<Record<string, unknown>>(
      sql`select * from ai_providers where key in ('gemini', 'openrouter') order by key`,
    );
    expect(
      providers.map((row) => [row.key, row.kind, row.data_policy, row.enabled, row.api_key_enc]),
    ).toEqual([
      ["gemini", "gemini", "paid_no_training", false, null],
      ["openrouter", "openrouter", "zdr", false, null],
    ]);

    const flash = (
      await db().execute<Record<string, unknown>>(
        sql`select * from ai_models where model_id = 'gemini-3.8-flash'`,
      )
    )[0];
    expect(flash).toMatchObject({
      price_input_usd_micros_per_m: "750000",
      price_cached_input_usd_micros_per_m: "75000",
      price_output_usd_micros_per_m: "3750000",
      price_source: "manual",
    });

    // Every default route resolves to real models; the default plan is stored as null.
    const routes = await db().execute<{
      task: string;
      mode: string;
      plan_id: string | null;
      resolved: number;
      total: number;
    }>(
      sql`select r.task, r.mode, r.plan_id,
          (select count(*) from jsonb_array_elements(r.models) e join ai_models m on m.id = (e->>'modelId')::uuid)::int as resolved,
          jsonb_array_length(r.models) as total
        from ai_task_routes r where r.plan_id is null`,
    );
    expect(routes).toHaveLength(ROUTE_COUNT);
    expect(routes.every((row) => row.plan_id === null && row.resolved === row.total)).toBe(true);
    expect(new Set(routes.map((row) => `${row.task}/${row.mode}`)).size).toBe(ROUTE_COUNT);

    // The seeded params are the admin API's own vocabulary: an admin can open and re-save any route.
    const stored = await db().execute<{ models: unknown }>(
      sql`select models from ai_task_routes where plan_id is null`,
    );
    expect(stored).toHaveLength(ROUTE_COUNT);
    for (const row of stored) expect(routeModelsSchema.safeParse(row.models).success).toBe(true);
    const webSearch = await db().execute<{ models: { params: unknown }[] }>(
      sql`select models from ai_task_routes where task = 'web_search' and mode = 'fast'`,
    );
    expect(webSearch[0]?.models.map((entry) => entry.params)).toEqual([
      { search: true },
      { search: true },
    ]);
  });

  it("never brings back what an admin changed or removed", async () => {
    await seedDefaults(db());
    // The admin edits free, removes its chat entitlement, makes pro the default, enables a provider and bumps route versions.
    await db().execute(sql`update plans set monthly_credits = 99 where key = 'free'`);
    await db().execute(
      sql`delete from plan_entitlements where task = 'chat' and plan_id = (select id from plans where key = 'free')`,
    );
    await db().execute(sql`update plans set is_default = false where key = 'free'`);
    await db().execute(sql`update plans set is_default = true where key = 'pro'`);
    await db().execute(sql`update ai_providers set enabled = true where key = 'gemini'`);
    await db().execute(sql`update ai_task_routes set version = 7 where task = 'chat'`);

    expect(await seedDefaults(db())).toMatchObject({
      plans: 0,
      planEntitlements: 0,
      aiProviders: 0,
      aiModels: 0,
      aiTaskRoutes: 0,
    });
    const free = (
      await db().execute<Record<string, unknown>>(sql`select * from plans where key = 'free'`)
    )[0];
    expect(free).toMatchObject({ monthly_credits: 99, is_default: false });
    const chat = await db().execute(
      sql`select 1 from plan_entitlements where task = 'chat' and plan_id = (select id from plans where key = 'free')`,
    );
    expect(chat).toHaveLength(0);
    const gemini = (
      await db().execute<{ enabled: boolean }>(
        sql`select enabled from ai_providers where key = 'gemini'`,
      )
    )[0];
    expect(gemini?.enabled).toBe(true);
    const versions = await db().execute<{ version: number }>(
      sql`select version from ai_task_routes where task = 'chat'`,
    );
    expect(versions.every((row) => row.version === 7)).toBe(true);

    // The free plan was deleted and pro holds the default flag: re-seeding must not fail on the partial unique index.
    await db().execute(sql`delete from plans where key = 'free'`);
    expect((await seedDefaults(db())).plans).toBe(0);
  });
});
