# Phase 2 — The AI Product

> Goal: a user photographs or uploads a prescription (camera, drag-and-drop, file picker, Ctrl+V paste, or "use my phone" from a desktop) and gets an accurate, verifiable, Arabic RTL breakdown in seconds; they can also chat with the AI assistant and its skills. Every call is metered by credits under plan limits. Admins control providers, models, routing, prices, plans, skills, spend caps, and the drug database without a deploy.
> Prerequisites: read `docs/AGENT.md`, `docs/ARCHITECTURE.md` (§5 AI gateway, §6 files, §7.1 credits, §8, §9), `docs/DESIGN-SYSTEM.md`, `docs/SECURITY.md`, `docs/ROADMAP.md`, and the Phase 1 Notes.
> Phase 2 of 4 build phases. **No payments, gateways, coupons, or subscriptions billing in this phase** (Phase 3). Plans and credits exist; admins assign them by hand until Phase 3.

---

## Outcome

- **Capture that never gets in the way.** On `/analyze` a user can drop files anywhere on the page, paste an image with Ctrl+V / ⌘V, pick files, open the rear camera on a phone, or scan a QR code on desktop to shoot with their phone. Up to 4 pages per prescription. Images are rotated, compressed, and quality-checked **in the browser before a single credit is spent**.
- **Accurate, checkable results.** A results table (drug, active ingredient, strength, form, dose, frequency, duration, route) next to the photo. Tapping a row highlights where it was read on the image. Every item carries a confidence badge. Low-confidence items show the raw text read and the best drug-database candidates, and the user can correct them in one tap.
- **Cheap by construction.** Median provider cost **≤ US$0.01 per prescription analysis** and p95 ≤ $0.03, measured in admin. Achieved through a cheap first pass, verification only for doubtful items, exact-duplicate caching, cache-friendly prompts, and deterministic post-processing in code. "No readable result, no charge."
- **`/ai` assistant.** Streaming answers with a collapsible "thinking" panel, "searching the web…" chips with sources, skills (prescription, drug info, lab tests, imaging (educational), dose calculator, interactions), image attachments through the same capture component, history, stop/regenerate, and auto titles.
- **Full admin control (`/admin/ai`).** Providers (encrypted keys, connection test), models (free-text ids, prices, capabilities, OpenRouter price sync), task routes with ordered fallbacks, plans and entitlements, skills on/off, a global daily spend cap with alerts and a kill switch, a side-by-side model playground, eval accuracy per model, and a usage explorer.
- **Drug database** with Arabic/English fuzzy matching and an import wizard (JSON/Excel, column mapping, preview, dry run, rollback by batch).
- A dashboard with credits, quick capture, and recent analyses replaces the "coming soon" cards.
- Docs: `DATABASE.md`, `DESIGN-SYSTEM.md` (AI and capture components), `SECURITY.md` (endpoint register, denial-of-wallet controls) and a new `docs/AI-COST-RUNBOOK.md`.

### Targets (checked in the final checklist)

| Metric | Target |
|---|---|
| Rx drug-name accuracy (eval set, after DB match) | ≥ 95% on printed, ≥ 85% on handwritten; **0 fabricated drugs shown as "high confidence"** |
| Rx field accuracy (strength, frequency, duration) | ≥ 90% printed, ≥ 80% handwritten |
| Rx latency | p50 ≤ 12 s, p95 ≤ 30 s from "Analyze" to the full result |
| Chat first token | p50 ≤ 1.5 s; our own overhead before the provider call ≤ 150 ms |
| Provider cost per rx | median ≤ $0.01, p95 ≤ $0.03 |
| Capture page | Lighthouse mobile Performance ≥ 90, Accessibility 100; HEIC/editor code lazy-loaded |
| Accessibility | Every capture path works by keyboard and screen reader; axe clean at 360 and 1440 px |

---

## Owner prerequisites (start now)

| Item | Needed by | Notes |
|---|---|---|
| **Google AI (Gemini API) key on a billed project** | Task 2.3 | Free-tier data may be used by Google to improve products; medical content must use the **paid tier** only. The app refuses a provider flagged `free_tier` for medical tasks (Decision 9). |
| **OpenRouter account + key + some credit** | Task 2.3 | Fallback provider. Requests set `data_collection: "deny"` and `zdr: true`. |
| **R2 bucket `wasfa-uploads` (private)** + an API token scoped to that bucket only + a CORS rule allowing `PUT` from `https://wasfa.online` | Task 2.5 | Separate from the backups bucket and token. |
| **Drug lists**: the Egyptian (EDA) registered-drug list and the SFDA list as Excel/CSV | Task 2.7 | Imported through the admin wizard. Without them, matching falls back to raw text (still usable, lower accuracy). |
| **Eval set: 60–100 real prescriptions**, about half handwritten, with patient names blacked out, collected with consent, plus the correct reading for each (a pharmacist fills a sheet we provide) | Task 2.10 | This is how we *prove* accuracy and choose the cheapest model that is good enough. Start collecting now; it is the slowest item. |
| **Pharmacist review** of the abbreviation dictionary (e.g. `1×3`, `ق.أ`, `b.i.d`, `PRN`) | Task 2.8 | We draft it; a pharmacist corrects it. |
| **Pricing decisions**: credits per analysis, free monthly grant, credit value | Task 2.4 | Defaults are seeded (below); all are admin-editable later. |

---

## Decisions for this phase (record in ARCHITECTURE.md → Decision log)

