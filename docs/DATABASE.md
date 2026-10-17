# DATABASE.md — Wasfa AI

> PostgreSQL 18 + Drizzle ORM. The schema lives in `packages/db/src/schema/`, migrations in `packages/db/migrations/`. This file explains the conventions and indexes the code cannot say for itself.
> **Update it in every task that adds or changes a table.** A table that is in the schema but not in the index below is a bug.
> Status: reflects the code after Phase 3 Task 3.1 (data model; migrations 0010-0012).

---

## 1. Conventions

| Topic | Rule |
|---|---|
| Names | `snake_case` tables (plural) and columns. TypeScript keeps camelCase; `casing: "snake_case"` in both `drizzle.config.ts` and `createDb` maps them. |
| Primary keys | `uuid` with the database default `uuidv7()` (time-sortable, PostgreSQL 18 native). Use `idColumn()` from `schema/columns.ts`. Join tables use a composite primary key instead. |
| Timestamps | `timestamptz`. `created_at` and `updated_at` via `timestamps()`. Drizzle refreshes `updated_at` on ORM updates; **raw SQL updates must set it themselves.** |
| Money | Integer **minor units** (`amount_minor`) plus an ISO 4217 `currency`. Never `numeric` or float. (Credits and plans arrived in Phase 2; payments, orders and points in Phase 3, see the Phase 3 section of §2.) |
| Closed value sets | `text` + a `CHECK (col IN (...))`, never a Postgres `ENUM` (adding a value is then a one-line migration, not `ALTER TYPE`). The list is a `const` tuple in `@wasfa/shared` (`identity.ts`, `permissions.ts`) and **the same tuple** types the column and builds the CHECK (`inList()`), so TypeScript and the database cannot drift. |
| Emails | `citext` (case-insensitive), unique. |
| Phones | E.164 (`+201001234567`), enforced by a CHECK that reuses `E164_PATTERN.source`. |
| Countries | ISO 3166-1 alpha-2, upper case, same mechanism (`COUNTRY_CODE_PATTERN`). |
| Soft delete | **None**, with one exception: `users` (`status = 'deleted'` + `deleted_at`, then anonymization, §5). Everything else is hard-deleted; history that must survive lives in `audit_logs`. |
| Foreign keys | Always declared. `ON DELETE CASCADE` for data that has no meaning without its parent (sessions, memberships); `RESTRICT` where deleting would silently destroy history or access (`organizations.created_by`, `user_roles.role_key`); `SET NULL` for "who did it" columns (`invited_by`, `granted_by`). |
| Secrets in columns | Never plaintext. Passwords are Argon2id hashes; OAuth tokens, TOTP secrets and WhatsApp auth state are encrypted (Better Auth or `encryptSecret`). |
| Extensions | `pgcrypto`, `pg_trgm`, `unaccent`, `citext` (migration `0000`). |

### Migration workflow

1. Edit the schema, then `pnpm db:generate --name <what_changed>` (it builds `@wasfa/shared` first because the schema imports it).
2. **Hand-review the SQL.** Check constraint names, `ON DELETE` rules, partial-index predicates, and that nothing drops data. Run `pnpm db:generate` again: it must report "No schema changes".
3. Never edit a migration that has been merged. Fix forward with a new one.
4. Migrations are **not rolled back** on a failed deploy (`deploy.sh`), so write them *expand → contract*: the previous release must keep working against the new schema; remove old columns in a later release.
5. `pnpm db:migrate` then `pnpm db:seed` must succeed on an empty database, and `db:seed` must be safe to run twice (tests: `packages/db/test/*.int.test.ts`, Testcontainers, PostgreSQL 18).

### Seed policy

`seedDefaults()` is **insert-only and idempotent**: existing rows are never touched. Site settings: existing keys are skipped. Roles: a role's permissions are seeded **only in the same transaction that creates the role**, so an admin who removes a permission from a role never sees it come back after a deploy. The `auth` setting (provider statuses, extra blocked email domains, the phone-verification kill switch) is seeded the same way. Consequence: a permission added to the catalog in a later phase reaches existing non-`super_admin` roles only through an explicit data migration or the role editor. (`super_admin` is a wildcard in the resolver, Task 1.6, so it always has everything.)

---

## 2. Table index

"Owner" is the column every query on that table must filter by (AGENT §5.4); tables with no owner are platform data reachable only through permission-checked admin routes (or by the system).

### Phase 0

| Table | Purpose | Owner / access |
|---|---|---|
| `site_settings` | Admin-editable site configuration (`key → jsonb`), cached in Redis by the api. | Platform. Public subset via `GET /settings/public` (Task 1.8). |
| `feature_flags` | Flag key, `enabled`, targeting `rules` jsonb. | Platform. |
| `audit_logs` | Append-only record of admin writes (actor, action, target, before/after, ip, user agent). | Platform; `audit.read`. No FK on `actor_id`/`target_id` on purpose: history must outlive its subjects. |
| `error_events` | One row per unexpected error, keyed by the user-visible `WSF-XXXX-XXXX` ref. | Platform; `issues.read`. `user_id` is informational. |
| `site_assets` | Brand images uploaded from the admin panel: `key` (`logo`, `logo_dark`, `favicon`), `content_type`, `data` (`bytea`, ≤ 512 KB), `sha256`, optional pixel `width`/`height`, `updated_by` (`SET NULL`). One row per key. | Platform; written by `PUT/DELETE /admin/branding/assets/:key` (`settings.write`), read by the public `GET /assets/:key`. |

### Phase 1 — Task 1.2 (identity and organizations)

| Table | Purpose | Owner / access |
|---|---|---|
| `users` | The account: Better Auth core columns plus phone, account type, locale, status, deletion state. | The row is the owner. `GET/PATCH /me` act on `session.user.id`. |
| `user_profiles` | Profession, usage intent, country, city, optional display name. 1:1 with `users`. | `user_id` |
| `accounts` | Sign-in methods per user (`credential` password hash, `google`, ...). Holds secrets. | `user_id` (never exposed by any endpoint). |
| `sessions` | Revocable sessions: opaque token, expiry, IP, user agent. | `user_id` (own list + revoke; admin read via user detail). |
| `verifications` | Short-lived email-verification and password-reset proofs. | None (written and read only by Better Auth). |
| `two_factors` | TOTP secret and backup codes (encrypted), failure counter and lockout. | `user_id` |
| `organizations` | Pharmacy / clinic / hospital / other. | Membership in `organization_members`. |
| `organization_members` | (org, user) → `org_admin` or `org_member`. | `org_id` + membership check; `user_id` for "my orgs". |
| `organization_invites` | Pending invitation by email or phone; only the SHA-256 of the token is stored. | `org_id` (org_admin); the invitee proves identity at accept time. |
| `roles` | Platform roles (global, not per organization): key, Arabic and English names, `is_system`. | Platform; `roles.read` / `roles.write`. |
| `role_permissions` | Which catalog permissions a role holds. | Platform. |
| `user_roles` | Which platform roles a user holds (the implicit `user` role has no row). | `user_id` for the user's own permission resolution; admin writes only. |
| `onboarding_progress` | Resumable wizard state, 1:1 with `users`. | `user_id` |
| `wa_sessions` | Encrypted Baileys auth state of the WhatsApp bridge (`session`, `key`, AES-256-GCM `value`, Task 1.5). | None: not user data; read only by the bridge. |
| `contact_messages` | Contact-form submissions (Task 1.11): name, email and/or phone (`contact_messages_contact_check`), topic, message (≤ 4000), locale, optional `user_id` (`SET NULL`), status `new | read | archived`. Becomes the Phase 4 ticket inbox. | Platform; no read route yet (`contact.*` permission arrives with its admin view). Deleted by the anonymization job for the sender. |

### Phase 2 — Task 2.1 (AI product)

