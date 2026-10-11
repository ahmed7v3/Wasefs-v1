# DATABASE.md — Wasfa AI

> PostgreSQL 18 + Drizzle ORM. The schema lives in `packages/db/src/schema/`, migrations in `packages/db/migrations/`. This file explains the conventions and indexes the code cannot say for itself.
> **Update it in every task that adds or changes a table.** A table that is in the schema but not in the index below is a bug.
> Status: reflects the code after Phase 1 Task 1.11.

---

## 1. Conventions

| Topic | Rule |
|---|---|
| Names | `snake_case` tables (plural) and columns. TypeScript keeps camelCase; `casing: "snake_case"` in both `drizzle.config.ts` and `createDb` maps them. |
| Primary keys | `uuid` with the database default `uuidv7()` (time-sortable, PostgreSQL 18 native). Use `idColumn()` from `schema/columns.ts`. Join tables use a composite primary key instead. |
| Timestamps | `timestamptz`. `created_at` and `updated_at` via `timestamps()`. Drizzle refreshes `updated_at` on ORM updates; **raw SQL updates must set it themselves.** |
| Money | Integer **minor units** (`amount_minor`) plus an ISO 4217 `currency`. Never `numeric` or float. (Credits and plans arrive in Phase 2; payments in Phase 3.) |
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

Migration `0008_ai_product.sql`. Schema files `packages/db/src/schema/{plans,credits,ai,files,rx,chats,drugs,evals}.ts`; value sets in `@wasfa/shared` `plans.ts`, `ai.ts`, `rx.ts`.

**Owner pattern (all owned Phase 2 tables).** Two nullable columns `owner_user_id` (FK `users`, `RESTRICT`) and `owner_org_id` (FK `organizations`, `CASCADE`) with `<table>_owner_check: num_nonnulls(owner_user_id, owner_org_id) = 1`. Two declared FKs instead of a polymorphic `(owner_type, owner_id)`, which could not have an FK. Scoped queries filter on whichever one the actor's context selects (Decision 5). `created_by` / `user_id` = the acting user (`SET NULL`), never the owner.

**Money and credits.** Credits are `integer`. USD amounts are `bigint` **USD micros** (`*_usd_micros`, 1 USD = 1,000,000). Prices are USD micros **per 1M tokens**. Multipliers are basis points (`10000` = ×1). No `numeric`, no float.