1. **Two execution paths.** Prescription analysis runs as a **worker job** (`rx` queue): it survives a closed tab, can retry, and reports progress through Redis pub/sub, which the API relays as SSE (`GET /rx/:id/events`, with a polling fallback). Chat runs **in the API** as a streaming request, because it must stop the moment the user presses stop or leaves.
2. **Gemini is called through `@google/genai` behind our adapter.** Google's docs now favour the Interactions API, and the thinking field names differ between pages (`thinking_level` vs `thinkingBudget`). Task 2.3 begins with a **half-day spike** that pins the SDK version and records the exact request fields (thinking level, thought summaries, media resolution, JSON schema, Google Search) from the SDK typings in the Notes. Nothing outside `packages/ai/src/adapters/gemini.ts` may depend on them.
3. **Default routes (seeded; every value admin-editable; model ids are free text):**

   | Task | Primary | Settings | Fallback |
   |---|---|---|---|
   | `rx_extract` | `gemini-3.8-flash` | JSON schema, temperature 0, thinking `low`, media resolution `high` | same model via OpenRouter, then `gemini-3.6-flash` |
   | `rx_verify` | `gemini-3.8-flash` | thinking `high`, crops at `ultra_high` | `gemini-3.1-pro-preview` (off by default: preview models can disappear) |
   | `chat` | `gemini-3.8-flash` | thinking `low` | `gemini-3.6-flash` |
   | `deep_think` | `gemini-3.8-flash` | thinking `high` | `gemini-3.1-pro-preview` for plans that allow it |
   | `title_gen`, `classify`, `summarize` | `gemini-3.1-flash-lite` | thinking `minimal` | `gemini-3.5-flash-lite` |
   | `web_search` | Gemini Google Search tool | off for the free plan | OpenRouter web plugin |

   Reference prices (USD per 1M tokens, Google pricing page, 2026-10-09; **re-check at seeding**): 3.8 Flash $0.75 in / $3.75 out (thinking billed as output), cached input $0.075; 3.1 Flash-Lite $0.25 / $1.50; 3.1 Pro preview $2 / $12. Gemini 3 bills an image at a fixed token count by `media_resolution` (`high` = 1120 tokens), so **we upload enough pixels for handwriting (long edge 2048 px)** without paying more per image.
4. **Credits.**
   - 1 credit is an internal unit. Its USD value is a setting (`ai.creditValueUsdMicros`, default 10,000 = $0.01).
   - A prescription analysis has a **fixed price per page** (`rx.creditsPerPage`, default 1), so users see the cost before pressing Analyze.
   - Chat is token-metered: `credits = ceil(providerCostUsdMicros × model.creditMultiplier / creditValue)`, minimum 1 per message. The composer shows an estimate.
   - Flow: **reserve** the worst case (max tokens) → **settle** the actual → **release** the rest, all in `credit_ledger`. A provider error releases everything.
   - A result with no readable items is refunded automatically ("no result, no charge").
5. **Wallets** belong to an owner: a user, or an organization. A member acting inside an organization spends the **organization's** wallet when one exists, otherwise their own; the UI always shows which. The balance is `credit_wallets.balance`, updated in the same transaction as each ledger row under `SELECT … FOR UPDATE`. A nightly job reconciles it against `SUM(ledger)` and alerts on drift.
6. **Uploads go straight to R2** (S3 API, `@aws-sdk/client-s3` + presigner) with a presigned **PUT signed for an exact `Content-Length` and `Content-Type`**. R2 has no presigned POST, so the size limit must be part of the signature. Task 2.5's spike verifies R2 rejects a different length. If it does not, `POST /uploads/:id/complete` runs a `HEAD` and deletes oversize objects. Locally and in tests, **MinIO** stands in for R2 (same code, endpoint from env).
7. **Caching.**
   - (a) An **exact SHA-256 of the processed image** + skill version + route version is a global cache: identical bytes produce the identical answer, and no provider call is made.
   - (b) A **perceptual hash (dHash), only within the same owner**, catches re-photographs of the same paper. A near-duplicate is *offered* ("you analysed this 2 h ago — open it?"), never silently reused: a near match across users could show one patient another's prescription.
   - (c) **Prompts are ordered for provider-side caching**: stable system prompt → skill instructions → abbreviation glossary → variable input. On Gemini 3 this crosses the 4,096-token implicit-cache minimum, which cuts that prefix to about 10% of the price.
   - Pricing: an owner's re-upload within 24 h is free; any other cache hit is billed normally (zero provider cost).
8. **Precision comes from code where possible.** The model reads; deterministic code then does the rest:
   - Arabic/English normalization and drug matching (trigram).
   - Dose/frequency/duration normalization (pharmacist-reviewed dictionary in `@wasfa/shared`).
   - Duplicate-ingredient detection, and strength checks against the drug database.
   - Model-written "warnings" are **off by default** (setting `rx.modelWarnings`), and shown only for matched drugs, labelled "تنبيه عام — راجع الصيدلي".
9. **Privacy toward providers.**
   - Providers carry a `dataPolicy` (`paid_no_training | zdr | free_tier`); medical tasks refuse `free_tier`.
   - Patient name and prescriber are read but **stored redacted** (initials only), per ARCHITECTURE §5.7.
   - Logs and `ai_usage` never contain prompt or answer text.
   - Images are deleted from R2 after `uploads.retentionDays` (default 30, admin setting); results stay.
10. **Users never see provider or model names.** They choose a *mode*: "سريع" (fast), "متوازن" (balanced), "عميق" (deep). Routes map modes to models per plan. Admins see everything.
11. **No live AI calls in CI.** Adapters are tested against recorded fixtures (msw). A `fake` provider kind (refused when `NODE_ENV=production`) streams deterministic output for E2E. Real-model accuracy is measured by the eval harness (Task 2.10), run manually or nightly with the Batch API (50% cheaper).

---

## Task 2.0 — Phase 1 close-out gate

**Delegation:** `runner` for the commands; main session for any failing item.

1. Close or explicitly carry over every open Phase 1 checkbox (final checklist; Lighthouse; Rich Results; mail-tester). Each carry-over is written in Phase 1 Notes with its owner.
2. Production deploy of the Phase 1 head is green and `/health/ready` is 200.
3. Fix the doc inconsistency: DATABASE.md §1 says "no money tables yet: Phase 3", but credits ship in Phase 2. Reword it: credits and plans arrive in Phase 2; payments in Phase 3.

Acceptance
- [x] Phase 1 final checklist is ticked or each open item is listed as a named carry-over. *(Listed with owners in `phase1.md` Notes, "Carry-overs at Phase 1 close".)*
- [x] Production deploy of the Phase 1 head is green: `main` Deploy run 38150700561 succeeded, and `https://api.wasfa.online/health/ready` returns 200 (checked 2026-10-11). The DATABASE.md §1 money-row wording is fixed.
- [ ] Work happens on `phase2/<task>` branches from an up-to-date `main`. *(Still open: the working tree is on `phase1/identity`. Phase 2 tasks start from `main` on `phase2/<task>`.)*

---

## Task 2.1 — Data model: plans, credits, AI control, files, prescriptions, chats, drugs

**Delegation:** main session designs and writes `DATABASE.md` §Phase 2 (schema design is never delegated); `builder` writes the Drizzle schema, migration and constraint tests from it.