Migration `0008_ai_product.sql` (it also revokes `UPDATE, DELETE, TRUNCATE` on `credit_ledger` from `wasfa_api`, mirroring `audit_logs` in 0005). Schema files `packages/db/src/schema/{plans,credits,ai,files,rx,chats,drugs,evals}.ts`; value sets in `@wasfa/shared` `plans.ts`, `ai.ts`, `rx.ts`.

**Owner pattern (all owned Phase 2 tables).** Two nullable columns `owner_user_id` (FK `users`, `RESTRICT`) and `owner_org_id` (FK `organizations`, `CASCADE`) with `<table>_owner_check: num_nonnulls(owner_user_id, owner_org_id) = 1`. Two declared FKs instead of a polymorphic `(owner_type, owner_id)`, which could not have an FK. Scoped queries filter on whichever one the actor's context selects (Decision 5). `created_by` / `user_id` = the acting user (`SET NULL`), never the owner.

**Money and credits.** Credits are `integer`. USD amounts are `bigint` **USD micros** (`*_usd_micros`, 1 USD = 1,000,000). Prices are USD micros **per 1M tokens**. Multipliers are basis points (`10000` = ×1). No `numeric`, no float.

| Table | Purpose | Owner / access |
|---|---|---|
| `plans` | `key` (unique, `^[a-z][a-z0-9_]*$`), `name_ar`, `name_en`, `audience` (`PLAN_AUDIENCES`: `individual|organization|any`), `is_default`, `monthly_credits` (≥ 0), `visibility` (`public|hidden`), `sort`, `badge_ar/en`. Partial unique `plans_one_default_idx` on `(is_default) where is_default`. | Platform; `plans.read/write`. |
| `plan_entitlements` | PK `(plan_id, task)`; `task` ∈ `AI_TASKS`; `allowed`, `modes text[]` ⊆ `AI_MODES`, `daily_cap`, `monthly_cap` (null = unlimited, else ≥ 0), `max_pages_per_rx` (1–4), `web_search`. Plan FK `CASCADE`. | Platform. |
| `plan_assignments` | Owner pattern; `plan_id` (`RESTRICT`), `starts_at`, `ends_at` (null = open, `> starts_at`), `assigned_by` (`SET NULL`), `reason`. Index `(owner_user_id, starts_at)`, `(owner_org_id, starts_at)`. No row = default plan. | Owner reads; admin writes (`plans.write`). |
| `credit_wallets` | Owner pattern, unique per owner (`credit_wallets_owner_user_key`, `credit_wallets_owner_org_key`); `balance integer ≥ 0` (`credit_wallets_balance_check`). Updated only in the ledger transaction under `FOR UPDATE`. | Owner. |
| `credit_reservations` | `wallet_id` (`RESTRICT`), `amount > 0`, `settled_amount` (null until settled, `0 ≤ settled ≤ amount`), `status` (`open|settled|released|expired`), `purpose`, `expires_at`. Partial index `(expires_at) where status = 'open'` for the sweeper. | Via wallet. |
| `credit_ledger` | **Append-only.** `wallet_id` (`RESTRICT`), `kind` (`CREDIT_LEDGER_KINDS`: `grant|admin_adjust|usage_reserve|usage_settle|release|refund|expiry`, plus `purchase|points_conversion|trial_grant|reward_bonus` since migration 0010), `amount integer <> 0` (signed), `balance_after ≥ 0`, `reservation_id` (`RESTRICT`), `ai_usage_id` (`SET NULL`), `actor_id` (`SET NULL`), `reason`, `idempotency_key` (unique `credit_ledger_idempotency_key_key`), `created_at` only. `wasfa_api` has `SELECT, INSERT` only (like `audit_logs`). Index `(wallet_id, created_at)`. | Via wallet; admin `credits.adjust`. |
| `ai_providers` | `key` unique, `kind` (`gemini|openrouter|openai_compatible|fake`), `base_url`, `api_key_enc` (`encryptSecret`), `key_hint` (last 4), `enabled` (false at seed), `priority`, `data_policy` (`paid_no_training|zdr|free_tier`), `last_test_at`, `last_test_ok`, `last_test_error`. | Platform; `ai.read/write`. Key never leaves the API. |
| `ai_models` | `provider_id` (`RESTRICT`), `model_id` (free text), unique `(provider_id, model_id)`, `display_name`, `capabilities text[]` ⊆ `AI_CAPABILITIES` (`vision|thinking|search|json|bbox`), `context_tokens`, `price_input/cached_input/output_usd_micros_per_m` ≥ 0, `price_search_usd_micros` (per call), `credit_multiplier_bp` (> 0, default 10000), `enabled`, `price_source` (`manual|openrouter_sync`), `price_checked_at`. | Platform. |
| `ai_task_routes` | `task`, `plan_id` (null = default, `CASCADE`), `mode`; unique `ai_task_routes_key` on `(task, coalesce(plan_id, nil-uuid), mode)` (expression index); `models jsonb` = ordered `[{modelId, params}]` (validated by the shared zod schema; CHECK `jsonb_typeof = 'array'` and non-empty); `version integer ≥ 1`, bumped on every write. | Platform. |
| `ai_usage` | One row per provider call. `task`, `route_version`, `model_id` / `provider_id` (`SET NULL`, plus `model_key` text snapshot), owner pattern (both nullable here for system calls: CHECK `≤ 1`), `user_id` (`SET NULL`), tokens `input/cached/output/thinking ≥ 0`, `search_count`, `cost_usd_micros bigint ≥ 0`, `credits_charged ≥ 0`, `latency_ms`, `outcome` (`AI_OUTCOMES`: `ok|error|timeout|cancelled|refused|cache_hit`), `cache_hit`, `request_id`. **No content columns.** Indexes `(created_at)`, `(owner_user_id, created_at)`, `(owner_org_id, created_at)`. | Owner (own usage); `usage.read`. Retention 13 months. |
| `ai_spend_daily` | PK `(day, provider_id, model_id)`; `calls`, tokens, `cost_usd_micros`. Worker upsert. | Platform; `usage.read`. |
| `files` | Owner pattern, `created_by`, `purpose` (`rx_page|chat_image`), `r2_key` unique, `mime` (`FILE_MIMES`), `bytes` (1 B–15 MB), `width/height`, `sha256` (hex 64), `dhash` (hex 16), `status` (`pending|uploaded|processed|rejected|deleted`), `reject_reason`, `expires_at`. Indexes `(sha256)`, `(owner_user_id, dhash)`, `(owner_org_id, dhash)`, partial `(expires_at) where status <> 'deleted'`. | Owner. Objects deleted after `uploads.retentionDays`; row kept as `deleted`. |
| `rx_analyses` | Owner pattern, `created_by`, `status` (`queued|processing|verifying|done|failed|refunded`), `mode`, `credits_charged`, `reservation_id` (`SET NULL`), `skill_version`, `route_version`, `input_sha256`, `cache_of` (self FK, `SET NULL`), `result jsonb` (shared `rxResultSchema`), `patient_initials`, `prescriber_initials` (≤ 8 chars: redacted only), `queued_at/started_at/finished_at`, `error_ref`, `rating` (`good|bad`), `rating_note` (<= 300 chars, scrubbed), `share_for_review` (the owner agreed that an admin may see the picture and the result; off by default; needs a rating), `rated_at` (migration 0009, partial index `rx_analyses_shared_idx` on the shared ones). Index `(owner_*, created_at desc)`, `(input_sha256, skill_version, route_version) where status = 'done'` for the global exact cache. | Owner. |
| `rx_pages` | PK `(analysis_id, page_no)`, `page_no` 1–4, `file_id` (`RESTRICT`). Analysis FK `CASCADE`. | Via analysis. |
| `rx_corrections` | `analysis_id` (`CASCADE`), `item_index ≥ 0`, `field` (`RX_FIELDS`), `before`, `after` (text), `user_id` (`SET NULL`), `consent_for_eval`. | Via analysis. |
| `chats` | Owner pattern, `user_id`, `title`, `skill`, `archived`. Index `(user_id, updated_at desc)`. | Owner + `user_id` (chats are personal even inside an org). |
| `chat_messages` | `chat_id` (`CASCADE`), `role` (`user|assistant|system`), `content` text, `parts jsonb` (array), `status` (`streaming|done|stopped|error`), `ai_usage_id` (`SET NULL`), `credits_charged`. Index `(chat_id, created_at)`. | Via chat. |
| `chat_summaries` | PK `chat_id` (`CASCADE`), `summary`, `through_message_id`, `updated_at`. | Via chat. |
| `drug_import_batches` | `file_name`, `source` (`DRUG_SOURCES`: `eda|sfda|manual|other`), `mapping jsonb`, `rows_total/inserted/updated/skipped`, `status` (`draft|dry_run|committed|rolled_back|failed`), `committed_by` (`SET NULL`), `committed_at`, `rolled_back_at`. | Platform; `drugs.write`. |
| `active_ingredients` | `name_en`, `name_ar`, `normalized` unique, `import_batch_id` (`SET NULL`). GIN trigram on `normalized`. | Platform; `drugs.read`. |
| `drugs` | `brand_en`, `brand_ar`, `normalized_en`, `normalized_ar`, `form`, `strength_text`, `strength_value_micro bigint` (value × 10⁶), `strength_unit`, `manufacturer`, `country` (ISO-2), `status` (`active|withdrawn`), `import_batch_id` (`SET NULL`). GIN trigram on both normalized columns. | Platform. |
| `drug_ingredients` | PK `(drug_id, ingredient_id)` (both `CASCADE`), `strength_text`, `strength_value_micro`, `strength_unit`. | Platform. |
| `drug_aliases` | `drug_id` (`CASCADE`), `alias`, `normalized`, `lang` (`ar|en`), `source`, `import_batch_id`. Unique `(drug_id, normalized)`; GIN trigram on `normalized`. | Platform. |
| `ai_eval_sets` | `key` unique, `name`, `description`. | Platform; `evals.run`. |
| `ai_eval_items` | `set_id` (`CASCADE`), `file_ids uuid[]`, `kind` (`printed|handwritten`), `expected jsonb`. | Platform. |
| `ai_eval_runs` | `set_id` (`RESTRICT`), `route_snapshot jsonb`, `status` (`queued|running|done|failed|cancelled`), `metrics jsonb`, `cost_usd_micros`, `started_by` (`SET NULL`), `started_at`, `finished_at`. | Platform. |
| `ai_eval_results` | PK `(run_id, item_id)` (both `CASCADE`), `output jsonb`, `scores jsonb`, `cost_usd_micros`, `latency_ms`, `error`. | Platform. |

