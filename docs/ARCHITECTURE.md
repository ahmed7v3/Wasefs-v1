# ARCHITECTURE.md — Wasfa AI

> System design for wasfa.online. Read `AGENT.md` first.

---

## 1. High-level picture

```
                         ┌──────────────────────────────────────────┐
  Browser / Mobile app   │              Cloudflare (free)           │
  ───────────────────►   │ DNS · WAF · DDoS · Bot fight · Turnstile │
                         │ Cache for static + ISR pages · Rate rules│
                         └───────────────┬──────────────────────────┘
                                         │ only Cloudflare IPs allowed
                         ┌───────────────▼──────────────────────────┐
                         │  Server (Docker Compose)                  │
                         │                                           │
                         │  caddy :443  ──►  web  (Next.js :3000)    │
                         │      │                                    │
                         │      └──────►  api  (NestJS :4000)        │
                         │                  │   │   │                │
                         │        ┌─────────┘   │   └────────┐       │
                         │        ▼             ▼            ▼       │
                         │   postgres:5432   redis:6379    worker    │
                         │   (internal only) (internal)   (BullMQ)   │
                         └──────────┬────────────────────────┬───────┘
                                    │                        │
              ┌─────────────────────┼────────────────────────┼───────────────────┐
              ▼                     ▼                        ▼                   ▼
     Cloudflare R2 (private)   AI providers            Payment gateways     Messaging
     prescriptions, backups    Gemini, OpenRouter,     Kashier, manual,     Email, Web Push,
                               OpenAI-compatible…      (Stripe later)       WhatsApp (verify)
```

**Hostnames**
- `wasfa.online` / `www.wasfa.online` → `web`
- `api.wasfa.online` → `api` (REST + SSE streaming)
- Admin UI lives in `web` under `/admin`, but every admin action is authorized by `api`.

Only ports **80/443** are exposed publicly, and only to Cloudflare IP ranges. Postgres and Redis are on an internal Docker network with no published ports.

---

## 2. Services