**Files:** `packages/db/src/schema/{plans,credits,ai,files,rx,chats,drugs,evals}.ts`, migration `0008_ai_product.sql`, value sets in `packages/shared/src/{plans,ai,rx}.ts`, `docs/DATABASE.md`.

Tables (conventions per DATABASE.md §1: UUIDv7, `timestamptz`, text + CHECK from shared tuples, declared FKs):

- **Plans**
  - `plans`: key, name ar/en, audience, `is_default`, monthly credit grant, visibility, sort, badge.
  - `plan_entitlements`: plan × task → allowed, modes allowed, daily/monthly caps, max pages per rx, web search allowed.
  - `plan_assignments`: owner → plan, `starts_at`/`ends_at`, `assigned_by`, reason. Manual in Phase 2; subscriptions replace it in Phase 3.
- **Credits**
  - `credit_wallets`: owner type/id, balance, `updated_at`.
  - `credit_ledger`: append-only. Kinds: `grant, admin_adjust, usage_reserve, usage_settle, release, refund, expiry`. `amount` is a signed integer. Links to `reservation_id`, `ai_usage_id`, `actor_id`, reason. `idempotency_key` is unique.
  - `credit_reservations`: id, wallet, amount, status `open|settled|released|expired`, `expires_at`. A sweeper releases expired ones.
- **AI control**
  - `ai_providers`: kind `gemini|openrouter|openai_compatible|fake`, base URL, encrypted key + key hint, enabled, priority, `data_policy`, `last_test_at/result`.
  - `ai_models`: provider, model id (free text), display name, capabilities (vision, thinking, search, json, bbox), context limit, prices in **USD micros per 1M tokens** (input, cached input, output, per-search), `credit_multiplier` (basis points), enabled, `price_source` (`manual|openrouter_sync`), `price_checked_at`.
  - `ai_task_routes`: task × plan (null = default) × mode → ordered model list (`jsonb` of `{modelId, params}`), version. The version bumps on every change and is stored on each usage row.
  - `ai_usage`: one row per provider call. Task, route version, model, provider, owner, user, input / cached / output / thinking tokens, search count, `cost_usd_micros`, credits charged, latency ms, outcome, `cache_hit`, `request_id`. **No content.**
  - `ai_spend_daily`: date × provider × model aggregate, maintained by the worker.
- **Files**
  - `files`: owner, purpose (`rx_page|chat_image`), R2 key, mime, bytes, width/height, sha256, dhash, status `pending|uploaded|processed|rejected|deleted`, reject reason, `expires_at`.
- **Prescriptions**
  - `rx_analyses`: owner, created by, status `queued|processing|verifying|done|failed|refunded`, mode, credits, skill version, route version, `cache_of` (nullable FK to itself), result `jsonb` (validated by the shared schema), redacted patient/prescriber, timings, `error_ref`.
  - `rx_pages`: analysis → file, order.
  - `rx_corrections`: analysis, item index, field, before, after, user, `consent_for_eval`.
- **Chats**
  - `chats`: owner, title, skill, archived.
  - `chat_messages`: chat, role, content (text, redacted for logs only), parts `jsonb` (text, image file ids, sources), status `streaming|done|stopped|error`, `ai_usage_id`, credits.
  - `chat_summaries`: rolling summary per chat for long histories.
- **Drugs**
  - `active_ingredients`: name en/ar, normalized.
  - `drugs`: brand name en/ar, normalized names, form, strength text + parsed value/unit, manufacturer, country, status.
  - `drug_ingredients`: drug × ingredient × strength.
  - `drug_aliases`: alias, normalized, lang, source.
  - `drug_import_batches`: file name, mapping, counts, status, `committed_by`, `rolled_back_at`.
  - Every drug row carries `import_batch_id`.
  - GIN trigram indexes on all normalized name columns.
- **Evals**
  - `ai_eval_sets`, `ai_eval_items` (file + expected JSON), `ai_eval_runs` (route snapshot, status, metrics `jsonb`, cost), `ai_eval_results` (per item).

Seed (insert-only; Phase 1 rules):
- Plan `free` (default, 30 credits per month, `rx` 3 analyses/day, modes fast + balanced, no web search). This replaces the `free_tier.monthlyAnalyses` setting; keep the key readable for one release, then remove it.
- Plan `pro` (hidden, for manual pilots).
- Default routes (Decision 3).
- Providers seeded **disabled with no key**.
- Model prices from Decision 3.
- New permissions: `ai.read`, `ai.write`, `ai.killswitch`, `plans.read`, `plans.write`, `credits.adjust`, `drugs.read`, `drugs.write`, `evals.run`, `usage.read`.

Acceptance
- [ ] Migration applies on Postgres 18. Integration tests assert every CHECK and FK by name, the append-only ledger (the `wasfa_api` role has no UPDATE/DELETE on `credit_ledger`, like `audit_logs`), and that the idempotency key is unique.
- [ ] `DATABASE.md` documents each table, its owner rules, and retention.

---

## Task 2.2 — Credits, plans, quotas, spend guard (API)

**Delegation:** main session writes the reserve/settle/release state machine and the concurrency rules in the brief; `builder` implements it and writes the tests.

**Files:** `apps/api/src/{credits,plans,quota}/*`, `packages/shared/src/schemas/{credits,plans}.ts`, worker jobs `credits.grant_monthly`, `credits.sweep_reservations`, `credits.reconcile`, `ai.spend_rollup`.

1. `CreditsService.reserve(wallet, amount, {idempotencyKey, purpose})` → reservation, or `QUOTA_EXCEEDED` with reason `insufficient_credits`. Then `settle(reservationId, actual)` and `release(reservationId)`. Each is one transaction with a wallet row lock. It is idempotent by key, so a retried job never double-charges.
2. `QuotaService.check(owner, task, mode)`:
   - plan entitlement → `PAYMENT_REQUIRED` with reason `plan_feature`
   - daily/monthly task caps (Redis counters keyed by owner + UTC day) → `QUOTA_EXCEEDED` with reason `daily_cap`
   - per-user concurrency (one rx in processing and one chat stream; `CONFLICT` with reason `busy`)