**Details the table above does not say.**
- `ai_task_routes.models[].modelId` is the `ai_models.id` (uuid) of the model, not the provider's own model string, which is only unique per provider. The seed resolves the ids after inserting the models.
- `ai_spend_daily.provider_id` / `model_id` are `RESTRICT` (they are in the primary key, so they cannot be nulled; spend history is kept). `chat_summaries.through_message_id` is `CASCADE` (a summary of a deleted message is stale). `chats.user_id` is nullable (`SET NULL`) like every acting-user column.
- `files.sha256` / `dhash`, `rx_analyses.input_sha256` / `route_version` and most `drugs` text columns are nullable (known only after processing or absent in the source list); `drugs.brand_en` and `normalized_en` are required.
- `credit_ledger.ai_usage_id` is `SET NULL`: Postgres runs that referential action with the table owner's rights, so pruning old `ai_usage` rows (13-month retention, run by the owner role) clears the link without giving `wasfa_api` UPDATE on the ledger.
- `plans_one_default_idx` can reject re-seeding `free` after an admin made another plan the default; the seed inserts plans without a conflict target so that case is skipped, not an error.

**Retention.** `files` objects: `uploads.retentionDays` (default 30), row kept with `status = 'deleted'`. `rx_analyses`, `chats`: until the owner deletes them or the account is anonymized (§5: user-owned rows are hard-deleted; org-owned rows stay with the org). `ai_usage`: 13 months, then rolled into `ai_spend_daily`. `credit_ledger`: forever (financial record). `rx_corrections` with `consent_for_eval = false`: deleted with the analysis.

**Seed (insert-only).** Plans `free` (default, 30 credits, `rx_extract` 3/day and `chat`, modes `fast,balanced`, no web search; the internal steps `rx_verify`, `title_gen`, `classify`, `summarize` are allowed because the feature price covers them) and `pro` (hidden); providers `gemini`, `openrouter` disabled with no key; models and default routes from phase2.md Decision 3; permissions `ai.read, ai.write, ai.killswitch, plans.read, plans.write, credits.adjust, drugs.read, drugs.write, evals.run, usage.read` (catalog groups `ai`, `plans`, `credits`, `drugs`, `evals`, `usage`; existing roles other than the `super_admin` wildcard receive them only through the role editor or a data migration, per the seed policy above). Entitlements are seeded only in the transaction that creates their plan; the 24 default routes (8 tasks x 3 modes, `plan_id` null) start identical for every mode and use provider-neutral `params` (`thinking`, `mediaResolution`, `temperature`, `jsonSchema`, `tool`, `plugin`) that the adapter maps (Task 2.3). `gemini-3.1-pro-preview` is seeded `enabled = false`. Code: `packages/db/src/seed-ai.ts`.

### Phase 3 — Task 3.1 (billing, rewards, growth)

Migrations `0010_billing_core.sql`, `0011_rewards_deals.sql`, `0012_growth_alerts.sql`. Schema files `packages/db/src/schema/{billing,subscriptions,promotions,referral-codes,rewards,deals,growth,alerts}.ts`; value sets in `@wasfa/shared` `billing.ts`, `rewards.ts`, `growth.ts`; zod for the jsonb columns and the API inputs in `schemas/{billing,rewards,deals,growth}.ts`. Domain rules live in `docs/BILLING.md`, `docs/REFERRALS-REWARDS.md` and `docs/GROWTH-STRATEGY.md`; this section is the table index.