| Table | Purpose | Owner / access |
|---|---|---|
| `plans` | `key` (unique, `^[a-z][a-z0-9_]*$`), `name_ar`, `name_en`, `audience` (`PLAN_AUDIENCES`: `individual|organization|any`), `is_default`, `monthly_credits` (≥ 0), `visibility` (`public|hidden`), `sort`, `badge_ar/en`. Partial unique `plans_one_default_idx` on `(is_default) where is_default`. | Platform; `plans.read/write`. |
| `plan_entitlements` | PK `(plan_id, task)`; `task` ∈ `AI_TASKS`; `allowed`, `modes text[]` ⊆ `AI_MODES`, `daily_cap`, `monthly_cap` (null = unlimited, else ≥ 0), `max_pages_per_rx` (1–4), `web_search`. Plan FK `CASCADE`. | Platform. |
| `plan_assignments` | Owner pattern; `plan_id` (`RESTRICT`), `starts_at`, `ends_at` (null = open, `> starts_at`), `assigned_by` (`SET NULL`), `reason`. Index `(owner_user_id, starts_at)`, `(owner_org_id, starts_at)`. No row = default plan. | Owner reads; admin writes (`plans.write`). |
| `credit_wallets` | Owner pattern, unique per owner (`credit_wallets_owner_user_key`, `credit_wallets_owner_org_key`); `balance integer ≥ 0` (`credit_wallets_balance_check`). Updated only in the ledger transaction under `FOR UPDATE`. | Owner. |
| `credit_reservations` | `wallet_id` (`RESTRICT`), `amount > 0`, `settled_amount` (null until settled, `0 ≤ settled ≤ amount`), `status` (`open|settled|released|expired`), `purpose`, `expires_at`. Partial index `(expires_at) where status = 'open'` for the sweeper. | Via wallet. |
| `credit_ledger` | **Append-only.** `wallet_id` (`RESTRICT`), `kind` (`CREDIT_LEDGER_KINDS`: `grant|admin_adjust|usage_reserve|usage_settle|release|refund|expiry`), `amount integer <> 0` (signed), `balance_after ≥ 0`, `reservation_id` (`RESTRICT`), `ai_usage_id` (`SET NULL`), `actor_id` (`SET NULL`), `reason`, `idempotency_key` (unique `credit_ledger_idempotency_key_key`), `created_at` only. `wasfa_api` has `SELECT, INSERT` only (like `audit_logs`). Index `(wallet_id, created_at)`. | Via wallet; admin `credits.adjust`. |
| `ai_providers` | `key` unique, `kind` (`gemini|openrouter|openai_compatible|fake`), `base_url`, `api_key_enc` (`encryptSecret`), `key_hint` (last 4), `enabled` (false at seed), `priority`, `data_policy` (`paid_no_training|zdr|free_tier`), `last_test_at`, `last_test_ok`, `last_test_error`. | Platform; `ai.read/write`. Key never leaves the API. |
| `ai_models` | `provider_id` (`RESTRICT`), `model_id` (free text), unique `(provider_id, model_id)`, `display_name`, `capabilities text[]` ⊆ `AI_CAPABILITIES` (`vision|thinking|search|json|bbox`), `context_tokens`, `price_input/cached_input/output_usd_micros_per_m` ≥ 0, `price_search_usd_micros` (per call), `credit_multiplier_bp` (> 0, default 10000), `enabled`, `price_source` (`manual|openrouter_sync`), `price_checked_at`. | Platform. |
| `ai_task_routes` | `task`, `plan_id` (null = default, `CASCADE`), `mode`; unique `ai_task_routes_key` on `(task, coalesce(plan_id, nil-uuid), mode)` (expression index); `models jsonb` = ordered `[{modelId, params}]` (validated by the shared zod schema; CHECK `jsonb_typeof = 'array'` and non-empty); `version integer ≥ 1`, bumped on every write. | Platform. |
| `ai_usage` | One row per provider call. `task`, `route_version`, `model_id` / `provider_id` (`SET NULL`, plus `model_key` text snapshot), owner pattern (both nullable here for system calls: CHECK `≤ 1`), `user_id` (`SET NULL`), tokens `input/cached/output/thinking ≥ 0`, `search_count`, `cost_usd_micros bigint ≥ 0`, `credits_charged ≥ 0`, `latency_ms`, `outcome` (`AI_OUTCOMES`: `ok|error|timeout|cancelled|refused|cache_hit`), `cache_hit`, `request_id`. **No content columns.** Indexes `(created_at)`, `(owner_user_id, created_at)`, `(owner_org_id, created_at)`. | Owner (own usage); `usage.read`. Retention 13 months. |
| `ai_spend_daily` | PK `(day, provider_id, model_id)`; `calls`, tokens, `cost_usd_micros`. Worker upsert. | Platform; `usage.read`. |
| `files` | Owner pattern, `created_by`, `purpose` (`rx_page|chat_image`), `r2_key` unique, `mime` (`FILE_MIMES`), `bytes` (1 B–15 MB), `width/height`, `sha256` (hex 64), `dhash` (hex 16), `status` (`pending|uploaded|processed|rejected|deleted`), `reject_reason`, `expires_at`. Indexes `(sha256)`, `(owner_user_id, dhash)`, `(owner_org_id, dhash)`, partial `(expires_at) where status <> 'deleted'`. | Owner. Objects deleted after `uploads.retentionDays`; row kept as `deleted`. |
| `rx_analyses` | Owner pattern, `created_by`, `status` (`queued|processing|verifying|done|failed|refunded`), `mode`, `credits_charged`, `reservation_id` (`SET NULL`), `skill_version`, `route_version`, `input_sha256`, `cache_of` (self FK, `SET NULL`), `result jsonb` (shared `rxResultSchema`), `patient_initials`, `prescriber_initials` (≤ 8 chars: redacted only), `queued_at/started_at/finished_at`, `error_ref`. Index `(owner_*, created_at desc)`, `(input_sha256, skill_version, route_version) where status = 'done'` for the global exact cache. | Owner. |
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

**Retention.** `files` objects: `uploads.retentionDays` (default 30), row kept with `status = 'deleted'`. `rx_analyses`, `chats`: until the owner deletes them or the account is anonymized (§5: user-owned rows are hard-deleted; org-owned rows stay with the org). `ai_usage`: 13 months, then rolled into `ai_spend_daily`. `credit_ledger`: forever (financial record). `rx_corrections` with `consent_for_eval = false`: deleted with the analysis.

**Seed (insert-only).** Plans `free` (default, 30 credits, `rx` 3/day, modes `fast,balanced`, no web search) and `pro` (hidden); providers `gemini`, `openrouter` disabled with no key; models and default routes from phase2.md Decision 3; permissions `ai.read, ai.write, ai.killswitch, plans.read, plans.write, credits.adjust, drugs.read, drugs.write, evals.run, usage.read`.

Phase 3-4 tables (payments, blog, tickets, ...) are described in ARCHITECTURE.md and enter this file when they are built.

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
- Platform data (no owner): `roles`, `role_permissions`, `site_settings`, `site_assets`, `feature_flags`, `audit_logs`, `error_events`, `wa_sessions`. Reachable only through permission-checked admin routes (public subset of settings excepted).
- The test pattern for "wrong owner" access is created in Task 1.6 and used by every endpoint of Task 1.7.