3. **Global spend guard** (Redis, per UTC day):
   - Add the *estimated* cost at reserve and correct it at settle.
   - Alert at `ai.alertPercent` (default 80%) through the existing alert channel, once per day.
   - At 100% of `ai.dailyCapUsd`, refuse new AI work with `UPSTREAM_UNAVAILABLE` (reason `ai_paused`) and the friendly Arabic "الخدمة مزدحمة الآن، حاول بعد قليل".
   - Per-task kill switches live in the `ai` setting (admin, audited, reauth).
4. Endpoints:
   - `GET /me/credits`: balance, wallet owner, plan, today's usage vs caps, and a next-grant date.
   - `GET /me/usage?cursor`: credits history without content.
   - Admin endpoints: `POST /admin/credits/adjust` (fresh auth, reason, audited) and plan assignment (audited).
5. Monthly grant job: idempotent per owner per period (ledger idempotency key `grant:<owner>:<YYYY-MM>`). Unused free credits expire at period end (`expiry` row).
6. Settings: register `ai` (admin) as `{dailyCapUsd, alertPercent, killSwitch: {rx, chat, search}, creditValueUsdMicros, allowPreviewModels}` and `rx` as `{creditsPerPage, maxPages, modelWarnings, verifyMaxItems}`. The public part of `rx` (price per page, max pages) is visible.

Acceptance
- [ ] Integration tests: 50 concurrent reserves on a wallet with credits for 10 → exactly 10 succeed, and the balance is never negative. Settle with actual > reserved is capped at the reservation, and the overage is logged as a warning. A crashed job's reservation is released by the sweeper. A retried settle is a no-op.
- [ ] The reconcile job reports zero drift after the concurrency test.
- [ ] Spend guard: a forced cost over the cap refuses the next call with `ai_paused`, and the alert fires once.

---

## Task 2.3 — `packages/ai`: adapters, router, streaming, accounting

**Delegation:** main session does the Gemini spike (Decision 2) and fixes the interfaces; `builder` builds the adapters and the router against recorded fixtures.

**Files:** `packages/ai/src/{types.ts, router.ts, pricing.ts, events.ts, adapters/{gemini,openrouter,openai-compatible,fake}.ts, prompts/*}`, `skills/*/SKILL.md`.

1. Interfaces from ARCHITECTURE §5.3, extended:
   - `NormalizedRequest` gains `{ task, mode, system, messages, images[], jsonSchema?, mediaResolution?, thinking?, search?, maxOutputTokens, temperature? }`.
   - `NormalizedEvent` gains a `{ type: 'bbox' }` field inside structured results (item boxes are part of the rx JSON, not events).
2. Adapters:
   - **Gemini**: thinking level, thought summaries mapped to `thinking` events, thought signatures preserved across chat turns, JSON schema, media resolution, Google Search with sources, usage incl. cached tokens.
   - **OpenRouter**: final-chunk `usage` incl. `cost`, `cached_tokens` and `reasoning_tokens`; `reasoning_details` deltas mapped to `thinking`; provider routing `{data_collection:"deny", zdr:true, allow_fallbacks:true}`; `response_format: json_schema`; web plugin.
   - **OpenAI-compatible**: base URL + key.
   - **Fake**: scripted.
   - All adapters normalize provider errors to `{retryable, code}` and never leak provider text upward.
3. Router:
   - Resolve route (task, plan, mode) and check the model is enabled and has the required capabilities.
   - Try the primary, then the fallbacks **only on retryable errors**: timeout, 429, 5xx, provider down.
   - Circuit breaker per model in Redis: 5 failures in 60 s → skip it for 60 s.
   - Per-attempt timeout. Abort on signal.
   - Emit one `ai_usage` row per attempt, including failed ones (cost 0 unless the provider reports usage).
4. `pricing.ts`: cost from usage × model prices (integer micros, never floats), plus search cost; credits from cost (Decision 4). Unit-tested with table cases.
5. OpenRouter price sync: an admin-triggered job reads `/api/v1/models` (prices are USD-per-token strings → micros per 1M tokens), updates only models with `price_source = openrouter_sync`, and shows a diff before saving.
6. Skills (`skills/<name>/SKILL.md`, frontmatter `name, description, version, tasks, output_schema`):
   - Loaded at build into a typed registry; the content hash is the `skill version`.
   - Six initial skills per ARCHITECTURE §5.6.
   - Each SKILL.md is written in the main session (medical safety wording), reviewed by the owner.
7. Prompt-injection hygiene: user text and image-derived text are wrapped in delimited blocks marked as data. Tools have no side effects. Every structured output is zod-validated with one repair retry (AGENT §5.2).

Acceptance
- [ ] Unit + fixture tests per adapter: text, thinking, search sources, JSON, usage/cost, each error class, abort mid-stream (no further events; usage still recorded).
- [ ] Router tests: fallback order, no fallback on non-retryable (400/schema), circuit breaker opens and closes, kill switch honoured.
- [ ] Pricing tests reproduce the reference prices exactly in micros.

---

## Task 2.4 — Admin AI control center (API + web)

**Delegation:** main session fixes the page list, permissions and audit rules below; `builder` builds the API and pages using the Phase 1 admin patterns (`admin-shell`, settings forms, keyset pagination); `runner` adds the i18n keys.

**Files:** `apps/api/src/admin/ai/*`, `apps/web/src/app/admin/ai/*`, `packages/shared/src/schemas/admin-ai.ts`, `i18n/ar.admin.ts`.

Pages (all `/admin/ai/*`, permission-gated, every write audited, key and kill-switch writes need fresh auth):
1. **Overview**:
   - today's spend vs cap (meter), 7/30-day spend by task and by model (chart per the `dataviz` rules)
   - calls, error rate, fallback rate, cache-hit rate, **average and p95 cost per analysis**, p50/p95 latency
   - the **kill switch** (per task and global) with a typed confirmation
2. **Providers**: add/edit, key shown masked (`••••abcd`) and replaced only, never read back. "Test connection" makes the cheapest possible call and records the latency and result. Data policy flag.
3. **Models**:
   - table with prices, capabilities, multiplier, enabled
   - add by free-text id
   - "Sync prices from OpenRouter" with a diff dialog
   - a warning badge when `price_checked_at` is older than 30 days, or when a model id contains `preview` while `allowPreviewModels` is off
4. **Routes**: task × plan × mode grid. Edit the ordered fallbacks (keyboard-reorderable list), thinking, media resolution, max tokens, temperature, search. The "last eval score" of the primary is shown next to it (Task 2.10). Saving bumps the route version.
5. **Playground**:
   - run one input (image(s) or text) on up to 3 routes side by side
   - shows output, tokens, cost, latency, and validation errors
   - charged to the global spend guard, rate-limited (20/h per admin), audited without content