**Conventions of this phase.**
- **Money** is `integer` `*_minor` plus a `currency` (`^[A-Z]{3}$`, CHECK on every table); percentages are `*_bps` (CHECK 0..10000); points and credits are plain integers. Amounts are `>= 0` (`> 0` for a payment, a refund and a withdrawal's points); only the ledgers are signed.
- **Money owner pattern** (`billingOwnerColumns()` in `schema/owner.ts`): the same two columns and `<table>_owner_check` as Phase 2, but `owner_org_id` is `RESTRICT`, not `CASCADE`: an organization with orders, subscriptions or grants cannot be deleted, money history never cascades away. Used by `orders`, `subscriptions`, `taste_grants`, `coupon_redemptions`.
- **Actor columns** (`reviewed_by`, `created_by`, `approved_by`, `requested_by`, `set_by`, ...) are `SET NULL`; users stay `RESTRICT` as owners. Children with no meaning without their parent are `CASCADE` (`plan_prices`, `credit_pack_prices`, `deal_targets`, `alert_deliveries`, `reward_rules`, `referral_tiers`). Orders point at plans and packs with `RESTRICT`.
- **Sealed columns** hold `encryptSecret` output, never plaintext: `payment_gateways.credentials_enc` (+ `key_hint`) and `payout_destinations.value_enc` (+ `masked`, + `destination_hash` = SHA-256 for uniqueness and fraud checks).
- **Idempotency** is a UNIQUE constraint everywhere money moves (listed per table below and in §4).
- **Append-only for `wasfa_api`** (SELECT, INSERT only; `REVOKE UPDATE, DELETE, TRUNCATE` in the migration, tested in `api-role.int.test.ts`): `credit_ledger` (0008), `audit_logs` (0005), `points_ledger` (0011), `payment_events` and `subscription_events` (0010). `order_number_seq` has `USAGE` granted to `wasfa_api` because `orders.number` calls `nextval()` as its default. A foreign-key action such as `payment_events.payment_id SET NULL` runs with the owner's rights, so it does not need UPDATE on the append-only table.
- Migration `0010` also **replaces `credit_ledger_kind_check`** (adds `purchase`, `points_conversion`, `trial_grant`, `reward_bonus`), **replaces `role_permissions_permission_check`** (permission names may contain `_`, for `users.read_health` and `users.read_chats`) and runs the **data migration** that inserts the Phase 3 permissions into the existing `finance`, `support`, `marketing` and `admin` roles (`INSERT ... SELECT ... JOIN roles ... ON CONFLICT DO NOTHING`; roles that do not exist yet get them from the seed). `super_admin` is a wildcard.

**Billing core (0010).**

| Table | Purpose | Owner / access | Retention |
|---|---|---|---|
| `plans` (altered) | + `tagline_ar/en`, `features jsonb` (array, ≤ 30, `planFeaturesSchema`), `trial_days` (0..365), `pin_recommended`, `max_members` (null or > 0; organization plans), `fair_use_note_ar/en`. | Platform; `plans.read/write`, `billing.write`. | Kept. |
| `plan_assignments` (altered) | + `subscription_id` (`SET NULL`) linking the effective-plan row to the subscription period that created it. The resolver is unchanged. | Owner. | Kept. |
| `plan_prices` | One price per `(plan_id, months 1..24, currency)` (`plan_prices_plan_months_currency_key`), `amount_minor`, `active`. Plan FK `CASCADE`. No automatic currency conversion: no row means not offered in that currency. | Platform; `billing.write`. | Kept. |
| `credit_packs` / `credit_pack_prices` | Pack `key` (unique), names, `credits > 0`, `bonus_credits`, `valid_months` (1..120), `active`, `sort`; one price per `(pack_id, currency)`. | Platform; `billing.write`. | Kept. |
| `tax_rules` | `country` (null = default rule), names, `rate_bps`, `mode` (`added|inclusive`), `applies_to` (`all|subscription|credit_pack`), `active` (false at seed until the accountant answers). | Platform; `billing.write`. | Kept. |
| `payment_methods` | `key` (unique), `kind` (`gateway|manual`), `provider`, names, `instructions_ar/en` with `{amount}`, `{reference}`, `{account}`, `account_display` / `account_holder` (manual), `fee_bps`, `fee_fixed_minor`, `min/max_amount_minor`, `currencies[]` (non-empty), `countries[]` (null = all), `requires_proof`, `review_sla_minutes`, `enabled`, `sort`, `config jsonb` (object, non-secret). The account number is the highest-risk field of the product (BILLING §12). | Platform; `billing.read/write`. | Kept. |
| `payment_gateways` | `key` (unique), `provider`, `mode` (`test|live`), `credentials_enc` (sealed), `merchant_ref` (non-secret account id), `key_hint`, `enabled`, `last_test_*`, `credentials_updated_at` (starts the 10-minute enable cooldown), `verified_at` (end-to-end test passed for the current credentials and mode), `last_webhook_at/ok/error`. | Platform; `billing.write`. Secrets never leave the API. | Kept. |
| `payment_gateway_tests` | Admin verification payments (migration 0013): `gateway_key`, `mode`, unique `provider_order_id` (`gwtest-<uuid>`), `amount_minor > 0`, `currency`, `status` (`pending|succeeded|failed|mismatch`), what the webhook and the status API reported (state, amount, currency, time), `created_by` (`SET NULL`). Never references or changes orders, payments, events, credits, coupons, outbox or revenue. | Platform; `billing.read/write`. | Kept. |
| `orders` | `number` (`WSO-YYYY-NNNNNN`, DB default from `order_number_seq`, unique), money-owner pattern, `kind` (`subscription|upgrade|credit_pack`), `plan_id` / `pack_id` (`RESTRICT`; `orders_refs_check` requires the one the kind needs), `months`, `currency`, `quote jsonb` + `quote_hash` (HMAC, 64 hex), `subtotal/discount/tax/fee/total_minor`, `applied jsonb`, `deal_id` (`SET NULL`), `status`, `payment_kind` (`gateway|manual|free`, null until settled), `expires_at`, `paid_at` (required once paid). | Owner reads; admin `billing.read`. | Kept (financial record). |
| `payments` | Attempts to pay an order: `order_id` (`RESTRICT`), `reference` (`WSP-XXXX`, unique), `method_key` / `gateway` (text snapshots, no FK: history survives a deleted method), `status` (12 values), `amount_minor > 0`, `provider_ref` (unique per gateway when set), manual fields (`sender_phone_masked`, `txn_id` unique per method when set, `proof_file_id` → `files` `SET NULL`, `proof_submissions` 0..3, `flags jsonb` array), review fields (`reviewed_by`, `second_approved_by`, `review_note`, `reject_reason`), `failure_code`. | Via order; `payments.review`. | **Proof images: `billing.proofRetentionDays` (default 365)**, then the object is deleted and the `files` row kept as `deleted`; the payment row is kept. |
| `payment_events` | **Append-only.** Every webhook / poll result: `provider`, `event_id` (`UNIQUE (provider, event_id)` is the replay shield), `type`, redacted `payload` (object), `signature_ok`, `payment_id` (`SET NULL`), `received_at`. | Platform; `billing.read`. | Kept. |
| `refunds` | `payment_id` (`RESTRICT`), `amount_minor > 0`, `reason` (not blank), `status`, `requested_by`, `approved_by`, `provider_ref` (unique when set), `transfer_reference` (manual refunds). | Via payment; `payments.refund`. | Kept. |
| `outbox` | Generic transactional outbox: `topic`, `payload`, `idempotency_key` (unique when set), `attempts`, `available_at`, `processed_at`, `last_error`. Drained by the worker. | System. | Kept (a pruning job may arrive with the outbox drainer, Task 3.3). |

**Subscriptions, offers, promotions (0010).**

| Table | Purpose | Owner / access | Retention |
|---|---|---|---|
| `subscriptions` | Money-owner pattern, `plan_id` (`RESTRICT`), `status` (`trialing|active|grace|expired|canceled`), `source`, `current_period_start/end` (end > start), `months_paid`, `last_order_id` (`SET NULL`), `cancel_at_period_end`, `canceled_at`, `grace_until`, `pending_change jsonb`, `price_snapshot jsonb`, `created_by`. **At most one live subscription per owner**: partial unique `subscriptions_owner_user_live_key` / `subscriptions_owner_org_live_key` where status in (`trialing`, `active`, `grace`). | Owner; admin `billing.read`. | Kept. |
| `subscription_events` | **Append-only** timeline (`created, renewed, upgraded, downgraded_scheduled, grace_started, expired, canceled, admin_changed, refund_applied`), `actor_id`, `data`. | Via subscription. | Kept. |
| `personal_offers` | User-only (`owner_user_id`, `RESTRICT`): `kind` (`welcome|winback|renewal|taste`), template `promotion_id` or `coupon_id` (at most one, `SET NULL`), `rule_key` (label, no FK), `expires_at` (server-side deadline), `consumed_at`, `shown_count`, `dismissed_at`. | Owner. | Kept. |
| `taste_grants` | Free single uses of a premium feature: money-owner pattern, `feature`, `period_key`, `granted_at`, `used_at`, `expires_at`; one per owner, feature and period (`taste_grants_owner_user_period_key`, `taste_grants_owner_org_period_key`). | Owner. | Kept. |
| `user_notifications` | In-app bell: `user_id` (`CASCADE`), `kind`, `params jsonb` (i18n parameters, never prose), `link`, `read_at`. | `user_id`. | Kept. |
| `promotions` | Automatic discount: `kind` (`percent|fixed|bonus_credits|extra_months`; **not** `trial_extension`), `value` (bps, minor units, credits or months), `currency` (exactly when `fixed`), scope arrays (`plan_ids`, `months`, `countries`; empty = any), `audience`, `new_customers_only`, `min_amount_minor`, `starts_at/ends_at`, `max_redemptions`, `per_owner_limit`, `redeemed_count` (≤ max), `stacking`, `priority`, `status`, `show_on_pricing`, `show_countdown` (needs a real `ends_at`). | Platform; `promotions.write`. | Kept. |
| `coupons` | Same columns as promotions with `kind` also allowing `trial_extension`; `code` (unique, `^[A-Z0-9-]{4,32}$`), private target `target_user_id` / `target_org_id` (at most one; `CASCADE`: a private coupon is meaningless without its target), `referral_code_id` (`CASCADE`), `campaign`, `batch` (export / pause as one). | Platform; `coupons.write`. | Kept. |
| `coupon_redemptions` | Money-owner pattern; `coupon_id` and `order_id` (`RESTRICT`), `status` (`reserved|confirmed|released`), unique `(coupon_id, order_id)`. | Via order. | Kept. |

**Rewards, payouts, deals (0011).**

| Table | Purpose | Owner / access | Retention |
|---|---|---|---|
| `referral_programs` | `key` (unique), `kind` (`standard|partner|organization`), names, `active`. | Platform; `referrals.write`. | Kept. |
| `referral_codes` | `code` (unique, `^[A-Z0-9]{3,20}$`), `kind` (`user|partner|organization|campaign`), `program_id` (`RESTRICT`), optional `owner_user_id` (`RESTRICT`) / `owner_org_id` (`CASCADE`), at most one (`referral_codes_owner_check`); one personal code per user (`referral_codes_user_kind_key`). | Owner; admin `referrals.read`. | Kept. |
| `referrals` | The attribution, fixed at registration: `referee_user_id` **unique**, `referrer_user_id` (null for org / campaign codes; never equal to the referee), `code_id`, `program_id`, `source`, `status`, `fraud_score` (0..100), `flags text[]`. | Referrer sees counts and initials only; admin `referrals.read`. | Kept. |
| `reward_rules` | "When EVENT, give BENEFICIARY a REWARD" (REFERRALS §3.2); `program_id` (`CASCADE`), `value`, `hold_days`, limits, validity window, `priority`, `active`. Deal-specific rewards live in the deal's `terms`, not here. | Platform; `referrals.write`. | Kept. |
| `reward_decisions` | Every evaluation outcome (`granted|held_for_review|denied`) with `reason`, `points`, `idempotency_key` (unique). | Platform; `referrals.read`. | Kept. |
| `referral_tiers` | Optional per program: `key`, `min_paid_referrals`, `bonus_bps`; unique `(program_id, key)` and `(program_id, min_paid_referrals)`. | Platform. | Kept. |
| `points_wallets` | One per user (`user_id` unique): `pending`, `cash`, `credit_only` (each CHECK ≥ 0), `lifetime_earned`. Changed only in the transaction that writes its ledger rows, under `FOR UPDATE`. | `user_id`. | Kept. |
| `points_ledger` | **Append-only.** `wallet_id` (`RESTRICT`), `group_id` (rows of one movement), `kind`, `bucket`, signed `amount <> 0`, `reference_type` + `reference_id` (both or neither), `rule_id` (`SET NULL`), `idempotency_key` (unique), `release_at`, `actor_id`, `reason`. | Via wallet. | Kept (financial record). |
| `reward_debts` | A clawed-back reward already spent: `amount`, `remaining` (0..amount), waivable by an admin. | `user_id`; `rewards.adjust`. | Kept. |
| `payout_methods` | Admin data: `key` (unique), names, `field_schema jsonb`, `enabled` (false at seed), `fee_minor`, min / max, notes, `countries`. | Platform; `billing.write`. | Kept. |
| `payout_destinations` | Per user: sealed `value_enc`, `masked`, `destination_hash` (unique across all accounts), `usable_after` (cooldown), `removed_at`. | `user_id`. | Kept (the hash must keep blocking reuse). |
| `withdrawal_requests` | `user_id`, `request_id` (unique per user: idempotency), `destination_id`, `points`, snapshot `amount_minor` + `currency` + `rate_minor_per_point`, `fee_minor`, `status`, approval / payment actors, `transfer_reference` (unique when set; required when paid), `proof_file_id`, `reject_reason`, `flags`. | `user_id`; admin `withdrawals.review/pay`. | Kept. |
| `deals` | `name`, `status`, `starts_at/ends_at`, `terms jsonb` (object; guarded by the strict `dealTermsSchema`), internal `notes`. | Platform; `deals.write`. | Kept. |
| `deal_targets` | `deal_id` (`CASCADE`), `target_kind` (`user|organization|referral_code|email_domain`) with exactly the matching column set (`deal_targets_target_check`), `member_only`. | Platform. | Kept. |
| `organization_join_links` | `org_id` (`CASCADE`), `slug` (unique), `role`, `deal_id` (`SET NULL`), `max_uses` / `used_count`, `expires_at`, `approval` (`auto_approve|requires_approval`), `active`. | Org admin (membership check) or `deals.write`. | Kept. |
| `organization_member_limits` | PK `(org_id, user_id)` with a composite FK to `organization_members` (`CASCADE`): optional monthly credit cap for one member. | Org admin. | Follows the membership. |
| `organization_members` / `organizations` (altered) | + `organization_members.joined_via_link_id` (`SET NULL`), + `organizations.allow_personal_fallback` (default false: members spend only the organization wallet). | As before. | As before. |

**Growth and alerts (0012).**

| Table | Purpose | Owner / access | Retention |
|---|---|---|---|
| `growth_events` | First-party funnel events (20 names, `GROWTH_EVENT_NAMES`): `user_id` (`SET NULL`), `session_id`, `occurred_at`, `props` (object, ≤ 2 KB of JSON text), `variant`. No PHI, no free text. | Platform; `billing.read`. | **13 months**, then deleted by a worker job. |
| `growth_rules` | Lifecycle rules (GROWTH §6): `key` (unique), `kind` (offer kind), `condition jsonb`, template `promotion_id` (`SET NULL`), `validity_hours`, `per_owner_limit`, `active` (false until toggled). | Platform; `promotions.write`. | Kept. |
| `experiments` | `key` (unique), `name`, `flag_key` (the feature flag that buckets users; no FK), `variants jsonb` (2..10, `experimentVariantsSchema`), `status`, `min_sample_size`, `started_at/ended_at`. | Platform; `flags.write`. | Kept. |
| `admin_alerts` | One alert (`kind` from BILLING §10, `severity`, `ref_type` + `ref_id`, `summary` ≤ 500 chars, `link`, `resolved_at`). No proof images, full phone numbers or destinations. | Platform; recipients by permission. | **90 days.** |
| `alert_deliveries` | `alert_id` (`CASCADE`), `admin_user_id` (`CASCADE`), `channel` (`in_app|email|telegram|whatsapp`), `status`, `attempts`; **unique `(alert_id, admin_user_id, channel)`**. | The admin. | With the alert. |
| `admin_alert_prefs` | PK `user_id`: channel switches (WhatsApp off by default), `telegram_chat_id`, `whatsapp_jid`, `muted_kinds`. | The admin. | Kept. |
| `user_notes` | Internal notes on a user (`user_id` `RESTRICT`, `author_id` `SET NULL`, body 1..4000, `pinned`). Never shown to the user. | Platform; `users.read`. | Kept. |
| `phi_access_sessions` | A 30-minute window in which an admin may open one user's health data, with a stated `reason`; every actual view writes an `audit_logs` row (`phi.view`). `admin_user_id`, `user_id` both `RESTRICT`. | Platform; `users.read_health` / `users.read_chats`. | Kept. |
| `campaign_links` | `/c/<slug>`: `slug` (unique), `name`, `target_path` (a path on our own site, `^/([^/].*)?$`: no open redirect), `utm`, `referral_code_id` (`SET NULL`), `active`. | Platform; `referrals.write`. | Kept. |

**Seed (insert-only, `seed-billing.ts`).** Hidden plans `plus` (150 credits), `pro` (500; moved here from `seed-ai.ts`, where it was 300) and `clinic` (2,000, `audience = organization`, `max_members = 5`) with entitlements (all modes; web search only on `pro` and `clinic`) and EGP prices for 1 and 12 months (BILLING §2.2); credit packs `pack_100`, `pack_300`, `pack_1000`; one tax rule (EG, 14% = 1400 bps, `inclusive`, **inactive**); payment methods `kashier_card` (disabled until keys), `instapay` and `vodafone_cash` (enabled, `01014677026`, proof required, fee 0, EGP); referral program `standard` with the REFERRALS §3.3 rules (the referee's 10% first-payment discount is a coupon, not a rule); payout methods `vodafone_cash`, `instapay` (disabled). Children are seeded only in the transaction that creates their parent. Site settings `billing`, `rewards` (`enabled = false`) and `growth` are seeded from the registry defaults.


Phase 4 tables (blog, tickets, ...) are described in ARCHITECTURE.md and enter this file when they are built.

---

## 3. Phase 1 table details

Only what is not obvious from the schema file. Constraint names are stable and asserted by `packages/db/test/identity-schema.int.test.ts`.

### `users`

- **Better Auth columns:** `name`, `email` (citext, unique), `email_verified`, `image`, `two_factor_enabled`, `phone` and `phone_verified` (the phone-number plugin's `phoneNumber` / `phoneNumberVerified`, remapped in the auth config). Checked against `@better-auth/cli generate` v1.7.7 and exercised by a real sign-up / sign-in against these tables.
- **Ours:** `phone_verified_at`, `account_type` (`individual | organization`, default `individual`; onboarding confirms it), `locale` (`ar | en`), `status` (`active | suspended | deleted`), `suspended_reason`, `deleted_at`, `anonymized_at`, `last_login_at`.
- **Phone rules (CHECK-enforced):** `users_phone_format_check` (E.164); `users_phone_verified_sync_check` (`phone_verified` is true exactly when `phone_verified_at` is set, so the plugin's boolean can never disagree with our timestamp); `users_phone_verified_needs_phone_check`.
- **One verified account per phone** (`users_phone_verified_key`, partial unique where `phone_verified_at IS NOT NULL`). Unverified claims may repeat: anyone can type any number; only the WhatsApp proof makes it theirs. Sign-in by phone must look up verified numbers only.
- **Deletion rules:** `users_deleted_sync_check` (`status = 'deleted'` iff `deleted_at` is set) and `users_anonymized_needs_deleted_check`.
- **Ids** come from the database (`advanced.database.generateId: false` in the auth config, Task 1.3).

### `accounts`, `sessions`, `verifications`, `two_factors`

Better Auth's tables with UUIDv7 keys and `timestamptz`. `accounts_provider_account_key` makes a provider identity linkable to one user only. `sessions.token` is unique and never logged; `ip_address` and `user_agent` are PII (shown to the owner in "my sessions"). `verifications.identifier` can embed a token: never log it. `two_factors` has the TOTP brute-force counters (`failed_verification_count`, `locked_until`) Better Auth 1.7 expects. Expired `sessions` and `verifications` rows are purged every 6 hours by the worker job `auth.purge_expired` (Task 1.7). Better Auth 1.7 stores no row for email verification (signed link); reset tokens are `identifier = reset-password:<token>`, `value = <user id>`.

### `organizations`, `organization_members`, `organization_invites`

- Organizations are our own tables, not Better Auth's plugin (Phase 1 decision #1).
- `organization_members` PK is `(org_id, user_id)`; the extra index `organization_members_user_id_idx` serves "my organizations".
- **Service-level invariants** (the DB cannot express them): every organization keeps at least one `org_admin`; invites are single-use (`accepted_at`), expire after 7 days, and the accepting account must own the invited email or phone; a cap on pending invites per organization limits email abuse.
- `organizations.created_by` is `RESTRICT`: users are anonymized, never deleted, so it can never dangle.
- `organization_invites_one_target_check`: exactly one of `email` / `phone`.

### `roles`, `role_permissions`, `user_roles`

- Permission strings are **not a table**: the typed catalog is `PERMISSIONS` in `packages/shared/src/permissions.ts` (with Arabic and English labels). `role_permissions.permission` is only format-checked by the DB; a string no longer in the catalog is ignored by the resolver, so a stale row can only deny.
- System roles (seeded, undeletable): `user`, `support`, `marketing`, `finance`, `admin`, `super_admin`. `user` is implicit for everyone.
- `user_roles.role_key` is `RESTRICT`: deleting a role that is still granted needs an explicit, audited revoke first. The PK starts with `user_id`, so a separate `user_id` index would be redundant; `user_roles_role_key_idx` serves "who holds this role" (protects the last `super_admin`).

### `site_assets`

- Migration `0007_site_assets`. The primary key is the asset `key`, so a re-upload replaces the row (`INSERT … ON CONFLICT DO UPDATE`); there is no history, the audit row `branding.asset_upload` records key, type, size and digest.
- CHECKs (names asserted by `packages/db/test/site-assets-schema.int.test.ts`): `site_assets_key_check`, `site_assets_content_type_check` (`image/png | image/webp | image/svg+xml | image/x-icon`; built locally because `inList()` refuses `/` and `+`), `site_assets_size_check` (`octet_length(data) between 1 and 524288`), `site_assets_sha256_check` (64 lower-case hex).
- The database does not look inside the file: the api verifies magic bytes and SVG content before inserting (SECURITY.md §3.1, note under the register). The public URL stored in `site_settings.branding` carries `?v=<first 12 of sha256>`, which is what lets `GET /assets/:key` be cached for a year.
- Why a table and not R2: two files of at most 512 KB each, edited a handful of times in the life of the site, and the web app needs them before any storage credentials exist. Move them to object storage if a media library is ever added.

### `onboarding_progress`

`current_step` and `completed_steps` are constrained to `ONBOARDING_STEPS`; `data` is a jsonb **object** (`onboarding_progress_data_check`) whose per-step shape is validated by the api before every write; `completed_at` is set exactly when `current_step = 'done'`.

---

## 4. Indexes (everything beyond primary keys)

| Index | Table (columns) | Serves |
|---|---|---|
| `users_email_unique` | `users (email)` citext | Login, uniqueness. |
| `users_phone_verified_key` | `users (phone)` unique, where `phone_verified_at IS NOT NULL` | One verified account per phone. |
| `users_phone_idx` | `users (phone)` where `phone IS NOT NULL` | Phone sign-in lookup before verification state is known. |
| `users_pending_anonymization_idx` | `users (deleted_at)` where deleted and not anonymized | The worker's "due for anonymization" query. |
| `sessions_token_unique` | `sessions (token)` | Cookie lookup on every request. |
| `sessions_user_id_idx` | `sessions (user_id)` | List / revoke a user's sessions; suspend kills them all. |
| `accounts_user_id_idx` | `accounts (user_id)` | A user's linked sign-in methods. |
| `accounts_provider_account_key` | `accounts (provider_id, account_id)` unique | One provider identity, one user. |
| `verifications_identifier_idx` | `verifications (identifier)` | Token lookup. |
| `two_factors_user_id_idx` | `two_factors (user_id)` | 2FA check at sign-in. |
| `organization_members_user_id_idx` | `organization_members (user_id)` | "My organizations", membership checks. |
| `organization_invites_token_hash_key` | `organization_invites (token_hash)` unique | Accept-invite lookup. |
| `organization_invites_org_id_idx` | `organization_invites (org_id)` | An organization's pending invites. |
| `user_roles_role_key_idx` | `user_roles (role_key)` | "Who holds this role". |
| `audit_logs_target_idx`, `audit_logs_actor_created_idx` | `audit_logs` | Audit queries by target and by actor. |
| `error_events_fingerprint_idx`, `error_events_created_at_idx` | `error_events` | Issues grouping and recency. |
| `plans_one_default_idx` | `plans (is_default)` unique, where `is_default` | At most one default plan. |
| `plan_assignments_owner_user_starts_idx`, `plan_assignments_owner_org_starts_idx` | `plan_assignments (owner_*, starts_at)` | The plan an owner is on right now. |
| `credit_wallets_owner_user_key`, `credit_wallets_owner_org_key` | `credit_wallets (owner_user_id)`, `(owner_org_id)` unique | One wallet per owner; wallet lookup under `FOR UPDATE`. |
| `credit_reservations_open_expires_idx` | `credit_reservations (expires_at)` where `status = 'open'` | The sweeper that releases expired reservations. |
| `credit_ledger_idempotency_key_key` | `credit_ledger (idempotency_key)` unique | A retried operation is a no-op. |
| `credit_ledger_wallet_created_idx` | `credit_ledger (wallet_id, created_at)` | A wallet's history and the nightly reconciliation. |
| `ai_task_routes_key` | `ai_task_routes (task, coalesce(plan_id, nil-uuid), mode)` unique (expression) | One route per task, plan and mode; the default plan (null) counts as one value. |
| `ai_usage_created_at_idx`, `ai_usage_owner_user_created_idx`, `ai_usage_owner_org_created_idx` | `ai_usage` | Admin cost views, an owner's usage and quota counting, 13-month pruning. |
| `files_sha256_idx` | `files (sha256)` | Global exact-match cache lookup. |
| `files_owner_user_dhash_idx`, `files_owner_org_dhash_idx` | `files (owner_*, dhash)` | Near-duplicate hint, same owner only. |
| `files_expires_at_idx` | `files (expires_at)` where `status <> 'deleted'` | The retention job. |
| `rx_analyses_owner_user_created_idx`, `rx_analyses_owner_org_created_idx` | `rx_analyses (owner_*, created_at desc)` | An owner's history list. |
| `rx_analyses_cache_idx` | `rx_analyses (input_sha256, skill_version, route_version)` where `status = 'done'` | The global exact-match result cache. |
| `chats_user_updated_idx` | `chats (user_id, updated_at desc)` | The chat list. |
| `chat_messages_chat_created_idx` | `chat_messages (chat_id, created_at)` | Loading a conversation in order. |
| `active_ingredients_normalized_key`, `active_ingredients_normalized_trgm_idx` | `active_ingredients (normalized)` unique + GIN trigram | Exact and fuzzy ingredient match. |
| `drugs_normalized_en_trgm_idx`, `drugs_normalized_ar_trgm_idx` | `drugs (normalized_en)`, `(normalized_ar)` GIN trigram | Fuzzy brand-name match. |
| `drug_aliases_drug_normalized_key`, `drug_aliases_normalized_trgm_idx` | `drug_aliases (drug_id, normalized)` unique; `(normalized)` GIN trigram | One alias per drug; fuzzy alias match. |
| `plan_prices_plan_months_currency_key` | `plan_prices (plan_id, months, currency)` unique | One price per plan, period and currency. |
| `credit_pack_prices_pack_currency_key` | `credit_pack_prices (pack_id, currency)` unique | One price per pack and currency. |
| `orders_number_key` | `orders (number)` unique | Receipt / support lookup by `WSO-…` number. |
| `orders_owner_user_created_idx`, `orders_owner_org_created_idx` | `orders (owner_*, created_at desc)` | An owner's order history. |
| `orders_pending_expires_idx` | `orders (expires_at)` where `status = 'pending_payment'` | The expiry job. |
| `payments_reference_key` | `payments (reference)` unique | The `WSP-XXXX` the customer writes in a transfer. |
| `payments_gateway_provider_ref_key` | `payments (gateway, provider_ref)` unique, where `provider_ref IS NOT NULL` | One provider transaction, one payment. |
| `payments_method_txn_id_key` | `payments (method_key, txn_id)` unique, where `txn_id IS NOT NULL` | A manual transfer id is used once per method. |
| `payments_order_idx`, `payments_review_queue_idx` | `payments (order_id)`; `payments (created_at)` where status in (`awaiting_review`, `awaiting_second_approval`) | An order's attempts; the admin review queue. |
| `payment_events_provider_event_id_key`, `payment_events_payment_received_idx` | `payment_events (provider, event_id)` unique; `(payment_id, received_at)` | Webhook replay shield; a payment's event log. |
| `refunds_provider_ref_key`, `refunds_payment_idx` | `refunds (provider_ref)` unique where set; `(payment_id)` | One gateway refund id once; a payment's refunds. |
| `outbox_idempotency_key_key`, `outbox_pending_idx` | `outbox (idempotency_key)` unique where set; `(available_at)` where `processed_at IS NULL` | An effect is queued once; the drainer. |
| `subscriptions_owner_user_live_key`, `subscriptions_owner_org_live_key` | `subscriptions (owner_user_id)`, `(owner_org_id)` unique where status in (`trialing`, `active`, `grace`) | At most one live subscription per owner. |
| `subscriptions_period_end_idx` | `subscriptions (current_period_end)` where live | Expiry and reminder jobs. |
| `subscription_events_subscription_created_idx` | `subscription_events (subscription_id, created_at)` | A subscription's timeline. |
| `plan_assignments_subscription_idx` | `plan_assignments (subscription_id)` where set | Assignments of a subscription. |
| `personal_offers_owner_expires_idx` | `personal_offers (owner_user_id, expires_at)` | The offers an owner can still use. |
| `taste_grants_owner_user_period_key`, `taste_grants_owner_org_period_key` | `taste_grants (owner_*, feature, period_key)` unique | One taste grant per owner, feature and period. |
| `user_notifications_user_created_idx`, `user_notifications_unread_idx` | `user_notifications (user_id, created_at desc)`; `(user_id)` where `read_at IS NULL` | The bell list and the unread count. |
| `coupons_code_key`, `coupons_batch_idx` | `coupons (code)` unique; `(batch)` where set | Code lookup; batch export / pause. |
| `coupon_redemptions_coupon_order_key`, `coupon_redemptions_coupon_owner_user_idx`, `…_owner_org_idx`, `coupon_redemptions_order_idx` | `coupon_redemptions (coupon_id, order_id)` unique; `(coupon_id, owner_*)`; `(order_id)` | One reservation per coupon and order; the per-owner limit; release on order expiry. |
| `promotions_status_starts_idx` | `promotions (status, starts_at)` | The scheduler (scheduled → active → ended). |
| `referral_codes_code_key`, `referral_codes_user_kind_key`, `referral_codes_owner_user_idx` | `referral_codes (code)` unique; `(owner_user_id)` unique where `kind = 'user'`; `(owner_user_id)` | Code lookup; one personal code per user. |
| `referrals_referee_user_id_key`, `referrals_referrer_user_idx`, `referrals_code_idx`, `referrals_held_idx` | `referrals (referee_user_id)` unique; `(referrer_user_id)`; `(code_id)`; `(created_at)` where `status = 'held'` | First touch wins; a referrer's list; a code's referrals; the fraud queue. |
| `reward_rules_program_event_idx`, `reward_decisions_idempotency_key_key`, `reward_decisions_referral_created_idx`, `reward_decisions_held_idx` | `reward_rules (program_id, event, beneficiary)`; `reward_decisions (idempotency_key)` unique; `(referral_id, created_at)`; `(created_at)` where `held_for_review` | Rule lookup; one decision per event; the fraud queue. |
| `points_wallets_user_id_key`, `points_ledger_idempotency_key_key`, `points_ledger_wallet_created_idx`, `points_ledger_group_idx`, `points_ledger_release_idx` | `points_wallets (user_id)` unique; `points_ledger (idempotency_key)` unique; `(wallet_id, created_at)`; `(group_id)`; `(release_at)` where `reward_pending` | A retried reward is a no-op; a wallet's history and the nightly reconciliation; the hourly release job. |
| `payout_methods_key_key`, `payout_destinations_destination_hash_key`, `payout_destinations_user_idx` | `payout_methods (key)`, `payout_destinations (destination_hash)` unique; `(user_id)` | A destination can be saved on only one account. |
| `withdrawal_requests_user_request_key`, `withdrawal_requests_transfer_reference_key`, `withdrawal_requests_status_created_idx`, `withdrawal_requests_user_created_idx` | `withdrawal_requests (user_id, request_id)` unique; `(transfer_reference)` unique where set; `(status, created_at)`; `(user_id, created_at desc)` | A retried request withdraws once; a transfer reference is used once; the admin queue. |
| `deal_targets_deal_idx`, `deal_targets_user_idx`, `deal_targets_org_idx`, `deal_targets_code_idx`, `deal_targets_domain_idx` | `deal_targets` per target column (partial, where set) | The deal-precedence lookup at quote time. |
| `organization_join_links_slug_key`, `organization_join_links_org_idx` | `organization_join_links (slug)` unique; `(org_id)` | `/join/<slug>`; an organization's links. |
| `growth_events_name_occurred_idx`, `growth_events_occurred_idx`, `growth_events_user_occurred_idx` | `growth_events (name, occurred_at)`; `(occurred_at)`; `(user_id, occurred_at)` where set | Funnels; the 13-month pruning; a user's timeline. |
| `growth_rules_key_key`, `experiments_key_key`, `campaign_links_slug_key` | unique `key` / `slug` | Lookups. |
| `admin_alerts_created_idx`, `admin_alerts_open_idx`, `admin_alerts_ref_idx` | `admin_alerts (created_at desc)`; `(kind, created_at)` where `resolved_at IS NULL`; `(ref_type, ref_id)` where set | The alert list, the open-alert badge, alerts about one payment. |
| `alert_deliveries_alert_admin_channel_key`, `alert_deliveries_admin_inapp_idx`, `alert_deliveries_pending_idx` | `alert_deliveries (alert_id, admin_user_id, channel)` unique; `(admin_user_id, created_at desc)` where in-app; `(created_at)` where pending | A retried fan-out never double-sends; the bell; the delivery worker. |
| `user_notes_user_created_idx`, `phi_access_sessions_admin_user_expires_idx` | `user_notes (user_id, created_at desc)`; `phi_access_sessions (admin_user_id, user_id, expires_at)` | A user's notes; "does this admin have an open window for this user". |

Not added yet, on purpose: a trigram index for admin user search by name/email/phone (Task 1.10, once the volume justifies it).

---

## 5. User deletion and anonymization

`DELETE /me` (Task 1.7) sets `status = 'deleted'`, `deleted_at = now()` and kills every session immediately. After **14 days** a worker job anonymizes the row (so support can restore an account that was deleted by mistake within that window) and sets `anonymized_at`:

- `email` → `deleted-<user id>@anonymized.invalid` (still unique), `name` → a fixed "deleted user" placeholder, `image`, `phone`, `phone_verified_at` (and so `phone_verified`), `suspended_reason` cleared. This frees the phone for another account.
- Deleted outright: the user's `accounts`, `sessions`, `verifications` (matched by the old email), `two_factors`, `user_profiles`, `onboarding_progress`, `user_roles`, `organization_members`.
- Kept: the `users` row itself and its id, so foreign keys from future payments, usage and audit history stay valid. `audit_logs` must never hold PII beyond ids (writers use a field allowlist, SECURITY.md §7).
- A user who is the **last `org_admin`** of an organization with other members cannot be deleted until they hand over admin rights (service rule, `CONFLICT last_org_admin`).
- Also deleted: the person's `contact_messages` (by `user_id`, old email or old phone), every `organization_invites` row addressed to the old email or phone (pending or accepted), and organizations the user was in that are left with no members.
- **Never-verified accounts** (no verified email, no verified phone) are anonymized the same way 7 days after sign-up, with no grace period beyond that (`UNVERIFIED_ACCOUNT_TTL_DAYS`); this frees an address someone squatted.
- Done by the worker job `account.anonymize_due` (hourly, batches of 100, one transaction per user that re-checks the due condition under a row lock, so a restore in between wins); each anonymization writes `audit_logs` `user.anonymize` with `actor_id = null` and `after = {reason}`. The worker connects as `wasfa_api`.
- A deleted account keeps its verified phone until anonymized, which also stops delete-and-re-register farming of the free tier.

---

## 6. Ownership and `scopedRepo`

- Every query on user-owned tables goes through `scopedRepo` (Task 1.6); services never call `db.select` on them directly.
- User-owned (`user_id`): `user_profiles`, `accounts`, `sessions`, `two_factors`, `onboarding_progress`, `user_roles`.
- Organization-owned (`org_id` **and** a membership check): `organizations`, `organization_members`, `organization_invites`.
- Platform data (no owner): `roles`, `role_permissions`, `site_settings`, `site_assets`, `feature_flags`, `audit_logs`, `error_events`, `wa_sessions`, and the Phase 3 catalog and admin tables (`plan_prices`, `credit_packs`, `tax_rules`, `payment_methods`, `payment_gateways`, `payment_gateway_tests`, `promotions`, `coupons`, `referral_programs`, `reward_rules`, `payout_methods`, `deals`, `growth_rules`, `experiments`, `admin_alerts`, `campaign_links`). Reachable only through permission-checked admin routes (public subset of settings excepted).
- The test pattern for "wrong owner" access is created in Task 1.6 and used by every endpoint of Task 1.7.

### Task 3.4 schema additions (migration 0014)

`payments.sender_phone_enc` stores the sender's full Egyptian mobile number sealed with AES-256-GCM; only the review detail decrypts it. `files.purpose` includes `payment_proof`; a partial SHA-256 index supports cross-owner duplicate lookup. `payment_method_account_changes` records old/new account snapshots, requester, reason, ten-minute effective time and pending/applied/canceled state; a partial unique index permits one pending change per method. `admin_alerts.kind` includes three account-change alert kinds. Migration 0014 was generated with Drizzle, hand-edited for the role grants, and is applied by the Testcontainers migration fixture. The DB migration integration test asserts the new CHECK names, partial unique index and encrypted phone column.

### Task 3.5 schema additions (migration 0015)

`subscription_events.type` adds `resumed`. `subscription_events_order_idx` (partial, on `data->>'orderId'`) serves the per-order idempotency of activation, the refund lookup and the backfill. The lifecycle keeps one open `plan_assignments` row per live subscription whose `ends_at` is always the moment access stops (period end, plus `billing.graceDays` for a paid, not-canceled period). Subscription grants use ledger keys `grant:<ownerType>:<ownerId>:<YYYY-MM>:<subscriptionId>:p<periodStartMs>` and trial grants `trial:<subscriptionId>`; their expiries `expiry:<walletId>:<grantKey>`.