| Service | Responsibility | Scaling path |
|---|---|---|
| `web` | SSR/ISR pages, SEO, UI. Holds **no secrets** except public keys (Turnstile site key, pixel IDs). | More replicas, or move to Cloudflare (OpenNext) later. |
| `api` | Auth, business logic, permissions, AI orchestration + streaming, payments, webhooks. Stateless. | Horizontal replicas behind Caddy. |
| `worker` | Image re-encode, AI batch jobs, email and push sends, subscription expiry & renewal reminders, campaign sends, drug imports, account anonymization, sitemap rebuilds. (Backups run on the host, not here: decision #12.) | More workers; separate queues per job type. |
| `wa-bridge` | Phase 1. A long-running Baileys (WhatsApp linked-device) client in the worker image: **receives** messages to verify phone numbers, replies at most once per verification, never starts a conversation. `internal` network + outbound internet, no ports. | Exactly one replica by design (one linked session). Replaceable by the Meta Cloud API behind the `PhoneVerifier` interface. |
| `postgres` | Source of truth. | Bigger instance → managed Postgres / read replica. |
| `redis` | Rate limits, sessions cache, queues, settings cache, idempotency keys, SSE coordination. | Bigger instance → managed Redis. |
| `caddy` | TLS (Cloudflare Origin cert), security headers, request size limits, routing. | — |

---

## 3. Authentication & identity

**Library:** Better Auth, mounted inside `api` (`/auth/*`).

**Sign-in methods**
- Google. Facebook ships as **"coming soon"** (a visible, disabled button; enabling it later = add keys to env and flip its status in settings, no code change). Apple is deferred to the mobile app (iOS requires it).
- Email + password (Argon2id hashing)
- Phone + password, the phone verified by an **inbound WhatsApp message** ("reverse OTP", below); SMS or the Meta Cloud API can replace the verifier later behind the same interface

Better Auth handles **authentication only** (core + phone-number + two-factor + haveibeenpwned). Organizations, roles and permissions are our own tables (§4, decision #14).

**Sessions**
- Web: DB-backed session, **httpOnly, Secure, SameSite=Lax** cookie scoped to `.wasfa.online`. Revocable instantly (admin "suspend" kills all sessions).
- Mobile (later): bearer access token (short-lived) + rotating refresh token.
- Admins: **mandatory 2FA (TOTP)**, shorter session lifetime, re-auth for dangerous actions (refunds, role changes, key edits).

**Hardening**
- Turnstile on register, login after N failures, password reset, OTP request.
- Rate limits per IP + per identifier; progressive delays; lockout notifications.
- **Phone verification by inbound WhatsApp ("reverse OTP"):** the user taps a `wa.me` link that opens WhatsApp with a pre-filled message containing a 6-digit code and presses send; the bridge receives it and checks that the **sender's number equals the phone being verified**. WhatsApp itself proves the sender owns the number, so the code is only a correlation token. 10-minute TTL, single use, constant-time compare, max 3 starts/hour per user, per phone and per IP, wrong-sender messages ignored and counted. Our number never starts a conversation (anti-ban rules and the kill switch are in SECURITY.md §8).
- Disposable-email blocklist (bundled list + admin-extendable); one free-tier account per verified phone (anti-farming, enforced by a partial unique index).
- CSRF: SameSite cookies + Origin/Referer check on state-changing routes.

**Onboarding (required before using tools)**
`account_type` (individual | organization) → phone/WhatsApp (if missing) → name → organization details (name, type: pharmacy/clinic/hospital/other, country, city) → profession & usage intent (for marketing segmentation) → plan picker (or stay free) → open Facebook page in new tab (optional) → dashboard.
Progress is saved per step; the user can resume.

---

## 4. Authorization (RBAC)

- **Platform roles** (global, in the DB): `user` (implicit for everyone), `support`, `marketing`, `finance`, `admin`, `super_admin`; `super_admin` can create custom roles. **Organization roles** are a separate, per-organization concept stored on the membership: `org_admin` and `org_member`.
- **Permissions** are fine-grained strings (`users.read`, `users.suspend`, `plans.write`, `ai.providers.write`, `payments.refund`, `tracking.write`, …) listed in a **typed catalog in code** (`packages/shared/src/permissions.ts`, with Arabic/English labels), not in a table. Roles map to permission sets in the DB; each phase adds the permissions of its own features to the catalog. `super_admin` is a wildcard. Grant rules (no self-escalation, last `super_admin`) are in SECURITY.md §5.
- Enforced by a Nest `@RequirePermission()` guard. The web UI hides what you can't do, but **the API is the authority**.
- Every admin write is recorded in `audit_logs` (actor, action, target, before/after diff, IP, user agent).
- "Act as user" (support viewing a user's account) is **read-only by default**, time-boxed, and audited.

---

## 5. AI gateway (`packages/ai`)

### 5.1 Goals
Any provider, any model, full admin control, consistent streaming, accurate structured output, minimal cost.

### 5.2 Data model (summary — details in DATABASE.md)
- `ai_providers` — id, kind (`gemini` | `openrouter` | `openai_compatible` | `anthropic` | …), baseUrl, encrypted apiKey, enabled, priority.
- `ai_models` — providerId, modelId (free-text, admin can type any model name), displayName, capabilities (vision, thinking, search, json), context limits, **cost per 1M input/output tokens**, **credit price multiplier**, enabled.
- `ai_task_routes` — task (`chat`, `rx_extract`, `rx_verify`, `deep_think`, `lab_analysis`, `imaging_edu`, `web_search`, `title_gen`) × plan → primary model + ordered fallbacks + thinking level + max tokens.
- `plan_ai_entitlements` — which tasks/thinking levels each plan can use, daily/monthly caps.

### 5.3 Adapter interface
```ts
interface AIProviderAdapter {
  stream(req: NormalizedRequest, signal: AbortSignal): AsyncIterable<NormalizedEvent>;
  countTokens?(req: NormalizedRequest): Promise<number>;
}

type NormalizedEvent =
  | { type: 'thinking'; text: string }          // thought summaries (when model supports it)
  | { type: 'text'; text: string }
  | { type: 'search'; query: string; sources?: { title: string; url: string }[] }
  | { type: 'tool'; name: string; status: 'start' | 'end' }
  | { type: 'usage'; inputTokens: number; outputTokens: number; thinkingTokens?: number }
  | { type: 'error'; code: string }
  | { type: 'done' };
```
Adapters: `GeminiAdapter` (thinking config + thought signatures preserved across turns, Google Search grounding, structured output via response schema), `OpenRouterAdapter`, `OpenAICompatibleAdapter` (covers DeepSeek, NVIDIA NIM, Groq, OpenAI, etc.). New providers = new adapter + admin row.

### 5.4 Router behavior
1. Resolve route by (task, user's plan, requested thinking level).
2. Check entitlement + quota → **reserve credits** (estimate from input tokens + max output).
3. Call primary; on provider error/timeout → next fallback (same capability class only).
4. Normalize stream → SSE to client.
5. On `usage` → settle actual credits, release remainder, write `ai_usage` row (provider cost in USD micro-units + credits charged).
6. Client disconnect → abort upstream call, settle what was used.

### 5.5 Streaming to the client
- `POST /ai/chats/:id/messages` returns `text/event-stream`.
- Events mirror `NormalizedEvent`; the UI shows a collapsible "thinking" panel, a "searching the web…" chip with sources, then the streamed answer (Markdown + tables, RTL-aware).
- Heartbeat every 15s; max stream duration per plan; one active stream per user (configurable).

### 5.6 Skills
- Stored in `/skills/<skill-name>/SKILL.md` (agentskills.io format: frontmatter `name`, `description`, then instructions + output schema reference).
- Initial skills: `prescription-analysis`, `drug-info`, `lab-test-interpretation`, `imaging-educational`, `dose-calculator`, `drug-interaction-check`.
- A cheap classifier step (or user-chosen tool chip) picks the skill; only that skill's instructions are injected → smaller prompts, lower cost.
- Admin can enable/disable skills per plan.

### 5.7 Prescription pipeline (accuracy-first)
```
upload (browser-compressed) → R2 private
   → worker: validate magic bytes, re-encode with sharp (strip EXIF/payloads),
             auto-orient, deskew/crop, resize to model-optimal size, grayscale if helpful
   → rx_extract  (vision model, strict JSON schema, temperature 0)
   → drug matcher (Postgres pg_trgm + unaccent over drugs/brands/aliases, AR+EN)
   → rx_verify   (only for items with low match/confidence; focused crop + candidate list)
   → validated JSON (zod) → stored → rendered as RTL table + notes + confidence badges
```
- Cache key = perceptual hash of processed image + skill version → identical re-uploads cost zero.
- Output schema (fixed, versioned in `packages/shared/schemas/rx.ts`): patient (optional, redacted in storage), prescriber (optional), date, items[] { rawText, matchedDrugId?, name, activeIngredient?, strength, form, dose, frequency, duration, route, notes, confidence }, warnings[], unreadableRegions[].
- Accuracy is measured on a growing labeled test set (`/evals/rx`) on every prompt or model change; the admin sees accuracy per model.

### 5.8 Drug database
- Tables: `drugs` (canonical), `drug_brands`, `drug_ingredients`, `drug_aliases` (spelling variants, Arabic/English), `drug_sources` (provenance per record).
- Sources: SFDA registered-drug lists (imported via offline script, not live scraping), open datasets, and **admin uploads (JSON / Excel)** with preview, column mapping, duplicate detection, and dry-run before commit.
- Imports run in the worker in batches; indexes: GIN trigram on names/aliases.
- Powers both matching accuracy and programmatic SEO drug pages (later phase).

---

## 6. Files & uploads

- Browser compresses (max ~1600px, WebP/JPEG) → requests a **presigned PUT** URL from `api` (size + MIME declared, checked against plan limits) → uploads **directly to R2** → notifies `api` → worker processes.
- Files never land on the server's disk; processing happens in memory with strict size caps.
- Allowed types: JPEG, PNG, WebP, HEIC (converted), PDF (page-limited). Magic-byte validation; anything else rejected.
- Read access via short-lived presigned GET URLs, only for the owner (or org members with permission).
- R2 lifecycle rule deletes originals after N days (admin setting); derived results are kept per policy.
- Public/blog images → ImgBB (or R2 public bucket), never medical content.

---

## 7. Billing, subscriptions & credits

### 7.1 Model
- `plans` (admin-defined: name, audience individual/org, interval week/month/6mo/year/custom, features JSON, limits JSON, AI entitlements, visibility, sort, badge like "most popular").
- `plan_prices` (plan × country/currency → amountMinor). Currency chosen from geo (Cloudflare `CF-IPCountry`) with manual switcher: EGP, SAR, AED, USD, + admin-addable.
- `subscriptions` (user or org, plan, status, period start/end, auto-renew, gateway refs).
- `credit_ledger` (append-only: grant, purchase, usage_reserve, usage_settle, release, referral_reward, admin_adjust, expiry).
- `coupons`, `campaigns`, `discounts` (percent/fixed, plan-scoped, first-time only, date range, usage caps, per-user caps).
- `org_custom_terms` for enterprise deals (custom limits/models/prices per organization).

### 7.2 Payment gateway layer
```ts
interface PaymentGateway {
  createCheckout(input: CheckoutInput): Promise<{ redirectUrl: string; ref: string }>;
  verifyWebhook(raw: Buffer, headers: Headers): Promise<GatewayEvent>; // signature check
  refund?(ref: string, amountMinor: number): Promise<void>;
}
```
- **Kashier** (cards, wallets incl. Vodafone Cash where supported), **Manual** (user uploads transfer proof / contacts WhatsApp → admin approves), **Stripe** later.
- Admin can enable/disable each gateway and edit keys (encrypted).
- Flow: server computes final price (plan + country + coupon) → creates `payment_intents` row → redirect to hosted checkout → **webhook** (verified, idempotent) activates subscription and grants credits → user returns to a success page that polls status (never trusts the return URL alone).

### 7.3 Lifecycle jobs (worker, scheduled)
- Expire subscriptions at period end → downgrade to free automatically.
- Renewal reminders (7d / 3d / 1d), win-back offers to expired non-renewers (configurable coupon).
- Credit expiry per plan rules.

---

## 8. Security architecture (summary — full checklist in SECURITY.md)

| Threat | Controls |
|---|---|
| DDoS / floods | Cloudflare proxy + WAF rules + rate limiting rules; origin accepts only Cloudflare IPs; Caddy request limits. |
| Credential stuffing / brute force | Turnstile, per-IP + per-account rate limits, Argon2id, lockout + alerts, 2FA for admins. |
| **Denial-of-wallet (AI cost)** | Credit reservation before every call, per-user/plan daily caps, global daily spend cap with kill switch + alert, max tokens per route, one stream per user, upload size/page caps, result caching, phone-verified free tier. |
| Free-tier abuse / multi-accounting | Phone verification, device/IP heuristics, disposable email block, free quota tied to verified phone. |
| Payment fraud | Server-side pricing, signed + idempotent webhooks, amount/currency re-check against intent, no client-trusted success. |
| IDOR / data mixing between users | Scoped repositories, ownership checks in services, integration tests for wrong-owner access on every endpoint. |
| Injection (SQL/XSS/SSRF) | Drizzle parameterized queries only, strict CSP with nonces, Markdown rendered via sanitizer, no user-controlled outbound URLs (allowlist for AI/payment hosts). |
| Malicious uploads | Direct-to-R2, magic-byte checks, re-encode with sharp, size/pixel limits (decompression-bomb guard), no server disk writes. |
| Prompt injection via images/text | System prompts isolate user content; tools have no destructive powers; outputs validated by schema; no secrets in prompts. |
| Secret leakage | Env validation, encrypted keys in DB, log redaction, gitleaks in CI, least-privilege R2/API tokens. |
| Supply chain | Lockfile, `pnpm audit`, Dependabot, Trivy image scan, pinned base images, non-root containers, read-only filesystems where possible. |

Security headers (Caddy + Next.js): HSTS (preload), CSP (nonce-based), `X-Content-Type-Options`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, `frame-ancestors 'none'` (except where embedding is needed).

---

## 9. Errors & observability

- **Reference codes:** global exception filter generates `WSF-XXXX-XXXX`, stores an `error_events` row (route, user, request id, error class, redacted context, provider/gateway response, stack) and returns `{ code, ref, message_ar }`.
- **Admin "Issues" page:** grouped by fingerprint, count, first/last seen, affected users, status (new/investigating/resolved), human-readable explanation + likely cause hint per error code.
- Logs: pino JSON → Docker log rotation; request id propagated web → api → worker.
- Health: `/health/live`, `/health/ready` (db, redis); external uptime monitor.
- Alerts (email/Telegram to admin): error spikes, AI spend threshold, payment webhook failures, backup failure.

---

## 10. Marketing, tracking & growth (summary)

- **Tracking manager (admin):** Meta Pixel, Google Analytics 4 / Google Ads tag, TikTok Pixel, Snap, custom scripts — on/off per pixel, loaded through a single consent-aware loader.
- **Server-side events:** Meta Conversions API, GA4 Measurement Protocol, TikTok Events API for `CompleteRegistration`, `StartTrial`, `Purchase`, `Subscribe` (deduplicated with client `event_id`).
- **Campaign links:** `/c/<slug>` → records click (UTM, referrer, country, device) → sets first-touch + last-touch attribution cookie → funnel stats: clicks → signups → paid → revenue.
- **Referrals:** user invite codes (credit reward on friend's verified signup / first payment); **doctor/partner program** with % commission or fixed balance per paid subscriber; payouts tracked; admin sees full tree (who invited whom, who paid).
- **Coupons & campaigns:** see §7.1. Psychological pricing features (anchoring, "most popular", annual savings, limited-time banners, social proof counters) are admin-configurable components.
- **Ad slots:** named placements on public pages and dashboard, admin-controlled (show/hide, creative, link, schedule, targeting by country/plan). Later phase.

---

## 11. Content & SEO platform (summary — details in SEO-GEO.md)

- Public pages SSR/ISR, cached at Cloudflare; per-page metadata, canonical, hreflang-ready, JSON-LD (Organization, WebSite, SoftwareApplication, FAQPage, Article, MedicalWebPage, BreadcrumbList).
- Blog: categories, tags, authors with credentials (E-E-A-T), medical reviewer field, scheduled publishing.
- **Blog publishing API:** `POST /blog/api/posts` with scoped API keys (admin-issued, HMAC-signed requests, rate-limited) for automated publishing including image upload.
- `sitemap.xml` (split by type), `robots.txt`, `llms.txt` for AI crawlers, RSS.
- Local SEO: country/city landing pages from admin-managed data.

---

## 12. Support (no live chat)

- Floating contact hub: WhatsApp, Telegram, phone call (numbers from admin settings).
- **Tickets:** user creates ticket (category, message, optional attachment, optional error ref code) → admin inbox (assign, status, internal notes, canned replies) → reply triggers **Web Push** + email (and in-app notification; mobile push via FCM later).
- Contact page form → same inbox (Turnstile-protected).

---

## 13. Settings & feature flags

- `site_settings` (key → JSON value, typed by zod) cached in Redis, invalidated on admin write: branding, contact numbers, socials, default currency, legal texts version, maintenance mode, signup open/closed, free-tier limits, etc.
- `feature_flags` with targeting (all / plan / org / user / percentage).

---

## 14. Environments & deployment

| Env | Where | Notes |
|---|---|---|
| `local` | Developer machine, `docker compose -f compose.dev.yml` | Hot reload, seeded data, fake gateways. |
| `production` | Server, `docker compose -f compose.prod.yml` | Images from GHCR, pinned by git SHA. |

Deploy: push to `main` → CI (lint, typecheck, test, build, scan) → push images `ghcr.io/<owner>/wasfa-{web,api,worker}:<sha>` → SSH deploy step pulls + runs migrations (one-off container) + `docker compose up -d` → health check → automatic rollback to previous SHA on failure.

Backups: nightly `pg_dump` (compressed, encrypted) → R2, 14 daily + 8 weekly retention; monthly restore test.

---

## 15. Decision log

| # | Date | Decision | Reason |
|---|---|---|---|
| 1 | 2026-10-09 | NestJS + TypeScript backend | One language across web/api/mobile; shared schemas; structured security guards. |
| 2 | 2026-10-09 | PostgreSQL + Drizzle, Redis | Relational integrity for money/credits; Redis for limits, queues, cache. |
| 3 | 2026-10-09 | Medical files on private Cloudflare R2 | Privacy law compliance (EG 151/2020, KSA/UAE PDPL), no public URLs, no server disk. |
| 4 | 2026-10-09 | All services on one server via Docker Compose, Cloudflare in front | Simple, strong, cheap start; vertical then horizontal scaling. Frontend may move to Cloudflare later. |
| 5 | 2026-10-09 | Provider-agnostic AI gateway (Gemini + OpenRouter at launch) | Full admin control, failover, cost routing. |
| 6 | 2026-10-09 | Pluggable payments, Kashier first | Stripe unavailable to Egypt-only merchants; add later if a foreign entity exists. |
| 7 | 2026-10-09 | No RxNorm, no Chatwoot, no live chat | Owner decision. Own drug DB; ticket-based support. |
| 8 | 2026-10-09 | Data-retention consent via privacy policy text | Owner decision. Retained data is anonymized before storage. |
| 9 | 2026-10-09 | Brand: navy `#1E3A8A` + soft blue `#60A5FA`, Alexandria + IBM Plex Sans Arabic (typeface superseded by #26) | Trustworthy, calm, distinctive. |
| 10 | 2026-10-10 | Next.js 16 (`proxy.ts`), per-request CSP nonce, pages rendered per request | Strict CSP without `unsafe-inline`; trade-off: HTML is not CDN-cacheable (revisit hash-based CSP for SEO pages). |
| 11 | 2026-10-10 | One Redis instance with `noeviction`; a second `redis-cache` (LRU) when a real cache arrives | Queues must never be evicted; every non-queue key must carry a TTL. |
| 12 | 2026-10-10 | Backups: host systemd timer + `backup` container (pg_dump, age, R2), not a worker job | Must work and alert even if worker/API are broken; only the public key lives on the server. |
| 13 | 2026-10-10 | Fastify overridden to 5.12.5 over Nest's pinned 5.11.3 | Four high-severity advisories fixed in 5.12.2; drop the override when Nest catches up. |
| 14 | 2026-10-10 | **Better Auth handles authentication only** (core + `phone-number` + `two-factor` + `haveibeenpwned`). Organizations, roles and permissions are our own tables, not Better Auth's `organization`/`admin` plugins. | We need DB-defined custom roles, fine-grained permission strings, audit on every change and `scopedRepo` integration (§4). |
| 15 | 2026-10-10 | **Password hashing is Argon2id** (`@node-rs/argon2`, `memoryCost 19456 KiB, timeCost 2, parallelism 1`, tunable by env), overriding Better Auth's scrypt default. | OWASP-recommended minimum parameters for Argon2id; stored hashes must start with `$argon2id$`. |
| 16 | 2026-10-10 | **One session cookie** for web, `__Secure-wasfa.session`, `Domain=.wasfa.online; Secure; HttpOnly; SameSite=Lax`. The web server reads the session by forwarding the cookie to the API (`GET /me`); `web` never touches the DB. | Keeps AGENT §4 (web has no DB or secrets); instant revocation (no cookie cache). |
| 17 | 2026-10-10 | **Email through SMTP** (`nodemailer`) behind an `EmailTransport` interface: Brevo free tier (300/day) in production, a capture transport in dev/tests. | Provider swap (Resend, Mailjet, any SMTP) is an env change. Email is the primary verification channel, so the daily cap is monitored. |
| 18 | 2026-10-10 | **Emails are sent by the worker** (`notifications` queue); the API only enqueues. Tokens in jobs are encrypted. | A slow provider never blocks a request; Redis never holds a usable token. |
| 19 | 2026-10-10 | **Phone verification by inbound WhatsApp message ("reverse OTP")** through a Baileys linked-device bridge, behind a `PhoneVerifier` interface. **Replaces** "OTP over WhatsApp via the Meta Cloud API" in §3. | The user sends us the message, so our number never starts a conversation (lowest ban risk for an unofficial client) and WhatsApp proves number ownership. Free. A ban is recoverable (new number, or Meta Cloud API / SMS behind the same interface); the kill switch degrades to email verification. |
| 20 | 2026-10-10 | **Sign-in providers are a registry** (`google`, `facebook`, later `apple`) with status `enabled`, `coming_soon` or `disabled`. **Facebook is deferred** and ships as `coming_soon`. | Enabling it later = keys in env + one setting; no code change. |
| 21 | 2026-10-10 | **Closed value sets are `text` + CHECK built from `const` tuples in `@wasfa/shared`**, not Postgres enums; the same tuple types the column and the zod schemas. | Adding a value is a one-line migration; TypeScript, API and database cannot drift. |
| 22 | 2026-10-10 | **Users are never hard-deleted**: a deletion request sets `status = 'deleted'` and kills sessions; a worker anonymizes the row after 14 days. **Seeds are insert-only**: a system role's permissions are seeded only when the role is created. | Foreign keys from payments, usage and audit stay valid; an admin's edits to a role survive every deploy. |
| 23 | 2026-10-10 | **Phone + password accounts use our own Better Auth plugin, not `phone-number`**, and the reachable `/auth/*` surface is an explicit **allowlist** of endpoints, each re-validated with a shared zod schema. | The stock plugin checks verification before the password (phone enumeration), looks up unverified phones that are not unique, and adds a second OTP path. Deny-by-default also removes every Better Auth route we do not use. Details: SECURITY.md §4. |
| 24 | 2026-10-10 | **Access control is one global guard in a fixed order** (origin, session, permissions, freshness), deny by default, with `@Public()` as the only way out. **`/admin/*` additionally needs 2FA and a session that passed the second factor** (`sessions.mfa_verified_at`); freshness is `sessions.reauth_at` moved by `POST /auth/reauth`. | Several global guards have no guaranteed order in Nest. Better Auth issues a session only after the TOTP challenge on sign-in, so recording that fact at creation is exact and needs no extra round trip. |
| 25 | 2026-10-10 | **The API connects as a restricted database role `wasfa_api`** that owns nothing and cannot UPDATE/DELETE `audit_logs`; migrations run as the owner, which also sets the role's password from `API_DB_PASSWORD`. Data access lives in `*.repo.ts`, enforced by ESLint; user-owned tables go through `scopedRepo`. | A compromised API process cannot rewrite the audit trail or the schema. The lint rule keeps ownership filters out of ad-hoc queries. |
| 26 | 2026-10-11 | **IBM Plex Sans Arabic is the single typeface; Alexandria is removed.** Owner decision 2026-10-11. Preloaded weights: 400 (body) and 700 (headings); 500/600 load on demand. | One family reads as one product, halves the font payload and removes the per-page weight workaround. |
| 27 | 2026-10-12 | **Two AI execution paths**: prescription analysis is a worker job (`rx` queue, progress over Redis pub/sub relayed as SSE, polling fallback); chat streams from the API request so it can stop the moment the client leaves. | A closed tab must not lose a paid analysis; a chat must not keep spending after Stop. |
| 28 | 2026-10-12 | **Everything about models is data, not code**: providers, models (free-text ids), prices, credit multipliers, routes (task x plan x mode, versioned, ordered fallbacks) and the daily cap and kill switch live in tables and the `ai` setting, edited in `/admin/ai`. `packages/ai` has no database dependency; ports are injected. | The owner can switch or reprice a model without a deploy; the router is testable with fakes. |
| 29 | 2026-10-12 | **Money is integers**: credits are integers, USD in micros (bigint), prices in micros per 1M tokens, multipliers in basis points, BigInt maths in `pricing.ts`. The ledger is append-only (the API role has SELECT, INSERT only) and every wallet change locks the wallet row first. Reserve, settle and release are idempotent by key. | No float drift, no rewritten history, a retried job never double-charges. |
| 30 | 2026-10-12 | **Precision comes from code where possible**: the model transcribes; the matcher (pg_trgm), the dose dictionary and the duplicate-ingredient check decide. An unmatched item can never be shown as high confidence; an ingredient-only match is never auto-accepted; model-written warnings are off. | A fluent model is the wrong place to trust medicine facts. |
| 31 | 2026-10-12 | **Caches never cross owners unsafely**: the global exact cache is keyed by the processed-image hash + skill + route version and never serves an analysis a user corrected; near-duplicate (perceptual) matches are same-owner and only offered. | A look-alike image from another user must not reveal someone else's prescription. |
| 32 | 2026-10-12 | **Browser does the heavy conversion**: HEIC and PDF pages become JPEG in the browser (lazy chunks), the server accepts JPEG/PNG/WebP and single-page PDF only. HEIC outside Safari currently needs `unsafe-eval` (heic2any), which the CSP refuses: a WASM converter with `'wasm-unsafe-eval'` is the follow-up. | Keeps the worker small and the CSP strict. |
| 33 | 2026-10-14 | **Encrypted values carry a key id** (`v2.<keyId>...`) and `key:rotate` re-seals provider keys and the WhatsApp session in one transaction; `v1` values still open. | Rotation without downtime or guessing which key sealed what. |
| 34 | 2026-10-16 | **Prepaid subscription periods; no card auto-renewal in Phase 3.** | Fewer failure modes, no stored card tokens, matches wallet/InstaPay payment habits; recurring billing is decided later with data. |
| 35 | 2026-10-16 | **Orders and payments are separate.** | The quote is stored with an HMAC hash and recomputed server-side; a payment must equal its order total before anything activates. Retries across methods, no client-trusted price, safe webhooks. |
| 36 | 2026-10-16 | **One pure price engine in `@wasfa/shared`.** | Order: deal, then promotion/coupon (best-of), proration, tax, grossed-up processing fee. One source of truth for what a customer pays, testable with property tests. |
| 37 | 2026-10-16 | **Fees and tax are shown quietly but honestly.** | Complete summary on first checkout render, one combined expandable line, exact total on the Pay button, tax-inclusive pricing preferred, nothing added after the Pay click. Meets the conversion goal without misleading customers or inviting chargebacks. |
| 38 | 2026-10-16 | **Manual payments (InstaPay / Vodafone Cash to the admin-set number) are always human-approved.** | Proof, duplicate detection, SLA alerts, four-eyes above a threshold; the receiving number is editable only through a protected flow. The number is the highest-value target in the system. |
| 39 | 2026-10-16 | **Points are integers in an append-only ledger with three buckets (`pending`, `cash`, `credit_only`).** | 1,000 points = 100 EGP by default; hold before release; reversal on refund. Sign-up farming can only earn credits, never cash. |
| 40 | 2026-10-16 | **Rewards are computed on the net paid subtotal and paid in points; withdrawals are paid manually by admins.** | Destinations are encrypted with a cooldown. Predictable cost, simple audit, low fraud surface. |
| 41 | 2026-10-16 | **Admin alert channels: in-app + email + Telegram by default; WhatsApp outbound only to admin numbers that opted in, capped, disabled until the owner approves.** | Narrow, owner-approved exception to the receive-only bridge rule (decision 19); protects the number. |
| 42 | 2026-10-16 | **`plan_assignments` stays the effective-plan record; subscriptions reference it via `subscription_id`.** | Phase 2 quota and credits code stays untouched. |
| 43 | 2026-10-16 | **Deals engine with fixed precedence: user, then organisation membership, then referral code, then email domain; one deal per purchase.** | Predictable pricing for institutions and partners. |
| 44 | 2026-10-16 | **Admin access to prescriptions and chats needs a dedicated permission, a reason per access session, an audit row per open, and no export.** | Support needs context; health data needs accountability. |
| 45 | 2026-10-16 | **No dark patterns, enforced by tests.** | Server-backed countdowns, one prompt per session with cooldowns, no post-click fees, nothing pre-checked. Trust is the conversion strategy in a medical product. |
| 46 | 2026-10-16 | **Organisation wallets complete the Phase 2 gap.** | Members spend the organisation's credits first, optional personal fallback, optional member caps. Institutions need predictable shared budgets. |
| 47 | 2026-10-16 | **Payment gateway credentials are stored encrypted in the database (test/live mode), like AI provider keys.** | Gateways are adapters behind one interface; rotatable without a deploy; Stripe or others later. |
| 48 | 2026-10-16 | **No automatic FX at checkout.** | Explicit prices per currency; the FX setting only feeds the margin calculator and reports. Avoids silent mispricing. |
| 49 | 2026-10-16 | **Points are a rewards program, not money.** | Non-transferable, cannot be bought, terms page, optional expiry. Legal framing to confirm with the owner's lawyer/accountant. |