6. **Plans**: CRUD for plans and entitlements, and assignment of a plan to a user/organization (with end date and reason).
7. **Credits**: adjust a wallet (reason, fresh auth), ledger view per wallet.
8. **Usage explorer**: filters by user/org/task/model/outcome/date, totals, CSV export. Never shows content.
9. **Skills**: list with version, enable per plan.

Acceptance
- [ ] Every route and page has a permission, and the 403 states render. E2E: admin adds a provider (fake), a model and a route, runs the playground, flips the kill switch, and a user's next analysis is refused with the friendly message.
- [ ] API keys never appear in any response, log, or audit row (test greps responses and audit `after`).

---

## Task 2.5 — Uploads: presigned R2, server checks, image pipeline

**Delegation:** main session does the R2 Content-Length spike (Decision 6) and fixes the limits; `builder` implements it.

**Files:** `apps/api/src/files/*`, `apps/worker/src/jobs/image.job.ts`, `packages/shared/src/schemas/files.ts`, compose (`minio` in dev/test), `.env.example` (`R2_UPLOADS_*`).

1. `POST /uploads` `{purpose, mime, bytes, sha256, width, height}`:
   - Validates allowed types: JPEG, PNG, WebP, HEIC/HEIF, PDF (≤ 4 pages).
   - Limits: ≤ 10 MB, plan's max pages, and a rate limit of 30 per 10 min per user.
   - Returns `{fileId, url, headers}` with a 5-minute presigned PUT for `u/<ownerId>/<fileId>/original`.
2. `POST /uploads/:id/complete`: HEAD → size/type must match → status `uploaded` → enqueue `image.process`.
3. Worker `image.process` with sharp:
   - magic-byte check (`file-type`)
   - `limitInputPixels` 40 MP (decompression-bomb guard)
   - auto-orient from EXIF, then **strip all metadata**
   - flatten
   - resize to long edge 2048 px (never upscale)
   - re-encode JPEG q88
   - compute SHA-256 and dHash (64-bit)
   - store `processed`, delete `original`
   - PDF: rasterize ≤ 4 pages at 200 dpi (pdf.js or `pdftoppm` in the worker image; pick the one that keeps the image under the size budget and record it)
   - HEIC: sharp's prebuilt binaries do not decode HEIC (patents), so HEIC is converted **in the browser** (Task 2.6). A HEIC that still reaches the server is rejected with a clear message.
4. Read access: `GET /files/:id/url` → 60 s presigned GET for the owner (or an organization member with access), via `scopedRepo`. Images are never public.
5. Retention job: delete R2 objects past `uploads.retentionDays`, mark files `deleted`; the analysis keeps showing "الصورة حُذفت بعد 30 يومًا".

Acceptance
- [ ] A presigned PUT with a body larger than declared is refused (or deleted by `complete`); tested against MinIO, and once manually against R2 (recorded in Notes).
- [ ] Tests: wrong magic bytes, polyglot file, 20,000 × 20,000 PNG bomb, EXIF GPS removed, rotated phone photo comes out upright, another user's `fileId` → `NOT_FOUND`.

---

## Task 2.6 — Capture experience (`packages/ui` + web)

The flagship interaction. **Delegation:** main session writes the component API and the states table below into DESIGN-SYSTEM.md first; `builder` implements it; the main session reviews it in the browser at 360 px and 1440 px.

**Files:** `packages/ui/src/capture/{CaptureSurface, DropOverlay, PageTray, PageThumb, ImageEditor, QualityHint, PhoneHandoff}.tsx`, `apps/web/src/lib/capture/{normalize-image.ts, quality.ts, heic.ts, upload-queue.ts}`, `apps/api/src/files/handoff.*`.

**One `CaptureSurface` component**, used by `/analyze`, the dashboard quick-capture card, and the `/ai` composer:

| Input | Behaviour |
|---|---|
| **Drag and drop** | Dropping anywhere on the page works. While a file is dragged over the window a calm full-page overlay appears ("أفلت الصورة هنا"); it hides on leave or drop. Non-image files are refused with a toast. |
| **Paste (Ctrl+V / ⌘V)** | The page listens for `paste`. Images in `clipboardData.files` / `items` are added; text paste in inputs is untouched. The hint "أو الصق صورة (Ctrl+V)" shows only on devices with a keyboard. |
| **File picker** | `<input type="file" accept="image/*,application/pdf" multiple>`, styled as the main button "اختر صورة". |
| **Phone camera** | On touch devices a second button "التقط صورة" uses `capture="environment"`. Per MDN this is a *request*: some OSes still offer the gallery, which is fine. Tested on iOS Safari and Android Chrome (Notes). |
| **Desktop → phone** ("استخدم هاتفك") | Shows a QR code (the Phase 1 QR component) for a single-use **handoff token** (5 min, max 4 files, bound to this user and this capture session). The phone opens `/capture/<token>` (no sign-in needed: a capability URL that can only *add pages to this desktop session*). Photos appear live on the desktop (SSE) and are **not analysed until the desktop user presses Analyze**, so a leaked token cannot spend credits. |
| **Keyboard / screen reader** | Everything is reachable by Tab. Pages can be reordered with arrow keys. Every state change is announced in a polite live region in Arabic. |

In-browser processing before upload (`normalize-image.ts`, all in a Worker where supported):
1. Decode with `createImageBitmap(file, {imageOrientation: "from-image"})`. HEIC: Safari decodes it natively; elsewhere **lazy-load** a libheif WASM converter only when a HEIC arrives (never in the main bundle).
2. Resize to long edge 2048 px and encode **JPEG q0.85** (`OffscreenCanvas.convertToBlob`, with a canvas fallback). WebP is not used because Safari's encoder support is uncertain. Typical upload: 300–700 KB instead of 3–6 MB.
3. **Quality check** (`quality.ts`, no network):
   - Resolution: long edge < 1000 px warns.
   - Blur: variance of the Laplacian on a 512 px grayscale copy, below a threshold.
   - Exposure: mean brightness too dark or too bright.
   - The page shows a gentle hint card ("الصورة غير واضحة — جرّب الإضاءة أو قرّب الكاميرا") with **"إعادة الالتقاط"** and **"المتابعة على أي حال"**. No credits are spent before Analyze, so a bad photo costs nothing. Thresholds are tuned on the eval images and stored in Notes.
4. Optional editor (lazy): rotate 90°, crop with handles (keyboard-operable), reset.
5. Upload queue: parallel 2, progress per page, retry with backoff, cancel, survives a flaky connection. SHA-256 is computed in the browser and sent with the request.

Page tray: up to `rx.maxPages` thumbnails, with order numbers, reorder, remove, and edit. The **Analyze** button shows the price ("تحليل — 2 رصيد") and the remaining balance. If credits are short, it becomes "رصيدك غير كافٍ" with the plan info (payments arrive in Phase 3; in Phase 2 it links to support).

States to design (all in DESIGN-SYSTEM.md with screenshots): empty, dragging, uploading, quality warning, ready, insufficient credits, offline, upload error (with ref), and handoff waiting/connected/expired.

Acceptance
- [ ] Playwright: drop a file, paste an image (synthetic `ClipboardEvent`), pick files, handoff flow on two browser contexts, reorder by keyboard, blur warning on a blurred fixture, an 8 MB photo uploads as < 1 MB, HEIC fixture converted (Chromium path).
- [ ] Manual device check on iOS Safari and Android Chrome recorded in Notes (camera opens, orientation correct, paste from the screenshot clipboard on iOS).
- [ ] axe clean, 44 px targets, and all strings via i18n.

---

## Task 2.7 — Drug database and matcher

**Delegation:** main session decides the normalization rules and score thresholds; `builder` implements the matcher, import wizard and tests.

**Files:** `packages/shared/src/normalize.ts` (`normalizeArabic`, `normalizeDrugName`, `parseStrength`), `apps/api/src/drugs/*`, `apps/worker/src/jobs/drug-import.job.ts`, `apps/web/src/app/admin/drugs/*`.

1. Normalization:
   - **Arabic**: remove tashkeel and tatweel; unify أ/إ/آ→ا, ى→ي, ة→ه; Arabic-Indic digits → Western.
   - **English**: lowercase; strip dosage-form words (`tab, tabs, cap, syrup, susp, amp, vial, cream, eye drops, …`) into a separate `form`.
   - Strength parsed into `{value, unit}` with unit normalization (mg, g, mcg, ml, %, IU).
   - Table-driven tests.
2. Matcher `matchDrug(text, {strength?, form?}) → candidates[]`:
   - `pg_trgm` similarity on drug names, aliases and ingredients (both languages).
   - Score = name similarity, with bonuses for a strength match and a form match.
   - Top 5 candidates, with an explanation of the score.
   - Thresholds (initial, tuned on the eval set): **accept ≥ 0.85 with strength consistent**; **verify 0.50–0.85**; **unmatched < 0.50**.
3. Import wizard (admin):
   - Upload JSON/XLSX (parsed in the worker with `exceljs`; ≤ 20 MB).
   - Column mapping with saved presets per source (EDA, SFDA).
   - Preview of 50 rows, then a **dry run** with counts and a diff: new / updated / duplicate / invalid, with reasons.
   - Commit in batches of 1,000 with progress.
   - Every row is tagged with `import_batch_id`, so **rollback** of a batch is possible.
   - Audited.
4. Admin drug browser: search (the same matcher), edit, add alias, merge duplicates (audited).

Acceptance
- [ ] Matcher tests: Arabic/English variants, typos ("Augmentn"), brand vs ingredient, strength disambiguation (Panadol 500 vs Panadol Extra). p95 query < 30 ms on 50,000 drugs (seeded synthetic data).
- [ ] Import of a 20,000-row file: dry run, commit and rollback all work, and are idempotent on re-import.

---

## Task 2.8 — Prescription pipeline (worker)

**Delegation:** main session writes `rx-schema.ts`, the extraction prompt and the step logic; `builder` implements the job, the progress events and the tests.

**Files:** `packages/shared/src/schemas/rx.ts` (versioned), `packages/shared/src/rx-normalize.ts` (abbreviation dictionary), `skills/prescription-analysis/SKILL.md`, `apps/worker/src/jobs/rx.job.ts`, `apps/api/src/rx/*`.

`POST /rx` `{fileIds[], mode}`. Checks, in order:
1. auth, verified account, ownership of the files, and that each file is `processed`
2. quota and kill switch
3. cache lookup (Decision 7)
4. **reserve** `pages × creditsPerPage`

Then it enqueues `rx.analyze` and returns `{id}`. Steps, each published on `rx:<id>` for SSE (Arabic progress text from i18n):
1. **قراءة الروشتة** — `rx_extract`. All pages go in one call, with the JSON schema. Per item: `rawText`, `name`, `strength`, `form`, `dose`, `frequency`, `duration`, `route`, `notes`, `confidence` (0–1), and `box_2d` (normalized 0–1000, page index). Plus `prescriberLegible`, `date`, `unreadableRegions`.
2. **مطابقة الأدوية** — the matcher for each item. Deterministic normalization of dose/frequency/duration via the dictionary (`1×3` → "3 مرات يوميًا", `ق.أ` → "قبل الأكل", `bid` → "مرتين يوميًا"). Each item is flagged when (model confidence < 0.8) or (match score in the verify zone) or (strength conflicts with the drug database).
3. **التحقق من البنود غير الواضحة** — only for flagged items, at most `rx.verifyMaxItems` (default 4):
   - Crop each `box_2d` from the processed image, padded 15%, at `ultra_high`.
   - One `rx_verify` call with all crops, each item's candidate list, and **a constrained answer**: one of the candidates' ids, `"other"` with text, or `"unreadable"`.
4. **تجهيز النتيجة** — merge, then validate with `rx.ts` (one repair retry). Then:
   - Duplicate-ingredient check.
   - Final confidence = min(model, match, verify) → badge `high` (≥ 0.85) / `medium` / `low`.
   - **Never show an unmatched name as high confidence.** An unmatched name is shown with its raw text and "غير مؤكد".
5. **Settle** actual credits. Zero readable items → full **refund** and the status `refunded`, with guidance ("لم نتمكن من قراءة الروشتة — جرّب صورة أوضح").

Timeouts: a 60 s total budget. On failure: retry the step once on another route, then `failed` + release + `error_ref`.

Acceptance
- [ ] Fixture-driven job tests with the fake provider: happy path, verify path, a cache hit with no provider call, refund on empty, failure releases credits, job retry does not double-charge, events in order.
- [ ] Every analysis records route version, skill version, provider cost, and credits.

---

## Task 2.9 — Result experience

**Delegation:** main session writes the layout spec and the design-system entries; `builder` implements it; main session reviews it in the browser.

**Files:** `apps/web/src/app/(app)/(shell)/analyze/{page.tsx, [id]/page.tsx}`, `packages/ui/src/{ImageViewer, ConfidenceBadge, StepProgress, RxTable, CandidatePicker}.tsx`.

- **Progress view**: a calm step list (the four steps above) with the current step's Arabic text, elapsed time, and "you can leave this page; we'll keep the result in your history". It reconnects to SSE on return and falls back to polling. No looping animation beyond the existing Spinner (DESIGN-SYSTEM §motion).
- **Layout**: desktop is split, with the image viewer on the inline-start side and the results on the other; mobile has a collapsible image strip on top and the results below.
- **Image viewer**: zoom/pan (pointer, wheel, pinch, keyboard +/−), page switcher. Hover/tap/focus on a result row draws its `box_2d` as an outlined region and scrolls it into view. Selecting a region selects its row.
- **Results table** (RTL, `tabular-nums`, readable at 360 px as stacked cards):
  - Columns: drug (matched brand + active ingredient in a muted line), strength, form, dose, frequency, duration, route.
  - **ConfidenceBadge**: icon + text, never colour alone.
  - Medium/low rows: an amber inline-start edge and a "راجع" button that opens **CandidatePicker**. It shows the raw text read, the top candidates with ingredient and strength, "none of these" plus a free-text field, and a one-tap correction. Corrections are saved to `rx_corrections` and the row updates immediately.
- **Actions**: copy as formatted text, print (dedicated print stylesheet, A4, RTL), share as text (WhatsApp `wa.me?text=`, contains no image), "أعد التحليل بدقة أعلى" (deep mode, shows its price; only offered when items are low confidence), feedback 👍/👎 with an optional reason.
- **Always visible**: the medical disclaimer (AGENT §5.11), the unreadable-regions note, and the error ref chip on failure.
- **History** (`/analyze/history`): list with search by drug name, filters, a thumbnail only while the image is retained, and deletion (soft, owner).

Acceptance
- [ ] Playwright at 360/1440: row ↔ region highlighting by mouse and keyboard, correction flow, print snapshot, insufficient-credits path, reconnect after a reload mid-analysis.
- [ ] axe clean. The table is announced correctly (header cells, `scope`).

---

## Task 2.10 — Evaluation harness and accuracy loop

**Delegation:** main session defines the metrics; `builder` builds the runner and the admin page.

**Files:** `evals/rx/` (README, label template `.xlsx`, import script), `apps/worker/src/jobs/eval.job.ts`, `apps/web/src/app/admin/ai/evals/*`.

1. Import the owner's labelled set: images to R2 (private, separate prefix) and expected JSON from the template sheet.
2. Run: route snapshot × eval set. Uses the **Batch API** when the provider supports it (50% cheaper, results within 24 h); otherwise sequential runs with a concurrency of 2.
3. Metrics per item and aggregate:
   - drug-name accuracy after matching
   - strength / frequency / duration accuracy
   - **fabrication rate** (a high-confidence item not on the paper)
   - recall (items missed)
   - calibration (accuracy per confidence band)
   - cost and latency
   - All split by printed vs handwritten.
4. Admin page:
   - Runs are listed and compared side by side.
   - The route editor shows the primary model's last score.
   - Promoting a route or prompt change whose score is lower than the current one by more than 1 point asks for a written reason (audited).
5. Accuracy loop: user corrections with `consent_for_eval` (an opt-in checkbox in the correction dialog, off by default) appear in an admin review queue. An admin can anonymize them and add them to the eval set.
6. **Choose the cheapest passing route**: run the eval on 3.1 Flash-Lite, 3.5 Flash-Lite, 3.6 Flash, and 3.8 Flash for `rx_extract`. Keep the cheapest that meets the Targets table. Record the numbers in Notes, and re-tune the confidence thresholds (Tasks 2.7/2.8) from the calibration chart.

Acceptance
- [ ] A full eval run on the owner's set is recorded, with the chosen production route justified by numbers in Notes.
- [ ] The Targets-table accuracy rows are met, or the gap is written in Open questions with the next step.

---

## Task 2.11 — `/ai` assistant

**Delegation:** main session writes the SSE event contract and the context-window policy; `builder` implements the API and UI; main session reviews it in the browser.

**Files:** `apps/api/src/chat/*`, `apps/web/src/app/(app)/(shell)/ai/{page.tsx,[chatId]/page.tsx}`, `packages/ui/src/chat/{Composer, MessageList, Message, ThinkingPanel, SourceChips, SkillChips, ModeToggle, Markdown}.tsx`.

API:
- `POST /ai/chats/:id/messages` → `text/event-stream`. Events mirror `NormalizedEvent`, plus `message_id`, `credits`, and `heartbeat` every 15 s.
- One active stream per user (Redis lock).
- Abort upstream on client disconnect and settle what was used.
- Caddy: `flush_interval -1` on this route. A heartbeat keeps Cloudflare's idle timeout from cutting long thinking.

Context policy:
- System + skill first (cache-friendly).
- The last N turns verbatim, within the plan's context budget.
- Older turns are replaced by a rolling `chat_summaries` entry produced by `summarize` (the cheapest model), refreshed every 10 turns.

Images:
- An attached prescription image suggests the "تحليل روشتة" skill chip.
- Chat image questions use vision on the chat route.
- A full structured analysis always goes through `/analyze` (one source of truth for rx results).

UI (reference `3.png`, adapted to DESIGN-SYSTEM: navy instead of black pills, Plex Arabic, light theme):
- **Empty state**: greeting with the user's name, 3 suggestion cards (analyse a prescription, ask about a drug, explain a lab result), skill chips under the composer.
- **Composer**:
  - grows up to 8 lines
  - attach (+) opens the same CaptureSurface (paste and drop work in the composer too)
  - **mode toggle**: سريع / متوازن / عميق, with locked modes showing the plan badge
  - web-search toggle (plan-gated)
  - send / **stop**
  - credit estimate on hover/focus
  - `Enter` sends, `Shift+Enter` adds a new line, IME-safe for Arabic input
- **Messages**:
  - Markdown via a sanitizer, RTL tables, mixed LTR runs wrapped in `<bdi>`, code blocks LTR.
  - **ThinkingPanel**: collapsed by default, "يفكّر…" while streaming, then "فكّر لمدة 6 ث" with an expand control.
  - **SourceChips**: favicon-less, domain + title, open in a new tab with `rel=noopener noreferrer`.
  - Actions: copy, regenerate, 👍/👎.
  - Medical disclaimer on answers that include medical judgement (the skill sets a flag).
- **History sidebar**: chats grouped by date, search by title, rename, delete, archive. Auto title from `title_gen` after the first answer.
- **Streaming quality**: text appended per frame (not per token), no layout shift, auto-scroll that stops when the user scrolls up (with a "↓ جديد" button), and an announcement for screen readers when the answer completes (not per token).

Acceptance
- [ ] E2E with the fake provider: stream, stop mid-answer (credits settled for the partial), regenerate, thinking panel, sources, image attach via paste, history CRUD, mode locked by plan, `ai_paused` message.
- [ ] Ownership: another user's chat id → `NOT_FOUND` on every chat route.
- [ ] First-token overhead measured (Notes).

---

## Task 2.12 — Dashboard v2

**Delegation:** `builder` from the spec; main session reviews.

Replace `components/dashboard/tool-cards.tsx`:
- **Quick capture** card: a compact CaptureSurface. A drop or paste here goes straight to `/analyze` with the pages attached.
- **Credits** card: balance, plan, today's usage vs caps, next grant date, wallet owner (personal or organization).
- **Recent analyses** (5) and **recent chats** (5), with empty states.
- Tool cards for the six skills, now live (drug info, lab tests, etc. open `/ai` with the skill preselected).
- Layout per reference `1.png`, adapted to DESIGN-SYSTEM (navy-only accents, one `shadow-raised` per screen).

Acceptance
- [ ] Renders at 360/1440, axe clean, no layout shift. Lighthouse Performance ≥ 90 on `/dashboard` (authenticated run, recorded).

---

## Task 2.13 — Security, observability, docs, release

**Delegation:** main session does the threat-model review and the SECURITY.md register; `runner` runs the gates.

1. **SECURITY.md**:
   - Endpoint register rows for every new route (auth, permission, rate limit, quota, body limit, audit).
   - Threat rows: denial-of-wallet (reserve, caps, kill switch, one stream, max tokens, quality gate, cache), upload attacks (Task 2.5 tests), prompt injection via images (instructions written on a prescription are treated as data: test fixture "ignore previous instructions" written on an image), handoff-token abuse, cross-owner cache leakage (Decision 7b).
   - Close §11 "ENCRYPTION_KEY rotation" by adding a key id prefix to encrypted provider keys and a rotation CLI.
2. **Rate limits** (initial, per user unless stated):

   | Route | Limit |
   |---|---|
   | `POST /uploads` | 30/10 min |
   | `POST /rx` | 6/min and the plan's daily cap |
   | `POST /ai/chats/:id/messages` | 20/min |
   | handoff create | 5/10 min |
   | handoff upload | 4 files per token |
   | playground | 20/h per admin |

3. **Observability**:
   - Request id flows API → worker → `ai_usage`.
   - Alerts (existing channel): spend 80% / 100%, provider error rate > 20% over 5 min, circuit breaker open, reconcile drift, eval regression.
   - The admin overview covers the rest.
4. **`docs/AI-COST-RUNBOOK.md`** (beginner-friendly):
   - what each control does
   - how to change a model safely (eval first)
   - what to do when spend spikes (kill switch, lower caps, check abuse in the usage explorer)
   - how to read cost per analysis
   - monthly price check
5. `DESIGN-SYSTEM.md`: capture, result, and chat components with their states. `REUSE-INDEX.md`: every new export. `ARCHITECTURE.md`: §5–§7 updated to what was built; decision log entries for this phase's decisions.
6. Deploy:
   - `.env.prod` gains `R2_UPLOADS_*`. Provider keys are **not** env vars: they are entered in admin, encrypted.
   - The `migrate` service seeds plans, routes, and disabled providers.
   - Smoke test in production with the owner's account: one real analysis and one chat, cost visible in admin.

Acceptance
- [ ] `pnpm lint`, `typecheck`, `test`, E2E, and CI all green; `pnpm audit` gate passes; image sizes recorded (the worker gains sharp, so expect it to grow; record and justify).
- [ ] Production smoke test done and recorded.

---

## Execution order and parallelism

```
2.0 ─► 2.1 ─┬─► 2.2 ─┬─► 2.4 ───────────────┐
            ├─► 2.3 ─┤                       │
            ├─► 2.5 ─┼─► 2.6 ─┐              │
            └─► 2.7 ─┘        ├─► 2.8 ─► 2.9 ├─► 2.12 ─► 2.13
                              │   2.10 ◄─────┤
                              └─► 2.11 ──────┘
```
- After 2.1, tasks 2.2, 2.3, 2.5 and 2.7 can run in parallel (separate builders; commit selectively, never stash: see project memory).
- 2.10 can start as soon as 2.8 works with a real provider. Its results feed the threshold tuning in 2.7/2.8 and the final route choice.

## Phase 2 final checklist

- [ ] All task acceptance boxes ticked.
- [ ] Targets table met (accuracy, latency, cost, Lighthouse, accessibility), with numbers in Notes.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, Playwright E2E and CI green; deployed through the normal pipeline.
- [ ] `DATABASE.md`, `SECURITY.md`, `DESIGN-SYSTEM.md`, `ARCHITECTURE.md`, `REUSE-INDEX.md`, `AI-COST-RUNBOOK.md` up to date.
- [ ] Summary written below with any deviations.

## Notes
_(agent fills in deviations here)_

## Open questions
- **Verify before building (from research, 2026-10-11):**
  - Gemini thinking/media-resolution field names in the pinned SDK (Decision 2).
  - Whether R2 rejects a presigned PUT whose `Content-Length` differs from the signed one (Decision 6).
  - The real `capture` behaviour on current iOS/Android (Task 2.6).
  - Exact current Gemini prices at seeding (Decision 3).
- **Credit price for users** (owner): defaults are 1 credit/page, 30 free credits/month, 1 credit = $0.01. Confirm before Phase 3 sets money prices on top.
- **Retention**: images 30 days by default. Does the owner want shorter (7 days) for privacy positioning? It changes only the setting.
