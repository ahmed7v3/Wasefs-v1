# SECURITY.md — Wasfa AI

> Threat model, mandatory checklists and open security items. Read it before adding any endpoint, job, or integration.
> Priority 1 of the product (AGENT.md §1): when security conflicts with anything else, security wins.
> Status column legend: **Done** = in the code today (Phase 0 or a finished task); **Task X.Y** = planned, with the task that delivers it. **Update the status when the task lands.**

---

## 1. Assets and trust boundaries

What an attacker wants, in order of damage:

1. **Health data** (prescriptions, lab results, chats): private R2 bucket and the database. Arrives in Phase 2, but the identity model that protects it is built now.
2. **Accounts and sessions**, especially admins: an admin session can read every user.
3. **Money and credits** (Phase 2-3): the ledger, plan prices, payment webhooks.
4. **Platform spend**: AI calls, email, WhatsApp, storage. Abuse here costs real money (denial-of-wallet).
5. **Secrets**: encryption key, auth secret, OAuth and gateway keys.
6. **Reputation**: the sending domain (email deliverability) and the WhatsApp number.

Boundaries: the browser is untrusted. `web` holds no secrets and never touches the database. `api` is the only authority (AGENT.md §4). Cloudflare is the only public entry; the origin accepts Cloudflare only (firewall + mutual TLS). `worker` and the WhatsApp bridge are internal and never listen on a port.

---

## 2. Threat model

Phase 0 rows come from ARCHITECTURE.md §8. Rows marked **P1** are the identity and admin threats this phase introduces.

| Threat | Controls | Status |
|---|---|---|
| DDoS / floods | Cloudflare proxy, WAF, rate-limit rule; origin accepts only Cloudflare IPs; Caddy request limits | Done |
| Credential stuffing / brute force **P1** | Turnstile after 3 failures per identifier; Redis rate limits (10/15 min per IP, 5/15 min per identifier); Argon2id; breached-password check; uniform responses (no "unknown user" vs "wrong password") | **Done** (Task 1.3) |
| Account enumeration **P1** | Login, register, reset and phone-verification responses are identical whether or not the identifier exists; timing is not a side channel for the same reason | **Done** for login, register, reset (Task 1.3, tested); phone start in Task 1.5 |
| Session theft / fixation **P1** | `__Secure-` cookie, `HttpOnly; Secure; SameSite=Lax; Domain=.wasfa.online`; DB sessions with `cookieCache` off (instant revocation); a new session token on every sign-in; CSP with nonces; no tokens in URLs or logs | Cookie and sessions **Done** (Task 1.3); guards Task 1.6 |
| CSRF **P1** | `SameSite=Lax` + `OriginGuard` (`Origin`/`Referer` must be in `WEB_ORIGIN` on non-GET cookie requests) + exact-origin CORS (Done) | Task 1.6 |
| OAuth account takeover **P1** | Account linking only between **verified** identifiers; Google `email_verified` must be true; provider registry with per-provider status (a non-`enabled` provider's callback is rejected); OAuth tokens encrypted at rest | **Done** (Task 1.3, tested) |
| Privilege escalation / insider **P1** | Deny-by-default `AuthGuard`; typed permission catalog; the role-grant rules in §6 (no self-grant, no granting more than you hold); fresh re-auth for dangerous actions; mandatory TOTP for every admin route; 12 h admin sessions; audit on every admin write | Task 1.6 / 1.10 |
| Admin account compromise **P1** | TOTP 2FA with backup codes (shown once) and lockout on repeated wrong codes; **an account with 2FA cannot sign in through Google** (Better Auth runs the TOTP challenge for password sign-ins only); 12 h absolute admin sessions; suspending a user kills all sessions at once; audit trail they cannot edit (§7) | 2FA, session cap and Google rule **Done** (Task 1.3); admin-route enforcement Task 1.6 |
| Audit tampering **P1** | The API's database role cannot `UPDATE`/`DELETE` `audit_logs`; `before`/`after` pass a field allowlist and `redactText` | Task 1.6 |
| Free-tier farming / multi-accounting | One verified phone per active account (partial unique index, **Done** in schema); disposable-email blocklist; Turnstile on register | Task 1.2 / 1.3 |
| Phone-verification abuse **P1** | The proof is an inbound WhatsApp message from the number (we never send first); 6-digit code is only a correlation token; 10 min TTL, single use, constant-time compare; 3 starts/hour per user, per phone and per IP; wrong-sender messages ignored and counted | Task 1.5 |
| WhatsApp number ban **P1** | The anti-ban rules in §8; kill switch `auth.phoneVerification = disabled`; verification degrades to email, so a ban is an inconvenience, not an outage | Task 1.5 |
| Email abuse and cost **P1** | Turnstile and rate limits on every endpoint that triggers mail (register, reset, invites, phone start); daily cap guard under Brevo's 300/day with an alert at 80 %; per-organization pending-invite cap; no mail to unverified third parties beyond the verification mail itself | Task 1.3 / 1.4 / 1.7 |
| Denial-of-wallet (AI cost) **P2** | Credits are reserved before every provider call and settled after (append-only ledger, wallet row lock, idempotency keys); per-plan daily caps and one running analysis and one chat stream per user (Redis); a global daily USD cap with an alert at `ai.alertPercent` and `ai_paused` refusal at 100 %; kill switch per task or global (`ai.killswitch`, fresh auth); a fixed price per page and `maxOutputTokens` on every route; the browser quality gate and the exact-hash cache (a re-upload costs no provider call); route changes need fresh auth; every provider call writes an `ai_usage` row. If Redis is down the spend guard and breaker fail open (AI keeps working, the cap is not enforced): the ledger and plan checks still bound each user | **Done** (Tasks 2.2-2.4, 2.8, 2.11) |
| Price tampering **P3** | The client sends only ids and intent; one pure price engine prices on the server; a quote is stored in Redis for 15 min with an HMAC over user, organisation, target and quote, claimed atomically once, and re-verified when the order is created; a payment must equal the order total | **Done** (Tasks 3.2, 3.3) |
| Webhook forgery / replay **P3** | Signature verified before parsing; unique provider event id; a bad signature answers 401 and is recorded; a webhook never activates without the provider's status call agreeing on amount and currency; the return page only reads | **Done** (Task 3.3); Kashier webhook body still to verify against a live test payment |
| Double activation **P3** | Order → payment → subscription → wallet row locks; activation idempotent per order (event carrying `orderId`); 10 duplicate webhooks ⇒ 1 activation (tested); a second success on a paid order is alerted for a manual refund | **Done** |
| Coupon brute force and races **P3** | `POST /billing/coupons/check` 10/min per user and 30/min per IP, one generic answer for every refusal; redemptions reserved under lock with a unique `(coupon, order)`; 100 parallel redemptions of a 10-use coupon ⇒ exactly 10 (tested) | **Done** (Task 3.6) |
| Manual-payment fraud (reused or forged proofs) **P3** | Transaction id unique per method; SHA-256 and dHash comparison against every earlier proof (flags, critical alert); at most 3 submissions; always human-approved; four-eyes above the threshold; nobody reviews their own payment | **Done** (Task 3.4) |
| Payout fraud **P3** | Withdrawals only from the `cash` bucket, under the wallet lock (20 parallel requests never exceed it); destinations sealed, hashed and unique across accounts (a second account is refused and alerted); 48 h cooldown and a notice for a new destination; first withdrawal flagged; four-eyes above `rewards.fourEyesThresholdPoints`; reveal audited; transfer reference unique; cash-out off until the accountant answers | **Done** (Task 3.12) |
| Referral farming **P3** | Rewards only after email and phone verification and a first analysis; sign-up rewards are credit-only; same phone, payer number or device ⇒ held; velocity rule holds and alerts; weekly budget; hold before release; reversal on refund with a debt; kill switch | **Done** (Task 3.11) |
| Account takeover then withdrawal **P3** | Fresh sign-in (and 2FA where enabled) to request; new-destination cooldown and notice; reward and withdrawal notices by mail and in-app; manual review | **Done** |
| Admin collusion **P3** | Four-eyes on large manual payments and withdrawals with two different admins; no one acts on their own payment, request or account; every money action needs a reason and fresh auth and is audited; account-number changes need TOTP, wait 10 min and can be cancelled by another admin | **Done** |
| PHI access by staff **P3** | `users.read_health` / `users.read_chats` (not granted to support by default); a reasoned 30-minute access session of the same admin for the same user; a `phi.view` audit row per open; metadata-only lists (no drug names, no chat titles); `no-store`; no export route | **Done** (Task 3.15) |
| Alert-channel leakage **P3** | Alert text redacted on write (phones masked, private file links removed); no proof image or full phone in any alert; WhatsApp alerts off by default, opt-in from a verified phone, capped, no links | **Done** (Task 3.4) |
| Gateway key theft **P3** | Keys entered in the admin, sealed with AES-256-GCM, write-only and masked; a credential or mode change disables the gateway, alerts and needs a new verification payment | **Done** (Task 3.3) |
| Marketing without consent **P3** | Stored explicit opt-in (never pre-checked); signed one-click unsubscribe; weekly cap; silences after a refund and the last call; email only | **Done** (Task 3.14) |
| IDOR / data mixing | `scopedRepo` for every query on user-owned data; ownership checks in services; a wrong-owner integration test for every endpoint | Task 1.6 / 1.7 |
| Injection (SQL / XSS / SSRF) | Drizzle parameterized queries only (a CHECK may inline **constants** from our own code, never input); strict nonce CSP; Markdown through a sanitizer; no user-controlled outbound URLs; `next` redirect targets are same-origin relative paths only | Done / Task 1.9 |
| Open redirect **P1** | `?next=` accepts only a relative path starting with a single `/`; anything else falls back to `/dashboard` | **Done** in the api (Task 1.3, tested); web side Task 1.9 |
| Malicious uploads **P2** | Presigned PUT signed for the exact `Content-Length`, `Content-Type` and SHA-256 (R2/MinIO refuse a different body; `complete` runs a HEAD and deletes any mismatch); 10 MB and 30 uploads per 10 min per user; the worker re-checks magic bytes with `file-type`, limits decoded pixels to 40 MP (decompression bombs), auto-orients, strips every metadata block and re-encodes to JPEG, so a polyglot never reaches a reader; originals are deleted after processing; HEIC is converted in the browser; reads only through 60 s presigned GETs for the owner. Tests: wrong magic bytes, polyglot, 20,000 x 20,000 PNG bomb, EXIF GPS removed, other owner gets 404 | **Done** (Task 2.5); manual R2 check owed |
| Prompt injection **P2** | User text and text read from images are wrapped in `<user_data>` blocks the skills declare to be data; the model has no tools with side effects; every structured output is zod-validated (one repair retry); the verify step may only answer with an id from the offered candidate list; dose and drug identity come from deterministic code (matcher, dictionary), not model prose; model-written warnings are off. Test fixture: a prescription image with "ignore previous instructions" written on it must still produce an ordinary transcription | **Done** in code; image fixture with the eval set (Task 2.10) |
| Cross-owner data leakage via caches **P2** | The global result cache is keyed by the exact hash of the processed image plus skill and route versions, so only identical bytes match; an analysis that has any user correction is never served to another owner; the perceptual (near-duplicate) match is same-owner only and only offered, never reused silently; chats are personal even in an organization | **Done** (Task 2.8) |
| Prescriptions shared for review **P2** | Sharing is an explicit tick, off by default, asked again on every rating, and withdrawable by rating again. Only analyses with `share_for_review` reach `evals.run` holders; every approval and dismissal is audited; pictures are served through 60 s presigned links and are copied only into the private evaluation prefix; the note is scrubbed of emails, phones and tokens; details and the overview are generated from medicine names only (no image, no patient data leaves for that call) | **Done** (Task 2.14) |
| Handoff-token abuse **P2** | 32 random bytes, only the SHA-256 stored, 5 min expiry, 4 files at most, bound to one user and one capture session; the token can only add pages to that session (it cannot analyse, read, or spend credits); creating a token is limited to 5 per 10 min; the desktop feed is readable by the same user only | **Done** (Task 2.6) |
| Provider-key and cost exfiltration **P2** | Provider keys are encrypted (AAD `ai_provider:<key>`), shown masked, never returned, never in audit rows (tested by scanning every response and audit row); `ai_usage` and logs hold no prompt or answer text; medical tasks refuse providers flagged `free_tier`; CSV exports prefix formula characters | **Done** |
| Secret leakage | Env validated at boot; encrypted keys in DB; log redaction; gitleaks in CI; tokens in emails are encrypted in the queue (`encryptSecret`) so Redis never holds a usable token | Done / Task 1.4 |
| PII in logs **P1** | pino redaction paths; `redactText` on stored errors; recipients and phones logged as hashes only (mail, WhatsApp bridge) | Done / Task 1.4 / 1.5 |
| Supply chain | Lockfile, `pnpm audit` (high+) in CI, Dependabot, Trivy on images, pinned base images, non-root, read-only filesystems; Baileys and Better Auth versions pinned and reviewed on every bump | Done |
| Stale permissions after a role change **P1** | Permission cache in Redis, 5 min TTL, **busted on every role/permission change**; suspension and deletion revoke sessions immediately | Task 1.6 |
| Invite abuse **P1** | 7-day single-use tokens, only the SHA-256 stored; accepting account must own the invited email/phone; pending-invite cap; rate limit | Task 1.7 |
| Public contact form abuse **P1** | Turnstile + rate limit + size limit; stored as data, never rendered as HTML | Task 1.11 |
| Content stored XSS and bidi spoofing **P4** | Markdown is rendered by the shared renderer through an allow-list sanitiser (`sanitize-schema.ts`): no raw HTML, a link policy (external links get `rel` rules, `dofollowDomains` only), images only from the media origin, bidi control characters stripped (`stripBidiControls`); the API stores the rendered result and the web shows only that. Test: the XSS corpus in `packages/shared/test/content/xss.test.ts` | **Done** (WP3) |
| Preview token abuse **P4** | Stateless HMAC token over item id and expiry (`signPreviewToken`/`verifyPreviewToken`, token ≤ 600 chars); lifetime from `content.previewTokenHours` (1-168 h, default 24); `GET /public/content/preview/:token` answers `cache-control: no-store` and `x-robots-tag: noindex`, the page is `force-dynamic` with `robots` noindex/nocache; without `CONTENT_PREVIEW_SECRET` previews are off (404 for creating and for opening); a bad or expired token is a plain 404; 60/min per IP on the read; creating needs `content.write`. Test: `packages/shared/test/content/preview-token.test.ts` | **Done** (WP3); no per-token revocation (see WP3 carry-overs) |
| Cache-purge endpoint abuse **P4** | `POST /api/revalidate` (web): HMAC-SHA256 over `<timestamp>.<raw body>` in `REVALIDATE_HEADER`, 300 s window (`REVALIDATE_WINDOW_SECONDS`), single-use signatures (`ReplayCache`, 409), 120/min per process (429), 404 when `REVALIDATE_SECRET` is unset, bare status codes (no echo), `revalidateRequestSchema` tags must match `^[a-z0-9:_.-]{1,120}$` and be 1-50 per call. Test: `packages/shared/test/content/revalidate.test.ts` | **Done** (WP3) |
| Path-state cache poisoning and open redirect **P4** | Every redirect target is a site-relative path (`sitePathSchema`: starts with a single `/`, no whitespace or backslash, ≤ 300); the redirect service refuses loops and chains; the proxy (`apps/web/src/proxy.ts`, `lib/path-state.ts`) answers 301/410 only for `/blog`, `/guides`, `/glossary`, `/authors` (+ `/en`), never for the feeds, from maps the API builds (one minute in process; a failed refresh keeps the stale maps and never blocks a request); lookups use `Object.hasOwn`, case is not folded. Tests: `content-taxonomy-redirects.units.test.ts`, web `path-state` unit tests | **Done** (WP3) |
| Mass publication **P4** | Daily publish cap (`content.maxPublishesPerDay`, counted from local midnight of `content.timeZone`) checked under the advisory lock `content.publish-cap` in the same transaction as the publish; the worker's `publish-due` job applies the same cap and defers the rest; the quality gates block publishing; medical items need a review; bulk actions are capped at 100 ids and go through the same per-item rules (see below). Error `CONTENT_PUBLISH_CAP`. Tests: `content-items.int.test.ts`, worker publish-due tests (integration, not yet executed) | **Done** (WP3); integration tests not run |
| Four-eyes bypass **P4** | The approver may not be the submitter nor the author of the submitted revision, and must have an active reviewer profile linked to their account; the rule lives in the shared state machine (`packages/shared/src/content/workflow.ts`) and is checked again in `ContentWorkflowService` under the item row lock; the action route only asks for `content.read`, the state machine enforces the real permission per action. Errors `CONTENT_FOUR_EYES`, `CONTENT_NOT_A_REVIEWER`. Tests: `content-workflow.units.test.ts`, `content-items.int.test.ts` | **Done** (WP3) |
| Revision tampering **P4** | `content_revisions` is append-only: a database trigger refuses `UPDATE` of source columns and any `DELETE`; items are never hard-deleted (archive instead); restore creates a new revision; corrections are separate rows (`content.publish`). Migration 0023 | Code **Done**; migration **not executed** |
| Publishing while shadowed **P4** | Reserved page slugs (`slug-rules.ts`) keep a `page` from shadowing static routes (`/pricing`, `/blog`, ...); the catch-all `[...slug]` is below every static route and answers 404 without calling the API for anything that cannot be a page slug | **Done** (WP3) |
| Bulk-action abuse **P4** | `POST /admin/content/bulk`: `content.manage`, fresh auth ≤ 10 min, 20/min, ≤ 100 ids, a discriminated action schema, each item goes through its own workflow rules and reports `ok`/`code`, one `content.bulk` audit row with the ids and counts | **Done** (WP3) |
| Media metadata and licences **P4** | Public bucket only for content media; EXIF/metadata stripped by the worker (Task 2.5 pipeline); `licence`, `licenceRef`, `credit`, `caption` shape-checked by `patchMediaSchema` and rights-checked by `media-rules.ts` (`cc-by` needs a credit, `public-domain` a licence reference); every write audited as `media.create`, `media.commit`, `media.update`; permissions are `content.read`/`content.write` | **Done** (WP3); integration tests not run |
| Public read DoS **P4** | `/public/content/*` is 240/min per IP (preview 60/min); `pageSize` ≤ 24 (`CONTENT_LIMITS.pageSizeMax`), `page` ≤ 1000, sitemap pages ≤ 10,000 URLs; responses are re-parsed with the shared response schemas (no column leaks); `cache-control: public, max-age=30, stale-while-revalidate=300`; the web fetches carry cache tags so a purge, not traffic, refreshes them; only the `page` catch-all uses `cache: no-store` | **Done** (WP3); see carry-over for the catch-all |
| Admin data exposure **P4** | A person's `licenceNumber` is returned only on `/admin/content/people` (`content.read`) and is never written to audit rows (only whether one exists); `api_key_id` is never part of a public response (the public mapper and schemas exclude it; the admin list only filters by it); public people data shows the licence only when `showLicence` is set | **Done** (WP3); plaintext storage flagged below |
| Worker to web call **P4** | The worker calls `POST {WEB_INTERNAL_URL}/api/revalidate` with the HMAC secret (`REVALIDATE_SECRET`), 5 s timeout, 50 tags per request; either variable unset = purge skipped. **Topology change:** in `infra/docker/compose.prod.yml` the worker now also joins the `edge` network (it was `internal` + `egress`) to reach the web container; nothing is published on it. A worker compromise can therefore reach the web container's internal port | **Done** (WP3); executed only on the next deploy |

---

## 3. Mandatory per-endpoint checklist

Every route (REST, SSE, webhook) answers all nine questions **before merge**, and the answers go in the register in §3.1. "N/A" needs a reason in the register. The reviewer rejects a PR whose new route is missing from the register.

1. **Authentication.** Deny by default. Public routes carry `@Public()` and a comment saying why. Suspended and deleted users get `AUTH_REQUIRED`.
2. **Permission.** Admin routes live under `/admin/*`, use `@RequirePermission(...)` and need a 2FA-verified session. Dangerous ones add `@RequireFreshAuth(minutes)`.
3. **Ownership.** Anything user- or organization-owned is read and written through `scopedRepo`; membership role checked where it matters. Never trust an id from the client without the owner check.
4. **Input.** Body, query, params and any header we read are parsed by a **zod schema from `packages/shared`**; unknown keys are stripped; responses are built from explicit fields, never by returning a DB row.
5. **Rate limit.** Redis-backed, keyed by IP and, for auth-like routes, by identifier. State the numbers. Anything that sends mail, WhatsApp, AI or does heavy work has a stricter limit and a quota.
6. **Size limit.** Body size explicit (global is 1 MB). Pagination has a maximum page size (cursor-based, hard cap 100).
7. **Turnstile.** Required on every public route that creates an account, sends something, or can be scripted for gain (register, reset, phone start, contact form, login after failures).
8. **Audit.** Every admin write and every security event (role grant, suspension, 2FA change, settings write, password change) records an `audit_logs` row with before/after through `@Audited`.
9. **No PII in logs or errors.** No email, phone, token, cookie, file URL or request body in log lines or `error_events.context`; rely on the redaction paths and add new ones for new fields. Error messages to the client come from `ERROR_INFO` only.

Also required for every new route: an integration test for happy path, unauthenticated, wrong owner / insufficient permission, invalid input and rate limit (AGENT.md §7).

### 3.1 Endpoint register

| Method and path | Auth | Permission | Ownership | Input schema | Rate limit | Size | Turnstile | Audit | Test |
|---|---|---|---|---|---|---|---|---|---|
| `GET /health/live` | public (liveness probe) | — | — | none | skipped (probe) | — | — | — | Done |
| `GET /health/ready` | public (readiness probe; returns status only, no detail) | — | — | none | skipped (probe) | — | — | — | Done |
| `GET /healthz` (web) | public (container probe) | — | — | none | Cloudflare | — | — | — | Done |

| `GET /auth/providers` | public (the login page needs it before anyone is signed in) | — | — | none | global 120/min | — | — | — | Done |
| `POST /auth/sign-up/email` | public | — | creates the caller's own account | `signUpEmailSchema` | 5/h per IP | 1 MB | always | — (system event) | Done |
| `POST /auth/sign-up/phone-number` | public | — | own account | `signUpPhoneSchema` | 5/h per IP (shared with email register) | 1 MB | always | — | Done |
| `POST /auth/sign-in/email` | public | — | — | `signInEmailSchema` | 10/15 min per IP + 5/15 min per identifier | 1 MB | after 3 failures per identifier | — | Done |
| `POST /auth/sign-in/phone-number` | public | — | — | `signInPhoneSchema` | same bucket as email sign-in | 1 MB | after 3 failures | — | Done |
| `POST /auth/sign-in/social`, `GET /auth/callback/:id` | public | — | — | `signInSocialSchema`; provider must be `enabled` | 20 and 30 per 15 min per IP | 1 MB | — (the provider authenticates) | — | Done |
| `POST /auth/sign-out` | cookie (Better Auth) | — | the caller's own session | none | 60/15 min per IP | 1 MB | — | — | Done |
| `GET /auth/verify-email` | link token | — | the token's owner | token + `callbackURL` only | 20/15 min per IP | — | — | — | Done |
| `POST /auth/send-verification-email` | public | — | — | `sendVerificationEmailSchema` | 3/h per identifier + 10/h per IP | 1 MB | always | — | Done |
| `POST /auth/request-password-reset` | public | — | — | `requestPasswordResetSchema` | 3/h per identifier + 10/h per IP | 1 MB | always | — | Done |
| `GET /auth/reset-password/:token`, `POST /auth/reset-password` | link token | — | the token's owner | `resetPasswordSchema` | 20 and 20 per 15 min per IP | 1 MB | — | — | Done |
| `POST /auth/change-password` | cookie | — | the caller's own account | `changePasswordSchema` | 10/15 min per IP | 1 MB | — | `auth.password_change` (actor, no before/after) | Done |
| `POST /auth/two-factor/{enable,disable,generate-backup-codes,verify-totp,verify-backup-code}` | cookie / 2FA challenge cookie | — | the caller's own account | one schema each | 20/15 min per IP (+ Better Auth's TOTP lockout) | 1 MB | — | `auth.two_factor_enable`, `auth.two_factor_disable`, `auth.backup_codes_regenerate` | Done |

| `POST /auth/reauth` | cookie | — | the caller's own session | `reauthSchema` | 5/15 min per user + 20/15 min per IP, fail closed | 1 MB | — (the password is the proof) | — (not a change) | Done |
| `POST /phone/verify/start` | cookie | — | the caller's own account | `startPhoneVerificationSchema` | 3/h per user, per number and per IP; 10/min global | 1 MB | always | — | Done |
| `GET /phone/verify/status` | cookie | — | the caller's own account | none | 60/min | — | — | — | Done |
| `GET /me` | cookie | — | the caller | none | 120/min | — | — | — | Done |
| `PATCH /me` | cookie | — | the caller | `updateMeSchema` | 20/min | 1 MB | — | — (own profile, not a security event) | Done |
| `GET /me/sessions` | cookie | — | `scopedRepo(sessions)` | none | 30/min | — | — | — | Done |
| `DELETE /me/sessions/:id` | cookie | — | `scopedRepo(sessions)`; foreign = 404; current session = 409 | `idParamSchema` | 20/min | — | — | `session.revoke` | Done |
| `DELETE /me/sessions` | cookie | — | the caller's other sessions | none | 10/min | — | — | `session.revoke_all` | Done |
| `DELETE /me` | cookie + `@RequireFreshAuth(5)` | — | the caller; refused while sole `org_admin` of an org with members | none | 3/h | — | — | `user.delete_request` | Done |
| `GET /onboarding` | cookie | — | the caller's progress row | none | 60/min | — | — | — | Done |
| `PUT /onboarding/:step` | cookie | — | the caller (row locked `FOR UPDATE`) | `onboardingStepParamSchema` + `ONBOARDING_STEP_SCHEMAS[step]` | 30/min | 1 MB | — | `org.create` / `org.update` (organization step) | Done |
| `GET /orgs` | cookie | — | the caller's memberships | none | 60/min | — | — | — | Done |
| `GET /orgs/:id` | cookie | member | membership; non-member = 404 | `idParamSchema` | 60/min | — | — | — | Done |
| `PATCH /orgs/:id` | cookie | `org_admin` | membership (403 for a plain member) | `updateOrgSchema` | 20/min | 1 MB | — | `org.update` | Done |
| `GET /orgs/:id/members` | cookie | member | membership | `idParamSchema` | 60/min | — | — | — | Done |
| `PATCH /orgs/:id/members/:userId` | cookie | `org_admin` | membership, org row locked; last admin kept | `updateMemberRoleSchema` | 20/min | 1 MB | — | `org.member_role_change` | Done |
| `DELETE /orgs/:id/members/:userId` | cookie | `org_admin` | same | `orgMemberParamsSchema` | 20/min | — | — | `org.member_remove` | Done |
| `POST /orgs/:id/leave` | cookie | member | same; sole member deletes the org | `idParamSchema` | 10/min | — | — | `org.leave` (+ `org.delete`) | Done |
| `GET /orgs/:id/invites` | cookie | `org_admin` | membership; targets masked | `idParamSchema` | 60/min | — | — | — | Done |
| `POST /orgs/:id/invites` | cookie | `org_admin` | membership; ≤ 20 pending per org | `createInviteSchema` | 10/min + 30/day per inviter (fail closed) | 1 MB | — (authenticated, capped) | `org.invite_create` (role, channel only) | Done |
| `DELETE /orgs/:id/invites/:inviteId` | cookie | `org_admin` | `scopedRepo(invites, org_id)` | `orgInviteParamsSchema` | 20/min | — | — | `org.invite_revoke` | Done |
| `GET /me/invites` | cookie | — | invites addressed to the caller's **verified** email or phone | none | 30/min | — | — | — | Done |
| `GET /settings/public` | public (the web shell, contact hub and maintenance banner need it before sign-in); allowed during maintenance | — | — | none; returns only `public` registry keys | 120/min | — | — | — | Done |
| `POST /contact` | public (visitors without an account); an optional session only sets `user_id` | — | insert only | `contactMessageSchema` | 10/min + fail-closed 5/h and 20/day per IP, 300/h global, all before Turnstile | message ≤ 4000 chars | always (when a secret is configured) | — | Done |
| `GET /admin/stats` | cookie + 2FA session | users.read | platform data (no owner) | shared `schemas/admin` | 120/min | 1 MB; lists cursor-paged, max 100 | — | — | Done |
| `GET /admin/users` | cookie + 2FA session | users.read | platform data (no owner) | shared `schemas/admin` | 120/min | 1 MB; lists cursor-paged, max 100 | — | — | Done |
| `GET /admin/users/:id` | cookie + 2FA session | users.read | platform data (no owner) | shared `schemas/admin` | 120/min | 1 MB; lists cursor-paged, max 100 | — | — | Done |
| `POST /admin/users/:id/suspend` | cookie + 2FA session + fresh auth 10 min | users.suspend; a `super_admin` target only by a `super_admin`; never yourself | platform data (no owner) | shared `schemas/admin` | 30/min | 1 MB; lists cursor-paged, max 100 | — | `user.suspend` | Done |
| `POST /admin/users/:id/unsuspend` | cookie + 2FA session + fresh auth 10 min | users.suspend; same target rules | platform data (no owner) | shared `schemas/admin` | 30/min | 1 MB; lists cursor-paged, max 100 | — | `user.unsuspend` | Done |
| `PUT /admin/users/:id/roles/:roleKey` | cookie + 2FA session + fresh auth 10 min | users.roles.write; SECURITY §5 grant rules | platform data (no owner) | shared `schemas/admin` | 30/min | 1 MB; lists cursor-paged, max 100 | — | `role.grant` (only when changed) | Done |
| `DELETE /admin/users/:id/roles/:roleKey` | cookie + 2FA session + fresh auth 10 min | users.roles.write; §5 rules, last `super_admin` kept | platform data (no owner) | shared `schemas/admin` | 30/min | 1 MB; lists cursor-paged, max 100 | — | `role.revoke` (only when changed) | Done |
| `GET /admin/orgs` | cookie + 2FA session | orgs.read | platform data (no owner) | shared `schemas/admin` | 120/min | 1 MB; lists cursor-paged, max 100 | — | — | Done |
| `GET /admin/orgs/:id` | cookie + 2FA session | orgs.read | platform data (no owner) | shared `schemas/admin` | 120/min | 1 MB; lists cursor-paged, max 100 | — | — | Done |
| `GET /admin/roles` | cookie + 2FA session | roles.read | platform data (no owner) | shared `schemas/admin` | 120/min | 1 MB; lists cursor-paged, max 100 | — | — | Done |
| `GET /admin/permissions` | cookie + 2FA session | roles.read | platform data (no owner) | shared `schemas/admin` | 120/min | 1 MB; lists cursor-paged, max 100 | — | — | Done |
| `POST /admin/roles` | cookie + 2FA session + fresh auth 10 min | roles.write + `super_admin` | platform data (no owner) | shared `schemas/admin` | 30/min | 1 MB; lists cursor-paged, max 100 | — | `role.create` | Done |
| `PATCH /admin/roles/:key` | cookie + 2FA session + fresh auth 10 min | roles.write + `super_admin`; `super_admin` role read-only | platform data (no owner) | shared `schemas/admin` | 30/min | 1 MB; lists cursor-paged, max 100 | — | `role.update` | Done |
| `DELETE /admin/roles/:key` | cookie + 2FA session + fresh auth 10 min | roles.write + `super_admin`; not system, not held | platform data (no owner) | shared `schemas/admin` | 30/min | 1 MB; lists cursor-paged, max 100 | — | `role.delete` | Done |
| `GET /admin/settings` | cookie + 2FA session | settings.read | platform data (no owner) | shared `schemas/admin` | 120/min | 1 MB; lists cursor-paged, max 100 | — | — | Done |
| `PUT /admin/settings/:key` | cookie + 2FA session + fresh auth 10 min | settings.write | platform data (no owner) | shared `schemas/admin` | 30/min | 1 MB; lists cursor-paged, max 100 | — | `setting.update` (by `SettingsService`) | Done |
| `PUT /admin/branding/assets/:key` | cookie + 2FA session + fresh auth 10 min | settings.write | platform data (no owner); `key` ∈ `logo`, `logo_dark`, `favicon` | `brandingAssetParamSchema` + `putBrandingAssetSchema` (`{ dataUrl }`), then magic bytes and SVG denylist (see note below) | 10/min | 1 MB body, 512 KB decoded | — | `branding.asset_upload` (key, type, size, sha256; never the bytes) + `setting.update` (key `branding`) | Done |
| `DELETE /admin/branding/assets/:key` | cookie + 2FA session + fresh auth 10 min | settings.write | platform data (no owner) | `brandingAssetParamSchema` | 10/min | none | — | `branding.asset_delete` + `setting.update` (key `branding`) | Done |
| `GET /assets/:key` | public (the logo is drawn on the sign-in page and in search results; nothing private); allowed during maintenance | — | — | `brandingAssetParamSchema` + `brandingAssetQuerySchema` (`v` only picks the cache lifetime) | 240/min | response ≤ 512 KB | — | — | Done |
| `GET /admin/flags` | cookie + 2FA session | flags.read | platform data (no owner) | shared `schemas/admin` | 120/min | 1 MB; lists cursor-paged, max 100 | — | — | Done |
| `PUT /admin/flags/:key` | cookie + 2FA session | flags.write | platform data (no owner) | shared `schemas/admin` | 30/min | 1 MB; lists cursor-paged, max 100 | — | `flag.update` | Done |
| `DELETE /admin/flags/:key` | cookie + 2FA session | flags.write | platform data (no owner) | shared `schemas/admin` | 30/min | 1 MB; lists cursor-paged, max 100 | — | `flag.delete` | Done |
| `GET /admin/whatsapp` | cookie + 2FA session | settings.read | platform data (no owner) | none | 60/min | none | — | — | Done |
| `POST /admin/whatsapp/link` | cookie + 2FA session + fresh auth 10 min | settings.write | platform data (no owner) | shared `schemas/admin` (`{ number }` E.164) | 10/min | 1 MB | — | `setting.update` (key `whatsapp`, by `SettingsService`) | Done |
| `POST /admin/whatsapp/unlink` | cookie + 2FA session + fresh auth 10 min | settings.write | platform data (no owner) | none | 10/min | none | — | `whatsapp.unlink` | Done |
| `PUT /admin/whatsapp/verification` | cookie + 2FA session + fresh auth 10 min | settings.write | platform data (no owner) | shared `schemas/admin` (`{ enabled }`) | 10/min | 1 MB | — | `setting.update` (key `auth`) | Done |
| `GET /admin/audit` | cookie + 2FA session | audit.read | platform data (no owner) | shared `schemas/admin` | 120/min | 1 MB; lists cursor-paged, max 100 | — | — | Done |
| `GET /admin/issues` | cookie + 2FA session | issues.read | platform data (no owner) | shared `schemas/admin` | 120/min | 1 MB; lists cursor-paged, max 100 | — | — | Done |
| `GET /admin/issues/:fingerprint` | cookie + 2FA session | issues.read | platform data (no owner) | shared `schemas/admin` | 120/min | 1 MB; lists cursor-paged, max 100 | — | — | Done |
| `PATCH /admin/issues/:fingerprint` | cookie + 2FA session | issues.write | platform data (no owner) | shared `schemas/admin` | 30/min | 1 MB; lists cursor-paged, max 100 | — | `issue.status` | Done |
| `GET /flags` | cookie | — | the caller's evaluated flags | none | 60/min | — | — | — | Done |
| `POST /me/invites/:id/accept`, `POST /invites/accept` | cookie | — | invite must be pending and addressed to the caller's verified identifier, else 404 | `idParamSchema` / `acceptInviteTokenSchema` | 10/min | 1 MB | — | `org.invite_accept` | Done |

Everything else under `/auth/*` answers 404 (§4). Tasks 1.5 to 1.11 add their rows here as each endpoint is written.

**Uploaded brand images (logo, favicon).** The one place the api accepts a file from a user, and it is an admin's. Controls, in order: the key is a closed set; the body is a base64 data URL capped at 512 KB decoded; the declared type must be on a short list (PNG, WebP, SVG, ICO for the favicon only) **and** match the file's magic bytes (`89504E47…`, `RIFF….WEBP`, `00000100`), so a renamed file is refused; the row is stored as `bytea` in `site_assets` (never on disk, never on a user-chosen path). **SVG is the risk** (XML that can carry script), so it is parsed by a small well-formedness scanner (single `<svg>` root, balanced tags, quoted attributes, no DOCTYPE or `<!ENTITY`, no processing instruction but a leading `<?xml?>`) and refused on a deliberately blunt denylist, checked on the raw text and again with numeric character references decoded: `<script`, `<foreignObject`, `<iframe|embed|object|link|meta`, `on…=` event attributes, `javascript:`/`vbscript:`/`data:text/html`, any `href`/`xlink:href` that does not start with `#` (so no external or `data:` payloads), SMIL `attributeName="href"`, CSS `@import` and `url(` that does not point at `#id`. No sanitising and no allowlist: an SVG that trips it is rejected with `details.reason = unsafe_svg` and the admin exports a plain one. The serving route adds the second layer: `X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy: cross-origin`, and for SVG `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox` with `Content-Disposition: inline`, so opening the URL directly still runs nothing. In the browser an SVG only ever loads through `<img>`, which does not execute script. Web CSP: `img-src` allows the API origin and nothing else new.

### 3.2 Phase 2 endpoint register (AI product)

Same columns as 3.1 minus the repeated ones: every route validates input with a shared zod schema, all bodies are capped at 1 MB except the drug-import upload (20 MB), and no route here uses Turnstile. 

| Method and path | Auth | Permission | Ownership | Rate limit | Audit | Test |
|---|---|---|---|---|---|---|
| `POST /uploads` | cookie, verified account | — | caller's own file; plan/page rules at analysis | 30 per 10 min per user (fail-closed) + 60/min | — | Done |
| `POST /uploads/:id/complete` | cookie, verified account | — | owner or org member, else 404 | 60/min | — | Done |
| `GET /files/:id` | cookie, verified account | — | owner, else 404 | 240/min | — | Done |
| `GET /files/:id/url` | cookie, verified account | — | owner or org member, else 404; 60 s URL | 120/min | — | Done |
| `POST /handoff` | cookie, verified account | — | caller + capture session | 5 per 10 min | — | Done |
| `GET /handoff/:captureSessionId/events` | cookie, verified account | — | same user only | 30/min | — | Done |
| `GET /handoff/:token, POST /handoff/:token/uploads, .../complete` | public capability URL (random token, hash stored, 5 min, 4 files) | — | adds pages to the token's user session only; cannot analyse | 60 / 30 / 30 per min + 4 files per token | — | Done |
| `POST /rx` | cookie, verified account | — | files owned and processed, else 404 | 6/min + plan daily cap + one running analysis | — | Done |
| `GET /rx, GET /rx/:id, /events, /candidates/:itemIndex` | cookie, verified account | — | owner, else 404 | 120 / 240 / 60 / 120 per min | — | Done |
| `DELETE /rx/:id, POST /rx/:id/corrections` | cookie, verified account | — | owner, else 404; running analysis refuses delete | 60 / 120 per min | — | Done |
| `POST /ai/chats, GET /ai/chats, GET /ai/chats/:id, PATCH, DELETE, GET .../messages` | cookie, verified account | — | chat owner (personal even in an org), else 404 | 30 / 120 / 120 / 60 / 60 / 120 per min | — | Done |
| `POST /rx/:id/rating` | cookie, verified account | - | owner, finished analysis only, else 404 / 409; sharing consent is a separate flag that defaults to off | 30/min | - | Done |
| `GET /admin/ai/evals/shared, /shared/:id` | cookie + 2FA session | evals.run | platform data; only analyses whose owner agreed (`share_for_review`); the note is scrubbed; picture links last 60 s | per route default | - | Done |
| `POST /admin/ai/evals/shared/:id/approve, /dismiss` | cookie + 2FA session | evals.run | copies the picture and the reading into an evaluation set / withdraws the consent | 60/min | `eval.shared.approve`, `eval.shared.dismiss` | Done |
| `POST /ai/chats/:id/messages (SSE)` | cookie, verified account | — | chat owner, else 404; plan mode and tool entitlement; one stream per user | 20/min + plan daily cap | — | Done |
| `GET /me/credits, GET /me/usage` | cookie | — | caller's wallet; ledger reasons hide admin notes | 60/min | — | Done |
| `GET /catalog` | public (the pricing page is seen before sign-in) | — | — | `marketQuerySchema` (`?currency`, `?country` outside production) | 120/min | — | — | — | Done |
| `POST /billing/quote` | cookie | — | quote is stored for the caller only (`billing:quote:<id>`, HMAC over user, target and quote); the body carries no price; plan `{planKey, months, couponCode?, methodKey?}` or pack `{packKey, methodKey?}`; a bad coupon is a generic `invalid`, never a 4xx | `quoteRequestSchema` | 30/min + coupon checks 10/min per user and 30/min per IP | 1 MB | — | — | Done |
| `GET /me/recommendation` | cookie | — | caller's own credit usage; numbers only | `marketQuerySchema` | 30/min | — | — | — | Done |
| `POST /billing/orders` | cookie | — | order made only from the caller's own stored quote (HMAC over `{userId, target, quote}` re-verified, quote used once, expiry checked); the method must be the one the quote was priced with; coupon reserved under a row lock | `createOrderSchema` | 10/min | 1 MB | — | — | Done |
| `GET /billing/orders/:id` | cookie | — | `scopedRepo` by `owner_user_id`: another owner's order is `NOT_FOUND`; read only, never activates | `orderIdParamSchema` | 120/min | — | — | — | Done |
| `POST /billing/orders/:id/cancel` | cookie | — | owner only (`NOT_FOUND` otherwise); only `pending_payment` without a payment under review; releases the coupon | `orderIdParamSchema` | 10/min | — | — | — | Done |
| `POST /webhooks/:gateway` | public, `SkipOriginCheck` (no cookie; provider signature only) | — | signature verified in constant time by the adapter; bad signature = 401 + `payment_events` row with `signature_ok=false`; `(provider, event_id)` unique = replay shield; event row and its effects in one transaction; amount and currency re-checked against the order; verified deliveries always 200 | gateway param `BILLING_KEY_PATTERN`; body read only by the adapter | 600/min per IP | 256 KB (checked on `content-length`) | — | — | Done |
| `GET /admin/ai/providers, /models, /routes, /settings` | cookie + 2FA session | ai.read | platform data | 120/min | — | Done |
| `POST/PATCH/DELETE /admin/ai/providers` | cookie + 2FA session + fresh auth 10 min | ai.write | platform data; key encrypted, never returned | 30/min | `ai.provider.*` (no key material) | Done |
| `POST /admin/ai/providers/:id/test, GET .../discover` | cookie + 2FA session | ai.write / ai.read | platform data | 10 / 20 per min | `ai.provider.test` | Done |
| `POST/PATCH/DELETE /admin/ai/models, POST price-sync/apply` | cookie + 2FA session + fresh auth 10 min | ai.write | platform data; sync token single-use and bound to the admin | 30/min (preview 5/min) | `ai.model.*` | Done |
| `PUT/DELETE /admin/ai/routes` | cookie + 2FA session + fresh auth 10 min | ai.write | platform data; versioned (`expectedVersion`) | 30/min | `ai.route.*` | Done |
| `PUT /admin/ai/settings` | cookie + 2FA session + fresh auth 10 min | ai.write; kill switch also `ai.killswitch` | platform data | 20/min | `setting.update` | Done |
| `GET /admin/plans, /assignments` | cookie + 2FA session | plans.read | platform data | 120/min | — | Done |
| `POST/PATCH/PUT/DELETE /admin/plans..., POST /admin/plans/assignments(/:id/end)` | cookie + 2FA session + fresh auth 10 min | plans.write | platform data | 30/min | `plan.*` | Done |
| `GET /admin/credits/wallets(/:id/ledger)` | cookie + 2FA session | usage.read | platform data | 120/min | — | Done |
| `POST /admin/credits/adjust` | cookie + 2FA session + fresh auth 10 min | credits.adjust | a wallet; reason required; ledger is append-only | 30/min | `credits.adjust` | Done |
| `GET /admin/drugs, /:id; POST /admin/drugs/merge; PATCH /:id; POST /:id/aliases` | cookie + 2FA session (merge: fresh auth) | drugs.read / drugs.write | platform data | 120 / 30 / 60 / 60 per min | `drug.*` | Done |
| `GET/POST /admin/drugs/imports, dry-run, commit, rollback` | cookie + 2FA session (commit, rollback: fresh auth) | drugs.read / drugs.write | platform data; upload <= 20 MB, held 24 h in Redis | 10-30/min | `drug_import.*` | Done |
| `GET /admin/ai/overview` | cookie + 2FA session | usage.read | platform data; aggregates only, no content | per route default | — | Done |
| `POST /admin/ai/playground` | cookie + 2FA session | ai.write | admin runs 1-3 pinned models; own processed images only (else 404); goes through kill switch, spend guard and free-tier rule | 20 per hour per admin, one hit per model run (fail-closed) | `ai.playground.run` (task, counts, model keys; never input, output or keys) | Done |
| `GET /admin/ai/usage, /usage/totals` | cookie + 2FA session | usage.read | platform data; never content | per route default | — | Done |
| `GET /admin/ai/usage/export.csv` | cookie + 2FA session | usage.read | platform data; 100,000-row cap; cells starting with = + - @ tab CR are prefixed with ' | per route default | `ai.usage.export` | Done |
| `GET /admin/ai/skills, PUT /admin/ai/skills/:name` | cookie + 2FA session (PUT: fresh auth) | ai.read / ai.write | platform data; chat skills only | per route default | `setting.update` (key `skills`) | Done |
| `Evals: GET sets/runs/run detail/compare/review-queue` | cookie + 2FA session | evals.run | platform data; consented corrections show item text only, no patient identifiers | per route default | — | Done |
| `Evals: POST import, runs, cancel, review approve/reject` | cookie + 2FA session + fresh auth 10 min | evals.run | platform data; import stages files under `evals/rx/staging/`, worker re-encodes | per route default | `eval.import`, `eval.run.*`, `eval.correction.*` | Done |

---

## 4. Authentication and session rules

| Rule | Value |
|---|---|
| Library | Better Auth (core + `phone-number`, `two-factor`, `haveibeenpwned`), mounted at `/auth/*` in the api. It authenticates only; roles, permissions and organizations are ours. |
| Password hashing | **Argon2id** (`@node-rs/argon2`), `memoryCost 19456 KiB`, `timeCost 2`, `parallelism 1` (OWASP minimum), tunable by `ARGON2_MEMORY_KIB`. Stored hashes must start with `$argon2id$` (tested). |
| Passwords | Min length 10, breached-password check; no composition rules; no max below 128. |
| Session cookie | `__Secure-wasfa.session`, `Domain=.wasfa.online; Secure; HttpOnly; SameSite=Lax; Path=/`. One cookie for web. |
| Lifetime | Users 30 days sliding; **admins 12 hours**. `cookieCache` off. |
| Email verification | Required before any tool use. Tokens are single-use, short-lived, and travel encrypted through the queue. |
| Phone verification | Inbound WhatsApp message only (§8); unique verified phone per active account. |
| 2FA | TOTP mandatory for all admin access; backup codes shown once; lockout on repeated wrong codes. |
| Re-authentication | Required (password or TOTP within N minutes) for role changes, suspensions, settings that hold secrets, account deletion. Signalled as `AUTH_REQUIRED` with `details.reason = "reauth"`. |
| Turnstile | Server-verified with the caller IP on register, reset request, phone verification start, and login after 3 failures per identifier (Redis counter, 15 min). |
| Account linking | Only between verified identifiers; never auto-merge on an unverified email. |
| Errors | Better Auth messages never reach the client; mapped to our `{ code, message }` (Arabic by default). Unknown credentials, a wrong password and an unverified phone are the same `AUTH_REQUIRED` answer. |
| Reachable surface | **Allowlist** (`AUTH_ROUTES` in `apps/api/src/auth/auth.policy.ts`): only the routes in the endpoint register exist. Phone-OTP routes, user update/delete, change-email, account linking, session listing and admin routes of Better Auth answer 404. Bodies are re-parsed with the shared zod schemas, so unknown keys never reach Better Auth. |
| Phone accounts | A phone-registered account has a placeholder email on a reserved `.invalid` domain (never mailed). Better Auth's `phone-number` plugin is **not used**: it checks "verified?" before the password (a phone-enumeration leak), looks up by a non-unique phone, and ships a second OTP path. Our endpoints match **verified** phones only and always spend one password verification. The sign-in path is named `/sign-in/phone-number` because Better Auth's two-factor hook is keyed on that path. |
| Response bodies | The raw session token and full user rows are removed from every response (the cookie is HttpOnly; `/me` is the source of truth). |
| IP address | Better Auth records the IP we computed from the trusted proxy header; a client-supplied header is discarded. |
| Admin sessions | Created with 12 h expiry, and `AuthService.getSession` ends any admin session older than 12 h, whatever Better Auth's sliding refresh did. "Admin" = holds any platform role. |
| Social sign-in | Linked only to an existing account whose email is verified (`requireLocalEmailVerified`), so squatting someone's address cannot take over their Google login. The cost: the real owner cannot use Google until the squatter's unverified account is removed (purge job, §11). |
| Access control (Task 1.6) | One global guard (`AccessGuard`) runs, in this order: **origin** (state-changing request with the session cookie must come from `WEB_ORIGIN`, by `Origin` or `Referer`; `null` and missing are refused), **session** (deny by default; `@Public()` opts out; suspended/deleted users get `AUTH_REQUIRED` and lose their sessions), **permissions** (`@RequirePermission`; `super_admin` holds the whole catalog), **freshness** (`@RequireFreshAuth(minutes)`). Each is a separate class; the composite exists because Nest does not guarantee the order of several global guards. |
| Admin routes | Everything under `/admin/*` must declare `@RequirePermission` (a route that does not is refused with `admin_route_unprotected`), and the caller needs two-factor on (`FORBIDDEN`, `two_factor_required`) **and a session that went through the second factor** (`AUTH_REQUIRED`, `two_factor_session`, sign in again). The session marker is `sessions.mfa_verified_at`, set when the session is created by `/two-factor/verify-*`; a password-only session of an account that enabled 2FA later does not qualify. |
| Re-authentication | `sessions.reauth_at` starts at creation and `POST /auth/reauth {password}` moves it. `@RequireFreshAuth(5)` answers `AUTH_REQUIRED` with `details.reason = "reauth"` when it is older. A Google-only account has no password to give, so it signs in again, which stamps a new session. |
| Permission cache | `RbacService.resolve` keeps `{roles, permissions, orgIds}` in Redis for 5 minutes under an epoch-prefixed key. Whoever changes roles, role permissions or organization membership MUST call `bustUser`, `bustRole` or `bustAll` (tested). A Redis outage only costs speed. |
| Mail | Sent in the background (never awaited, so timing does not reveal whether an address exists). Verification and reset mails go through the `AuthMailer` interface; `QueueMailer` puts an `email.send` job on the `notifications` queue and the worker sends it (Task 1.4). The link is encrypted in the job (`encryptSecret`, AAD `email:<template>`), so the token is never in Redis, failed-job history or logs in clear; the log line carries an HMAC of the recipient, never the address. SMTP must use TLS (STARTTLS, or implicit on 465). The capture transport (mail kept in Redis for 10 minutes) refuses to run in production, and the worker env schema requires `SMTP_*` there. |

---

## 5. Authorization rules (RBAC)

1. Permissions are strings from the typed catalog (`packages/shared/src/permissions.ts`); the **API is the authority**, the UI only hides what the API would reject.
2. **No self-escalation.** An actor may grant or revoke a role only if every permission in that role is one the actor already holds, and **only `super_admin` may grant, revoke or edit `super_admin`**. Without this rule `users.roles.write` would let an `admin` promote themselves.
3. Nobody can remove the last `super_admin`, and nobody can change their own roles.
4. Role editing (`roles.write`) is `super_admin` only; the `super_admin` role itself is read-only in the editor.
5. Suspending a user, granting or revoking a role, and changing settings need fresh authentication and a written reason where the action affects another person.
6. Permission lookups are cached for 5 minutes in Redis and the cache is deleted on every role, role-permission or user-role change.
7. An admin acting as a user ("act as user") does **not** exist in Phase 1 (planned for Phase 4: read-only, time-boxed, audited).

---

## 6. Secrets and configuration

- Secrets live only in environment variables or Docker secrets, validated at boot by a zod schema; the process refuses to start if anything is missing or malformed (error output lists key names, never values).
- Keys the admin edits (AI providers, gateways) are encrypted at rest with AES-256-GCM (`encryptSecret`, key from `ENCRYPTION_KEY`) with a context string that binds each ciphertext to its use, and are shown masked.
- New in Phase 1 (added to `.env.example`, compose and the deploy-secrets doc by their tasks): `BETTER_AUTH_SECRET` (≥ 32 bytes), `AUTH_COOKIE_DOMAIN`, `GOOGLE_CLIENT_ID/SECRET`, `FACEBOOK_CLIENT_ID/SECRET` (optional, unused while Facebook is `coming_soon`), `TURNSTILE_SECRET_KEY`, `ARGON2_MEMORY_KIB`, `SMTP_HOST/PORT/USER/PASS`, `MAIL_FROM`, `MAIL_DAILY_CAP`.
- Payment gateway credentials are write-only: admin responses, audit snapshots and logs expose only `merchant_ref`, `key_hint` and whether credentials exist. Creating or changing them, switching mode and enabling need `billing.write`, fresh authentication and a reason. A credential or mode change disables the gateway and its payment methods, clears the connection test and the verification, raises a critical admin alert and starts a 10-minute cooldown. Enabling needs a fresh connection test and an end-to-end test payment confirmed by both the signed webhook and the status API for the current credentials and mode. Verified deliveries and reconciliation for payments that already started are applied even while the gateway is disabled; `enabled` only gates new checkouts.
- Our code never calls a payment provider's refund API. The owner refunds in the provider's dashboard or by bank/wallet transfer, then records it with the external reference; a signed provider report of a refund only raises a review alert and never changes our payment state.
- The WhatsApp auth state is stored encrypted in Postgres (`wa_sessions`), never on disk.
- `API_DB_PASSWORD` (Task 1.6): password of the restricted database role the API and the bridge use; hex only because it sits in a URL. Rotating it = change the variable and re-run the `migrate` step, then restart the api and the bridge.
- Rotation: `BETTER_AUTH_SECRET` (replace and redeploy; signs everyone out). `ENCRYPTION_KEY` (Task 2.13): every new ciphertext is `v2.<keyId>.<iv>.<tag>.<data>` where `keyId` is the first 4 bytes of the key's SHA-256; older `v1` values still open. Rotate with `ENCRYPTION_KEY_OLD=<old> ENCRYPTION_KEY=<new> pnpm --filter @wasfa/api key:rotate [--dry-run]` (owner `DATABASE_URL`, run from the `migrate` container): it re-seals every AI provider key, every payment gateway credential and the WhatsApp session in one transaction and aborts, changing nothing, if any value opens with neither key. Then update `.env.prod` and redeploy. In-flight email links sealed with the old key fail once and are re-issued by the user (they live 15 min to 7 days).
- gitleaks runs in CI over full history; `docs/vps/` is git-ignored because it holds server credentials.

---

## 7. Audit log

- **What is audited:** every admin write; role and permission changes; user suspension and restoration; settings and feature-flag writes; 2FA enable/disable; password change; session revoke-all; account deletion and anonymization; bootstrap grants by the CLI (actor `system`).
- **Row:** actor, action, target type and id, `before`/`after`, IP, user agent, time.
- **No PII in `before`/`after`:** writers copy a **field allowlist** per entity, never the whole row, and values pass through `redactText`. Emails, phones, tokens, password hashes and secrets are never stored. This is also what lets a deleted user be anonymized without rewriting history.
- **Append-only at the database:** the API connects as a role that has `INSERT` and `SELECT` on `audit_logs` but no `UPDATE`/`DELETE`; tested ("`UPDATE audit_logs` as the API DB role fails"). Migrations run as a separate owner role. **Done (Task 1.6)**: the API and the WhatsApp bridge connect as `wasfa_api` (migration 0005), which owns nothing and has only `SELECT`/`INSERT` on `audit_logs`; `UPDATE`, `DELETE` and `TRUNCATE` fail with `42501` (tested through the API's own connection). `AuditService.record` sanitizes `before`/`after` (secret-looking keys, contact fields, free text through `redactText`, depth/length/size limits); `@Audited` routes record after success and a failed audit write fails the request; failed actions write nothing. Auth security events (`auth.password_change`, `auth.two_factor_enable`, `auth.two_factor_disable`, `auth.backup_codes_regenerate`) are audited by the auth controller. The password of the role comes from `API_DB_PASSWORD`, applied by the `migrate` step, never from a migration.

---

## 8. WhatsApp bridge: phone verification and anti-ban rules

Design in phase1.md Task 1.5. The security properties that must hold:

- The proof of ownership is that **a message arrived from the claimed number**; the code is only a correlation token (it is visible on screen, and that is fine).
- The bridge **receives** and rarely replies. It runs as exactly one replica, on the `internal` network plus outbound internet, with no ports.
- It is unofficial (Baileys) and against WhatsApp's Terms of Service. Inbound-only, low-volume use on a warmed-up business number is the lowest-risk pattern; the design makes a ban recoverable (new number + re-pair, or the same `PhoneVerifier` interface backed by Meta's Cloud API or SMS). **Never use the owner's personal number.**

**Rules enforced in code (`guard.ts`) and documented here:**

1. Our number **never starts a conversation**, never sends to a number that did not message it first within the last 24 h, never joins groups, never posts statuses, never sends media or links. **Exception (Decision 50):** customer notifications to verified numbers, under the rules of §8.1.
2. At most **one short reply** per verification ("verified" or "wrong or expired code"), sent only in the user's own conversation after a random 2-6 s delay with a typing indicator. Global cap: 1 reply per 3 s and 300 per day; above the cap it stays silent (the web UI shows the outcome anyway).
3. Inbound messages are marked read. Only 1:1 text messages are processed; groups, statuses, broadcasts, media and calls are ignored.
4. One linked session, one server IP, no frequent re-pairing; reconnect with exponential backoff; on `loggedOut` stop and alert the admin; **never auto-re-pair**.
5. Phone numbers are never logged in clear (hash only). Wrong-sender messages are counted for abuse alerts.
6. **Kill switch:** setting `auth.phoneVerification = whatsapp_inbound | disabled`. When disabled, or when the bridge is down or restricted, the UI hides phone verification and email verification keeps working.
7. Operations: the owner links and unlinks the number in `/admin/whatsapp` (DOCKER-GUIDE 3.9); the one-off `wa-bridge ... link <number>` CLI stays as a fallback and prints its code to the operator's terminal only. **A pairing code is a short-lived secret** (valid about 3 minutes, and only useful together with the phone that holds the number): it is never written to a log line (the bridge logs "Pairing code issued"), never to `audit_logs`, and lives only in the Redis key `wa:pairing` with a 180 s expiry, from where `GET /admin/whatsapp` shows it to a signed-in admin holding `settings.read` and two-factor. Rotate the linked device if the server is ever suspected compromised.

**WhatsApp AI agent (docs/WA-AGENT.md; `agent-inbound.ts`, `agent-outbound.ts`).** Replies inside a chat the customer started are allowed for the agent only, and only under these rules, enforced by the bridge before every send:

1. **Reply-only:** a send needs an inbound message from that chat in the last 24 h (`wa:agent:lastin:<jid>`, set on every agent inbound). Nothing else can start a conversation.
2. **Caps** (admin `waAgent.caps`, reserved atomically with a Lua script, given back if not sent): per chat per hour and per day, total per UTC day. Over a cap the part is dropped with a reason, never queued for later.
3. **Delay and typing:** `composing` presence, then a wait until the customer's last message plus `replyDelaySeconds` (3-60, default 10) with plus or minus 25 % jitter, never longer than 60 s after dequeue; parts go out in order with the shared spacing (at least 3 s apart).
4. **Kill switch and independence:** `waAgent.enabled` (default off) stops the agent without touching codes; `auth.phoneVerification` stops codes without touching the agent. Both are read with a 30 s cache and re-checked after the typing delay.
5. **Owner takeover:** the owner typing in a chat (a `fromMe` message whose id the bridge did not send, remembered 2 days in `wa:sent:<id>`) pauses it for `takeoverPauseMinutes`; pause and block are mirrored to `wa:agent:pause:<jid>` / `wa:agent:block:<jid>` and checked again after the delay.
6. **Data:** inbound media only image (jpeg, png, webp), PDF and voice notes within 10 MB / 3 MB and 180 s, otherwise kind `other` without a file; transcripts and media are deleted after `waAgent.retentionDays` (default 90) by `wa-agent.retention`. No number or text is logged (ids, kinds and lengths only).
7. Every stream entry (`wa:agent:in`, `wa:agent:out`, `wa:agent:sent`) is parsed with the shared zod schemas; malformed entries are dropped and acknowledged.

**How it is built (Task 1.5):**

- **Challenge**: `POST /phone/verify/start` (session, Turnstile, 3 starts an hour per user, per number and per IP, all failing closed) makes a 6-digit code valid for 10 minutes and returns a `wa.me` link with the code pre-filled. Redis keys: `phone:ch:<user>` (the challenge), `phone:code:<hash(phone)>:<code>` (lookup by the inbound message, removed with `GETDEL`, so a code works once), `phone:result:<user>`. The lookup key contains the **sender's** number, so the same code from another number finds nothing.
- **Bridge to api**: the bridge appends `{id, phone, code, receivedAt, jid}` to the Redis stream `wa:inbound` (`MAXLEN ~ 10000`); the api consumes it in the consumer group `api` (any number of replicas; stale entries are claimed after 60 s), resolves the challenge, writes `phone`, `phone_verified_at` and `phone_verified`, and asks the bridge to answer through `wa:replies`. Wrong or unknown claims are counted per sender and hour (`phone:abuse:<hash>`); at 10 a warning is logged, above 5 the sender gets no reply.
- **The api cannot make the bridge say anything**: `wa:replies` carries only an outcome name; the two sentences (verified / wrong or expired) are fixed in the bridge, and `guard.ts` checks every send against the rules above (inbound seen in that chat within 24 h and for that message id, one reply per inbound message, no links, direct chats only, 2-6 s delay, at least 3 s apart, 300 a day).
- **One verified account per number** (partial unique index); the loser sees `failed / phone_in_use`.
- **Auth state**: `wa_sessions` rows are AES-256-GCM ciphertext with the session and key as AAD; a row that cannot be decrypted stops the bridge instead of minting new credentials.
- **Health**: the bridge writes `wa:heartbeat` every 30 s with its state (`connecting | connected | disconnected | logged_out`); `GET /phone/verify/status` reports `available` and why not. `/health/ready` does not depend on it. After `loggedOut` the bridge also sets `wa:alert` for the future admin dashboard.
- **Control channel (admin to bridge)**: the api never talks to WhatsApp. `POST /admin/whatsapp/link|unlink` (`settings.write`, fresh auth, 10/min) pushes `{ id, cmd: "link", number } | { id, cmd: "unlink" }` on the Redis list `wa:commands` (`LPUSH` + `LTRIM` to 20 + a 5-minute expiry, so a command queued while the bridge is down cannot fire later); the bridge pops it (`BRPOP`, FIFO) on a connection of its own, validates it with the shared zod schema (anything else is dropped), and answers in `wa:pairing` (`requested | code | linked | already_linked | unlinked | error`, 180 s expiry, fixed machine reasons only, the number masked to its last four digits). The api refuses `link` unless the bridge is idle and logged out (409 while a number is linked or reconnecting, 502 while the bridge is down), so the saved number (`site_settings.whatsapp.number`; `WHATSAPP_NUMBER` is only the fallback) can never name a different number than the one linked. An admin-started pairing gives up after 180 s, on any connection failure other than WhatsApp's own post-pairing restart, and leaves no half-linked session. **Anti-ban rules are untouched**: linking is the only thing the commands can do; they cannot send a message.
- **Unverified in this repository**: the Baileys socket glue (`wa-bridge/main.ts`) has not run against real WhatsApp. The spike (can the sender's number be resolved from a LID?) and the end-to-end checks of Task 1.5 need the dedicated number and are tracked in phase1.md.

### 8.1 Customer notifications from the bridge (Decision 50, 2026-10-17)

The one place our number writes first. The worker decides (`apps/worker/src/notifications/customer-channel.ts`), the bridge enforces (`wa-bridge/customer-messages.ts`), and every rule below is tested:

1. **Who:** only an active account whose phone is **verified** (it sent our number the code, so the chat exists and they started it), that has not sent **STOP** (`إيقاف` / `STOP`; `تشغيل` / `START` undoes it) or switched WhatsApp off on the account page. Everyone else gets email.
2. **Switch:** `whatsapp.customerMessages.enabled` (off by default), set in `/admin/whatsapp` with fresh auth and audited. The bridge rereads it every 30 s, so turning it off also stops messages already queued.
3. **Volume:** an owner-set daily total (default 300) and per-customer daily cap (default 3), reserved atomically by the worker; the bridge counts real sends against the same total as a backstop. Over a cap means email.
4. **Hours:** only inside the sending window (default 09:00-21:00 Africa/Cairo); a message outside it waits for the next window.
5. **Content:** keyed templates only (the producer passes a kind and parameters, never text), at most 1,000 characters, links only to `WEB_ORIGIN`'s host (anything else is refused), and every message ends with the STOP instruction. No media.
6. **Pace:** 2-6 s randomised delay and at least 3 s between any two outgoing messages (replies, admin alerts and customer messages share one slot).
7. **Exactly once, or email:** each message has an id derived from its notification key; the bridge claims it once (`SET NX`) and records `sent`, `failed` or why it refused; a message older than 3 minutes is dropped. Four minutes after queueing the worker claims it too and, unless it was `sent`, mails the customer instead. Receipts are always mailed (documents) and also sent on WhatsApp when possible.
8. **Logs** carry the message kind and the outcome, never the phone number, the chat id or the text.


---

## 9. Personal data inventory (Phase 1)

| Data | Where | Why | Retention |
|---|---|---|---|
| Email | `users.email`, `organization_invites.email`, `verifications.identifier` | Sign-in, verification, notices | Until anonymization (14 days after a deletion request); invites until accepted or the organization is deleted. |
| Phone (E.164) | `users.phone`, `organization_invites.phone` | Sign-in, anti-farming | Same. Freed for reuse on anonymization. |
| Name, profession, country, city, usage intent | `users.name`, `user_profiles` | Product, segmentation | Deleted at anonymization. |
| Password hash, OAuth tokens, TOTP secret | `accounts`, `two_factors` | Authentication | Deleted at anonymization. OAuth tokens and TOTP are encrypted. |
| IP address and user agent | `sessions`, `audit_logs` | Session list, abuse investigation | Session rows purged with the session (expiry job); audit rows kept (admin actors only, no end-user PII beyond ids). |
| Contact messages (name, email/phone, free text) | `contact_messages` | Answering the sender | Deleted when the sender's account is anonymized (matched by account, email or phone); otherwise kept until the Phase 4 ticket inbox defines a retention period. |
| Error context | `error_events` | Support | Redacted at write; retention policy set when the Issues page ships (Task 1.10). |

Health data does not exist in Phase 1. The privacy policy (Task 1.11) must describe all of the above, cite Egypt's Law 151/2020 and the KSA and UAE PDPL, and state the retention in this table. Data-retention consent follows decision #8 (consent in the policy; retained data is anonymized before storage).

---

## 10. Kill switches and quick actions

| Situation | Action |
|---|---|
| WhatsApp number restricted, bridge misbehaving | Set `auth.phoneVerification = disabled` in admin settings. Email verification continues. |
| Signup flood or abuse wave | `access.signupOpen = false`; tighten the Cloudflare rate-limit rule. |
| Need to stop the product, not the admins | `access.maintenanceMode = true` (admins bypass). |
| One user is abusive or compromised | Suspend (kills all sessions immediately). |
| Suspected session-secret leak | Rotate `BETTER_AUTH_SECRET` (signs everyone out) and redeploy. |
| Suspected database-key leak | Rotate `ENCRYPTION_KEY` with `key:rotate` (§6), then rotate every provider API key at the provider and re-enter it in admin. |
| AI spend spike or abuse | Admin > AI > Overview: flip the kill switch (per task or all), lower `dailyCapUsdMicros`, find the user in the usage explorer and suspend; steps in `AI-COST-RUNBOOK.md`. |
| Admin account suspected compromised | Suspend, revoke sessions, remove roles, review `audit_logs` for that actor. |

---

## 11. Carry-overs

Open security items from Phase 0 and design decisions. Each has an owner task; none may be forgotten.

| Item | Source | Owner task |
|---|---|---|
| ~~Restricted API DB role that cannot `UPDATE`/`DELETE` `audit_logs`~~ **Done (Task 1.6).** Owner action: add `API_DB_PASSWORD` to `.env.prod` before the next deploy (DOCKER-GUIDE 3.7) | Phase 0 review | Task 1.6 |
| Admin-route rules depend on `request.routeOptions.url` starting with `/admin`; a route registered under another prefix is not an admin route. Keep every admin endpoint under `/admin` (the guard test covers an unprotected one) | Task 1.6 | - |
| `AuthService.getSession` costs three queries per request (user status, platform role, session assurance) plus the cached permission lookup. Fold into one query, or cache per session for a few seconds, when load shows it | Task 1.6 | Phase 4 |
| ~~Server-side (SSR) calls must set `Origin`~~ **Done (Task 1.9):** `serverApi`/`getMe` always send `Origin: NEXT_PUBLIC_SITE_URL` | Task 1.6 | Task 1.9 |
| Baileys is a release candidate (`7.0.0-rc14`, pinned exactly); re-test the bridge before upgrading it, and treat the sender-number resolution (LID to phone) as unproven until the spike is done on the real number | Task 1.5 | Task 1.5 spike |
| `wa:inbound` and `wa:replies` entries hold the sender's phone number and chat id in Redis until trimmed (`MAXLEN`); Redis is on the private network only. Encrypt the entries if that ever changes | Task 1.5 | - |
| API image is 214 MB (target < 200 MB): audit `pnpm deploy --prod`, drop dev-only deps, or record an accepted size | Phase 0 | Task 1.12 |
| Branch protection not enforced (private repo on the free plan; `infra/scripts/protect-main.sh` is ready) | Phase 0 | Task 1.12 |
| Live checks on the server: direct-IP request refused, `ssh root` and password logins fail, SSL Labs A+, securityheaders.com ≥ A, restore drill | Phase 0 | Task 1.12 |
| Attach an Elastic IP; restrict SSH (22) in the security group to the owner's IP; rotate the Cloudflare token used for setup | Phase 0 notes | Task 1.12 |
| **Bot Fight Mode on the API host may challenge payment webhooks** (the free plan cannot skip it per path) | Phase 0 notes | Phase 3 (Kashier webhooks) |
| ~~Requests to unknown routes are not rate limited~~ **Done (Task 1.3):** 20 per minute per IP on anything that falls through to the 404 handler (`common/not-found-limit.ts`) | Phase 0 | Task 1.3 |
| The global rate limiter is **fail-open when Redis is down** (`skipOnError`). **Done for auth (Task 1.3), phone start (Task 1.5) and the contact form (Task 1.11):** separate counters that fail closed (`UPSTREAM_UNAVAILABLE`, tested) | Phase 0 | Task 1.3 / 1.5 / 1.11 |
| `Cross-Origin-Opener-Policy: same-origin` breaks popup-based OAuth; Google uses a redirect flow, so keep redirect and re-check if a popup is ever added | Phase 0 | Task 1.9 |
| ~~Decide nonce vs hash-based CSP for the SEO pages~~ **Decided (Task 1.11):** keep the per-request nonce for Phase 1; HTML is not CDN-cached. Revisit with hash-based CSP when traffic justifies it | Decision #10 | Task 1.11 |
| `.trivyignore.yaml` entries (age's Go standard library advisories) expire **2026-12-01**; re-evaluate then | Phase 0 | Before 2026-12-01 |
| Remove the Fastify 5.12.5 override when `@nestjs/platform-fastify` ships a patched dependency | Decision #13 | Ongoing |
| Rotation: `BETTER_AUTH_SECRET` = replace it in `.env.prod` and redeploy (every session, verification link and reset link is invalidated; nothing else breaks). **Done (Task 1.3).** **`ENCRYPTION_KEY` rotation: Done (Task 2.13)**, key-id prefix and `key:rotate` (§6) | Phase 1 | Task 2.13 |
| ~~OAuth tokens in `accounts` must be encrypted at rest~~ **Done (Task 1.3):** `account.encryptOAuthTokens`, asserted by a test | Task 1.2 review | Task 1.3 |
| ~~Purge unverified accounts~~ **Done (Task 1.7):** accounts with neither email nor phone verified are anonymized after 7 days by the worker's `account.anonymize_due` (hourly), which frees the squatted address. Decision #22 holds: they are anonymized, not deleted | Task 1.3 | Task 1.7 |
| The breached-password check (Have I Been Pwned) **fails closed**: if that service is unreachable, registration and password changes return an error with a `WSF-` ref. Decide whether to fail open (and log) once real traffic shows how often it happens | Task 1.3 | Phase 4 launch review |
| Better Auth's `sendOnSignIn` mails a fresh verification link on every correct-password sign-in to an unverified account (at most 5 per 15 min per account by the login limit). Acceptable; revisit if it is abused | Task 1.3 | — |
| ~~The `AuthMailer` has no real implementation~~ **Done (Task 1.4):** `QueueMailer` + worker `email.send`. Still open for the owner: SPF/DKIM/DMARC in Cloudflare and the mail-tester check (DOCKER-GUIDE 3.7) | Task 1.3 | Task 1.4 |
| Email addresses sit in clear in `email.send` job data (Redis, with the last 1000 failed jobs kept); only the links are encrypted. Encrypt `to` too if Redis ever leaves the private network or is snapshotted off-host | Task 1.4 | - |
| The admin alert at 80 percent of the daily mail cap is a once-a-day warning log plus the `mail:alert:<day>` Redis key; the dashboard surface arrives with the admin panel | Task 1.4 | Phase 8 |
| ~~`sessions` / `verifications` purge job~~ **Done (Task 1.7):** `auth.purge_expired` every 6 h | Task 1.2 review | Task 1.7 |
| Settings writes delete the Redis copy; if Redis is down at that moment the old value can be served for up to 10 minutes after it returns (the DB is right). Re-save the setting once Redis is back | Task 1.8 | - |
| Maintenance mode (`access.maintenanceMode`): every route answers 503 `maintenance` except health, `/auth/*`, `GET /settings/public` and `GET /me`; holders of any platform role bypass it. These 503s are expected and are not stored in `error_events` | Task 1.8 | - |
| `DELETE /me`'s "sole org_admin" check does not lock membership rows, so a concurrent role change in the same instant could leave an organization without an admin; it is restored by any member's admin promotion from support. Lock if it ever happens | Task 1.7 | - |

---

## 12. Testing and gates

| Gate | Where | Threshold |
|---|---|---|
| `pnpm audit --audit-level high` | CI `security` job | Zero high/critical (one documented ignore) |
| gitleaks over full history | CI `security` job | Zero findings |
| Trivy image scan before push | CI `images` job | No fixable HIGH/CRITICAL |
| Endpoint tests: happy path, unauthenticated, wrong owner / no permission, invalid input, rate limit | Vitest + Testcontainers | Every endpoint (AGENT.md §7) |
| Guard tests: anonymous 401, missing permission 403, admin without 2FA 403, stale auth `reauth`, foreign Origin 403 | Task 1.6 | All pass |
| Constraint tests for identity data (phone uniqueness, status sync, one invite target, RESTRICT rules) | `packages/db/test/identity-schema.int.test.ts` | Done |
| Playwright + axe on auth, onboarding, dashboard, account | Task 1.9 | No serious/critical violations |
| Penetration checklist before launch (Phase 4): session fixation, CSRF, IDOR sweep, rate-limit bypass, enumeration, open redirect, header review | Phase 4 | All pass |

### Task 3.4 endpoint register

| Route                                                                         | Authentication / permission                                       | Boundary and protections                                                                                                                               | Audit / status                                                     |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `GET /billing/orders/:id/instructions`                                        | Cookie + verified account                                         | Shared UUID params; owner scoped; 404 for absent/nonmanual payment; 60/min IP                                                                          | Read only                                                          |
| `POST /billing/payments/:id/proof`                                            | Cookie + verified account                                         | Shared zod body; 10/hour per user and 30/min IP; owner/file checks, processed-file requirement, order→payment lock, duplicate transaction/image checks | Alert in same transaction; kick after commit                       |
| `POST /uploads` (payment_proof purpose)                                       | Cookie + verified account                                         | Shared file schema; 10/hour per user for proof files and 60/min IP; existing magic-byte and image pipeline                                             | No audit                                                           |
| `GET /admin/billing/payments/review`, `GET /admin/billing/payments/:id`       | Cookie + MFA session, `payments.review`                           | Shared query/UUID schemas; overdue-first, then oldest-first keyset queue; detail returns an explicit shape (never the sealed phone or the stored quote), a short-lived proof link and the unsealed sender phone                                  | Detail logs `payment.review_opened`                                |
| `POST /admin/billing/payments/:id/claim`                                      | Cookie + MFA session, `payments.review`                           | Redis advisory lock, 5 minute TTL; 30/min IP                                                                                                           | `payment.review_claimed`                                           |
| `POST /admin/billing/payments/:id/approve`, `/reject`                         | Cookie + MFA session, `payments.review`, fresh auth ≤10 min       | Shared zod schemas; 10/min IP; own-payment check; approval lock override explicit; reason/note limits                                                  | `payment.approved` / `payment.rejected`; phone and txn id excluded |
| `POST /admin/billing/payments/:id/request-proof`                              | Cookie + MFA session, `payments.review`                           | Shared zod note schema; 10/min IP; own-payment check; lock override explicit                                                                                                                      | `payment.proof_requested`                                          |
| `GET /admin/alerts`, `/prefs`                                                 | Cookie + MFA session, `alerts.receive`                            | Shared cursor schema; deliveries always scoped to current admin; 120/min and 60/min IP                                                                 | Read only                                                          |
| `POST /admin/alerts/:deliveryId/read`, `/read-all`, `PUT /admin/alerts/prefs` | Cookie + MFA session, `alerts.receive`                            | Shared UUID/preferences schemas; 60, 20 and 10/min IP                                                                                                  | No audit                                                           |
| `POST /admin/alerts/:alertId/resolve`                                         | Cookie + MFA session, `alerts.receive` plus alert-kind permission and `payments.review` or `billing.write` | Shared UUID schema; dynamic permission check                                                                                                           | No audit                                                           |
| `GET /admin/billing/methods/:key/account-change`                              | Cookie + MFA session, `billing.write`                             | Shared key schema; 60/min IP                                                                                                                           | Read only                                                          |
| `POST /admin/billing/methods/:key/account-change`, `/cancel`                  | Cookie + MFA session, `billing.write`, fresh auth ≤10 min         | Shared account/TOTP schemas; 5/min IP; requested change applies after 10 minutes; request verifies a current Better Auth TOTP                          | Audited; only masked account values are kept in audit payloads     |

### Task 3.5 endpoint register

| Route | Authentication / permission | Boundary and protections | Audit / status |
| --- | --- | --- | --- |
| `GET /me/subscription` | Cookie session | Caller's own live subscription only; `trialAvailable` is a boolean (never says whose trial used a phone); 60/min | Read only |
| `POST /me/subscription/cancel`, `/resume` | Cookie session | No body; owner-scoped row lock; idempotent; 10/min | `subscription_events` (`canceled`, `resumed`) |
| `POST /me/subscription/renew-quote` | Cookie session | Shared zod body (`methodKey?`, `months?`); the plan always comes from the caller's subscription, never the client; same pricing path and limit as `POST /billing/quote` (30/min) | Signed quote in Redis |
| `POST /me/trial` | Cookie session + verified account | Shared zod body (`planKey`); 5/min IP and 5/hour per account; once per account and per verified phone (stored as a hash in the event, never the number), a transaction lock per phone | `subscription_events` `created` |
| `GET /me/orders` | Cookie session | Shared keyset query; `owner_user_id = caller` | Read only |
| `GET /me/notification-prefs`, `PUT /me/notification-prefs` | Cookie session | Shared zod body (`{ whatsapp: boolean }`); own row only; 409 `phone_not_verified` without a verified phone; updates the bridge's opt-out set at once; 60 and 10/min | Row in `notification_prefs` |
| `PUT /admin/whatsapp/customer-messages` | Cookie + MFA session, `settings.write`, fresh auth ≤10 min | Shared zod body (switch, caps 1-2000 and 1-10, hours with end after start); merged into the `whatsapp` setting; 10/min | `setting.update` audit row |
| `GET /me/orders/:id/receipt` | Cookie session | UUID param; caller's own paid/refunded orders only, anything else `NOT_FOUND`; buyer email and phone masked | Read only |


### Task 3.6 endpoint register

| Route | Authentication / permission | Boundary and protections | Audit / status |
| --- | --- | --- | --- |
| `GET /admin/billing/promotions`, `/promotions/:id` | Cookie + MFA session, `billing.read` | Shared list/UUID schemas; keyset page, 1–100 rows; 120/min | Read only |
| `POST /admin/billing/promotions`, `PATCH` and `DELETE /promotions/:id`, `POST /promotions/:id/{pause,end,duplicate}` | Cookie + MFA session, `promotions.write` | Shared billing schemas; 30/min; only drafts with no redemptions can be deleted | `promotion.created|updated|deleted|paused|ended|duplicated` |
| `POST /admin/billing/promotions/:id/{publish,resume}` | Cookie + MFA session, `promotions.write`, fresh auth ≤10 min | Shared UUID schema; guarded lifecycle update; 30/min | `promotion.published|resumed` |
| `GET /admin/billing/coupons`, `/coupons/:id` | Cookie + MFA session, `billing.read` | Shared list/UUID schemas; keyset page ≤100; detail returns the latest 50 redemption rows | Read only |
| `POST /admin/billing/coupons`, `PATCH` and `DELETE /coupons/:id`, `POST /coupons/:id/{pause,end}` | Cookie + MFA session, `coupons.write` | Shared billing schemas; 30/min; normalized unique codes; only unused drafts can be deleted | `coupon.created|updated|deleted|paused|ended` |
| `POST /admin/billing/coupons/:id/{publish,resume}` | Cookie + MFA session, `coupons.write`, fresh auth ≤10 min | Shared UUID schema; guarded lifecycle update; 30/min | `coupon.published|resumed` |
| `POST /admin/billing/coupons/bulk` | Cookie + MFA session, `coupons.write`, fresh auth ≤10 min | Shared bulk schema; 1–5000 rows; collision retry limit 5; one transaction | `coupon.bulk_created` |
| `POST /admin/billing/coupons/batches/:batch/{publish,pause,resume,end}` | Cookie + MFA session, `coupons.write`; publish/resume need fresh auth ≤10 min | Shared batch schema; set-based guarded transition; 30/min | `coupon.batch_<action>` |
| `GET /admin/billing/coupons/batches/:batch/export` | Cookie + MFA session, `billing.read` | Batch schema; CSV cells escaped against formula injection; 30/min | `coupon.batch_exported` |
| `POST /admin/billing/simulate` | Cookie + MFA session, `billing.read` | Shared simulator schema; 30/min; hidden plans allowed; no quote or Redis state stored | Read only |
| `POST /billing/coupons/check` | Cookie session | Shared coupon-check schema; 10/min per user and 30/min per IP plus 30/min route limit; generic invalid response | Read only |

### Task 3.8 endpoint register

| Route | Authentication / permission | Boundary and protections | Audit / status |
| --- | --- | --- | --- |
| `GET /admin/search` | Cookie + MFA session, any of `users.read`, `billing.read`, `referrals.read` | Shared trimmed query schema (2–80 chars); permission-filtered groups; at most five results per group; contact details masked; 60/min | `admin.search` only when user matches are returned; query text excluded |
| `GET /admin/billing/counts` | Cookie + MFA session, any of `payments.review`, `withdrawals.review`, `referrals.read` | Empty shared query schema; counts are `null` for groups the caller cannot read; 120/min | Read only |
| `GET /admin/billing/overview` | Cookie + MFA session, `billing.read` | Shared range schema; custom range limited to 366 days; 60-second Redis cache; per-currency money aggregates; 30/min | Read only |
| `GET /admin/billing/payments`, `/payments/:id/record`, `/orders`, `/orders/:id`, `/refunds` | Cookie + MFA session, `billing.read` | Shared filters and keyset cursors; explicit response shapes; contact and transaction identifiers masked; proof links and sealed values excluded; 60/min | Record drawer logs `payment.record_opened` |
| `POST /admin/billing/orders/:id/resend-receipt` | Cookie + MFA session, `billing.write` | Paid orders only; receipt mail job deduplicated within one minute; 5/min | `order.receipt_resent`; does not replay the paid-order topic |
| `POST /admin/billing/payments/:id/refund/preview`, `/refund` | Cookie + MFA session, `payments.refund`; refund also requires fresh auth ≤10 min | Shared amount/reason/reference/clawback schemas; preview is read-only; own payments refused; clawback capped; 20/min preview and 5/min refund | `payment.refunded` records amount, clawback and transfer reference, no PII |
| `GET /admin/billing/subscriptions`, `/subscriptions/:id` | Cookie + MFA session, `billing.read` | Shared filters and keyset cursor; user labels masked; details include event timeline and latest 20 owner orders; 60/min | Read only |
| `POST /admin/billing/subscriptions/:id/extend`, `/end`, `/cancel-at-period-end` | Cookie + MFA session, `users.upgrade`, fresh auth ≤10 min | Shared reason schema (3–500 chars); 10/min; extend by 1–24 months or to a future date; database subscription state machine and assignment sync; 409 `no_live_subscription` when nothing live is left | `subscription.admin_extend|admin_end|cancel_at_period_end` with the reason (dates are not written as text: the audit redactor scrubs digit runs); the state machine also writes `subscription.extended|ended` |
| `GET /admin/billing/plans`, `POST /plans/:id/prices/preview`, `PUT /plans/:id/prices` | Cookie + MFA session; `billing.read` for reads/preview, `billing.write` for publish | Shared price matrix schema; integer minor units; margin check blocks negative prices unless explicitly overridden; a null amount switches a cell off (rows are never deleted), cells not sent are untouched; publish needs a reason and fresh auth; 10/min write | `plan.prices_published` includes price diff |
| `GET /admin/billing/credit-packs`, `POST /credit-packs`, `PATCH /credit-packs/:id`, `PUT /credit-packs/:id/prices` | Cookie + MFA session; `billing.read` for reads, `billing.write` for writes | Shared key and integer price schemas; deactivation replaces deletion; price writes require fresh auth ≤10 min | Writes audited; no delete route |
| `GET /admin/billing/methods`, `PATCH /methods/:key` | Cookie + MFA session; `billing.read` / `billing.write`; patch requires fresh auth ≤10 min | Account destination masked on reads and excluded from PATCH schema; gateway methods require enabled, verified gateway; 20/min write | Before/after only changed public fields; audited |
| `GET /admin/billing/tax-rules`, `POST /tax-rules`, `PATCH /tax-rules/:id` | Cookie + MFA session; `billing.read` / `billing.write`; writes require fresh auth ≤10 min | Shared tax schema; one active rule per country/default; replacement deactivates the previous rule in the same transaction | Writes audited |

### Task 3.9 endpoint register (organisations)

| Route | Authentication / permission | Boundary and protections | Audit / status |
| --- | --- | --- | --- |
| `GET /me/credits` | Cookie session | Shared query (`meCreditsQuerySchema`); 60/min | Read only |
| `GET /orgs/:id/join-links` | Cookie session | `idParamSchema` param; 60/min | Read only |
| `POST /orgs/:id/join-links` | Cookie session | `idParamSchema` param; shared body (`createJoinLinkSchema`); 20/min | `org.join_link_create` audit row |
| `POST /orgs/:id/join-links/:linkId/disable` | Cookie session | `orgLinkParamsSchema` param; 20/min | `org.join_link_disable` audit row |
| `POST /orgs/:id/members/:userId/approve` | Cookie session | `orgMemberParamsSchema` param; 30/min | `org.member_approve` audit row |
| `POST /orgs/:id/members/:userId/reject` | Cookie session | `orgMemberParamsSchema` param; 30/min; answers 204 | `org.member_reject` audit row |
| `GET /join/:slug` | Public | `joinSlugParamSchema` param; 60/min | Read only |
| `POST /join/:slug/accept` | Cookie session | `joinSlugParamSchema` param; 10/min | `org.join_accept` audit row |
| `GET /admin/orgs/:id/join-links` | Cookie + MFA session, `orgs.read` | `idParamSchema` param; 120/min | Read only |
| `POST /admin/orgs/:id/join-links` | Cookie + MFA session, `orgs.write` | `idParamSchema` param; shared body (`createJoinLinkSchema`); 60/min | `admin.org.join_link_create` audit row |
| `POST /admin/orgs/:id/join-links/:linkId/disable` | Cookie + MFA session, `orgs.write` | `orgLinkParamsSchema` param; 60/min | `admin.org.join_link_disable` audit row |
| `GET /orgs/:id/dashboard` | Cookie session | `idParamSchema` param; 60/min | Read only |
| `GET /orgs/:id/usage.csv` | Cookie session | `idParamSchema` param; `orgUsageQuerySchema` query; 10/min; `no-store` (`@Header`); CSV attachment | Read only |
| `PUT /orgs/:id/members/:userId/limit` | Cookie session | `orgMemberParamsSchema` param; `memberLimitSchema` body; 30/min | `org.member_limit_set` audit row |
| `GET /orgs/:id/subscription` | Cookie session, `org_admin` role via `orgs.authorize` | `idParamSchema` param; 60/min | Read only |
| `GET /orgs/:id/orders` | Cookie session, `org_admin` role via `orgs.authorize` | `idParamSchema` param; `myOrdersQuerySchema` query; 60/min | Read only |
| `GET /orgs/:id/orders/:orderId/receipt` | Cookie session, `org_admin` role via `orgs.authorize` | `orgOrderParamsSchema` param; 60/min | Read only |
| `POST /institutions/leads` | Public | `institutionLeadSchema` body; `x-turnstile-token` header; 10/min | See service |

### Task 3.11 endpoint register (referrals and rewards)

| Route | Authentication / permission | Boundary and protections | Audit / status |
| --- | --- | --- | --- |
| `GET /me/referral` | Cookie session | No input; 60/min | Read only |
| `PATCH /me/referral` | Cookie session | `updateReferralCodeSchema` body; 10/hour | See service |
| `GET /r/:code` | Public | Raw `code` path param; 60/min; `no-store` (reply header); sets first-party cookie and 302 redirect | Read only |
| `GET /me/rewards` | Cookie session | No input; 60/min | Read only |
| `GET /me/rewards/activity` | Cookie session | `meRewardsActivityQuerySchema` query; 60/min | Read only |
| `GET /me/rewards/convert/preview` | Cookie session | `convertPreviewQuerySchema` query; 60/min | Read only |
| `POST /me/rewards/convert` | Cookie session | `convertPointsSchema` body; 10/hour | See service |

### Task 3.12 endpoint register (withdrawals)

| Route | Authentication / permission | Boundary and protections | Audit / status |
| --- | --- | --- | --- |
| `GET /me/payout-destinations` | Cookie session | No input; 60/min; values sealed, masked text only | Read only |
| `POST /me/payout-destinations` | Cookie session | `payoutDestinationInputSchema` body; 20/hour | See service |
| `DELETE /me/payout-destinations/:id` | Cookie session | `adminWithdrawalIdSchema` param; 20/hour; answers 204 | See service |
| `GET /me/withdrawals/eligibility` | Cookie session | No input; 60/min | Read only |
| `GET /me/withdrawals` | Cookie session | No input; 60/min | Read only |
| `POST /me/withdrawals` | Cookie session, fresh auth ≤10 min | `withdrawalRequestSchema` body; 20/hour | See service |
| `POST /me/withdrawals/:id/cancel` | Cookie session | `adminWithdrawalIdSchema` param; 20/hour | See service |
| `GET /admin/growth/withdrawals` | Cookie + MFA session, `withdrawals.review` | `adminWithdrawalListQuerySchema` query; 60/min | Read only |
| `GET /admin/growth/withdrawals/export.csv` | Cookie + MFA session, `finance.export` | `withdrawalExportQuerySchema` query; 10/min; `no-store` (`@Header`); CSV attachment | `withdrawal.export` audit row |
| `GET /admin/growth/withdrawals/:id` | Cookie + MFA session, `withdrawals.review` | `adminWithdrawalIdSchema` param; 60/min | `withdrawal.opened` audit row |
| `POST /admin/growth/withdrawals/:id/claim` | Cookie + MFA session, `withdrawals.review` | `adminWithdrawalIdSchema` param; 30/min | `withdrawal.claimed` audit row |
| `POST /admin/growth/withdrawals/:id/approve` | Cookie + MFA session, `withdrawals.review`, fresh auth ≤10 min | `adminWithdrawalIdSchema` param; `approveWithdrawalSchema` body; 10/min | `withdrawal.approved` audit row |
| `POST /admin/growth/withdrawals/:id/reject` | Cookie + MFA session, `withdrawals.review`, fresh auth ≤10 min | `adminWithdrawalIdSchema` param; `rejectWithdrawalSchema` body; 10/min | `withdrawal.rejected` audit row |
| `POST /admin/growth/withdrawals/:id/reveal` | Cookie + MFA session, `withdrawals.pay`, fresh auth ≤10 min | `adminWithdrawalIdSchema` param; `revealDestinationSchema` body; 10/min | `withdrawal.destination_revealed` audit row |
| `POST /admin/growth/withdrawals/:id/mark-paid` | Cookie + MFA session, `withdrawals.pay`, fresh auth ≤10 min | `adminWithdrawalIdSchema` param; `markWithdrawalPaidSchema` body; 10/min | `withdrawal.paid` audit row |

### Task 3.10 and 3.13 endpoint register (deals and growth console)

| Route | Authentication / permission | Boundary and protections | Audit / status |
| --- | --- | --- | --- |
| `GET /admin/growth/deals` | Cookie + MFA session, `referrals.read` | `dealListQuerySchema` query; 120/min | Read only |
| `POST /admin/growth/deals/simulate` | Cookie + MFA session, `referrals.read` | `simulateDealSchema` body; market resolved from request headers and currency setting; 30/min | See service |
| `GET /admin/growth/deals/:id` | Cookie + MFA session, `referrals.read` | `dealIdParamSchema` param; 120/min | Read only |
| `POST /admin/growth/deals` | Cookie + MFA session, `deals.write` | `createDealSchema` body; 30/min | `deal.created` audit row |
| `PATCH /admin/growth/deals/:id` | Cookie + MFA session, `deals.write` | `dealIdParamSchema` param; `updateDealSchema` body; 30/min | `deal.updated` audit row |
| `POST /admin/growth/deals/:id/activate` | Cookie + MFA session, `deals.write`, fresh auth ≤10 min | `dealIdParamSchema` param; 30/min | `deal.activated` audit row |
| `POST /admin/growth/deals/:id/pause` | Cookie + MFA session, `deals.write` | `dealIdParamSchema` param; 30/min | `deal.paused` audit row |
| `POST /admin/growth/deals/:id/end` | Cookie + MFA session, `deals.write` | `dealIdParamSchema` param; 30/min | `deal.ended` audit row |
| `POST /admin/growth/deals/:id/targets` | Cookie + MFA session, `deals.write` | `dealIdParamSchema` param; body parsed with `dealTargetInputSchema`; 30/min | `deal.target_added` audit row |
| `DELETE /admin/growth/deals/:id/targets/:targetId` | Cookie + MFA session, `deals.write` | `dealTargetParamSchema` param; 30/min; answers 204 | `deal.target_removed` audit row |
| `GET /admin/growth/fraud` | Cookie + MFA session, `referrals.read` | `fraudListQuerySchema` query; 120/min | Read only |
| `POST /admin/growth/fraud/bulk` | Cookie + MFA session, `referrals.write`, fresh auth ≤10 min | `bulkFraudSchema` body; 10/min | `referral.fraud_bulk` audit row |
| `GET /admin/growth/codes` | Cookie + MFA session, `referrals.read` | `codeListQuerySchema` query; 120/min | Read only |
| `POST /admin/growth/codes` | Cookie + MFA session, `referrals.write` | `createCodeSchema` body; 30/min | `referral_code.created` audit row |
| `POST /admin/growth/codes/:id/pause` | Cookie + MFA session, `referrals.write` | `growthIdParamSchema` param; `reasonBodySchema` body; 30/min | `referral_code.paused` audit row |
| `POST /admin/growth/codes/:id/resume` | Cookie + MFA session, `referrals.write` | `growthIdParamSchema` param; `reasonBodySchema` body; 30/min | `referral_code.resumed` audit row |
| `GET /admin/growth/referrals/overview` | Cookie + MFA session, `referrals.read` | `referralOverviewQuerySchema` query; 30/min | Read only |
| `GET /admin/growth/referrals/tree` | Cookie + MFA session, `referrals.read` | `referralTreeQuerySchema` query; 60/min | Read only |
| `GET /admin/growth/referrals/tree.csv` | Cookie + MFA session, `finance.export` | `referralTreeQuerySchema` query; 10/min; `no-store` (`@Header`); CSV attachment | `referral.tree_export` audit row |
| `GET /admin/growth/programs` | Cookie + MFA session, `referrals.read` | No input; 120/min | Read only |
| `POST /admin/growth/programs` | Cookie + MFA session, `referrals.write` | `createProgramSchema` body; 30/min | `referral_program.created` audit row |
| `PATCH /admin/growth/programs/:id` | Cookie + MFA session, `referrals.write`, fresh auth ≤10 min | `growthIdParamSchema` param; `updateProgramSchema` body; 30/min | `referral_program.updated` audit row |
| `POST /admin/growth/programs/:id/members` | Cookie + MFA session, `referrals.write`, fresh auth ≤10 min | `growthIdParamSchema` param; `moveMemberSchema` body; 30/min | `referral_program.member_moved` audit row |
| `GET /admin/growth/programs/:id/rules` | Cookie + MFA session, `referrals.read` | `growthIdParamSchema` param; 120/min | Read only |
| `POST /admin/growth/programs/:id/rules` | Cookie + MFA session, `referrals.write`, fresh auth ≤10 min | `growthIdParamSchema` param; `createRuleSchema` body; 30/min | `reward_rule.created` audit row |
| `POST /admin/growth/rules/what-if` | Cookie + MFA session, `referrals.read` | `whatIfSchema` body; 60/min | See service |
| `PATCH /admin/growth/rules/:id` | Cookie + MFA session, `referrals.write`, fresh auth ≤10 min | `growthIdParamSchema` param; `updateRuleSchema` body; 30/min | `reward_rule.updated` audit row |
| `POST /admin/growth/rules/:id/deactivate` | Cookie + MFA session, `referrals.write`, fresh auth ≤10 min | `growthIdParamSchema` param; `reasonBodySchema` body; 30/min | `reward_rule.deactivated` audit row |
| `GET /admin/growth/programs/:id/tiers` | Cookie + MFA session, `referrals.read` | `growthIdParamSchema` param; 120/min | Read only |
| `POST /admin/growth/programs/:id/tiers` | Cookie + MFA session, `referrals.write`, fresh auth ≤10 min | `growthIdParamSchema` param; `createTierSchema` body; 30/min | `referral_tier.created` audit row |
| `PATCH /admin/growth/tiers/:id` | Cookie + MFA session, `referrals.write`, fresh auth ≤10 min | `growthIdParamSchema` param; `updateTierSchema` body; 30/min | `referral_tier.updated` audit row |
| `DELETE /admin/growth/tiers/:id` | Cookie + MFA session, `referrals.write`, fresh auth ≤10 min | `growthIdParamSchema` param; `deleteTierQuerySchema` query; 30/min; answers 204 | `referral_tier.deleted` audit row |
| `GET /admin/growth/settings/rewards/preview` | Cookie + MFA session, `referrals.read` | No input; 60/min | Read only |

### Task 3.14 endpoint register (conversion engine)

| Route | Authentication / permission | Boundary and protections | Audit / status |
| --- | --- | --- | --- |
| `GET /me/growth/prompt` | Cookie session | `growthPromptQuerySchema` query; 120/min | Read only |
| `POST /me/taste` | Cookie session | `startTasteSchema` body; 10/hour; verified free accounts only, once a week, global weekly credit budget, kill switch | `taste_grants` row + `trial_grant` ledger row; unused credits taken back |
| `GET /me/taste/:grantId/compare` | Cookie session | `tasteGrantParamSchema` param; 60/min | Read only |
| `GET /me/offers` | Cookie session | No input; 60/min | Read only |
| `GET /me/value` | Cookie session | No input; 60/min | Read only |
| `GET /me/experiments` | Cookie session | No input; 60/min | Read only |
| `GET /public/proof` | Public | No input; 60/min | Read only |
| `POST /growth/events` | Public; session attached if present | `growthEventsRequestSchema` body; 16 KB cap (`GROWTH_EVENTS_MAX_BODY_BYTES`); ≤ 20 events; 60/min; client-reportable names only, prompt events need a session, props that look personal drop the event, variants recomputed server-side | `growth_events` rows, no PHI |
| `POST /unsubscribe` | Public; origin check skipped | `unsubscribeQuerySchema` token from query (one-click) or body; 20/min; HMAC token (subkey of `ENCRYPTION_KEY`) naming one user, can only turn marketing off; bad token `NOT_FOUND` | `notification_prefs` opt-out with its route |
| `GET /admin/growth/experiments` | Cookie + MFA session, `referrals.read` | No input; 120/min | Read only |
| `POST /admin/growth/experiments` | Cookie + MFA session, `promotions.write` | `createExperimentSchema` body; 30/min | `experiment.created` audit row |
| `PATCH /admin/growth/experiments/:id` | Cookie + MFA session, `promotions.write` | `experimentIdParamSchema` param; `updateExperimentSchema` body; 30/min | `experiment.updated` audit row |
| `POST /admin/growth/experiments/:id/start` | Cookie + MFA session, `promotions.write` | `experimentIdParamSchema` param; 30/min | `experiment.started` audit row |
| `POST /admin/growth/experiments/:id/stop` | Cookie + MFA session, `promotions.write` | `experimentIdParamSchema` param; 30/min | `experiment.stopped` audit row |
| `POST /admin/growth/experiments/:id/complete` | Cookie + MFA session, `promotions.write` | `experimentIdParamSchema` param; 30/min | `experiment.completed` audit row |
| `GET /admin/growth/experiments/:id/results` | Cookie + MFA session, `referrals.read` | `experimentIdParamSchema` param; 60/min | Read only |
| `GET /admin/growth/funnel` | Cookie + MFA session, `billing.read` | `growthFunnelQuerySchema` query; 60/min | Read only |

### Task 3.15 endpoint register (user 360)

| Route | Authentication / permission | Boundary and protections | Audit / status |
| --- | --- | --- | --- |
| `GET /admin/users/:id/summary` | Cookie + MFA session, `users.read` | `adminUserParamsSchema` param; 120/min | Read only |
| `POST /admin/users/:id/reveal-contact` | Cookie + MFA session, `users.read` | `adminUserParamsSchema` param; `adminRevealContactSchema` body; 20/min; `no-store` (`NoStoreInterceptor`) | `user.contact_revealed` audit row |
| `GET /admin/users/:id/timeline` | Cookie + MFA session, `users.read` | `adminUserParamsSchema` param; `adminUserPageQuerySchema` query; 120/min | Read only |
| `GET /admin/users/:id/billing` | Cookie + MFA session, `billing.read` | `adminUserParamsSchema` param; `adminUserPageQuerySchema` query; 120/min | Read only |
| `GET /admin/users/:id/credits` | Cookie + MFA session, all of `users.read`, `usage.read` | `adminUserParamsSchema` param; `adminUserPageQuerySchema` query; 120/min | Read only |
| `GET /admin/users/:id/referrals` | Cookie + MFA session, `referrals.read` | `adminUserParamsSchema` param; `adminUserPageQuerySchema` query; 120/min | Read only |
| `POST /admin/users/:id/coupon-grant` | Cookie + MFA session, `coupons.write` | `adminUserParamsSchema` param; `adminCouponGrantSchema` body; 30/min | See service |
| `POST /admin/users/:id/personal-offer` | Cookie + MFA session, `promotions.write` | `adminUserParamsSchema` param; `adminPersonalOfferSchema` body; 30/min | See service |
| `POST /admin/users/:id/points-adjust` | Cookie + MFA session, `rewards.adjust`, fresh auth ≤10 min | `adminUserParamsSchema` param; `adminPointsAdjustSchema` body; 20/min | See service |
| `POST /admin/referrals/:referralId/release` | Cookie + MFA session, `referrals.write` | `adminReferralParamsSchema` param; `adminReferralActionSchema` body; 30/min | See service |
| `POST /admin/referrals/:referralId/void` | Cookie + MFA session, `referrals.write` | `adminReferralParamsSchema` param; `adminReferralActionSchema` body; 30/min | See service |
| `POST /admin/referrals/:referralId/block-referrer` | Cookie + MFA session, `referrals.write` | `adminReferralParamsSchema` param; `adminReferralActionSchema` body; 30/min | See service |
| `GET /admin/users/:id/notes` | Cookie + MFA session, `users.read` | `adminUserParamsSchema` param; `adminUserPageQuerySchema` query; 120/min | Read only |
| `POST /admin/users/:id/notes` | Cookie + MFA session, `users.read` | `adminUserParamsSchema` param; `adminNoteCreateSchema` body; 30/min | See service |
| `PATCH /admin/users/:id/notes/:noteId` | Cookie + MFA session, `users.read` | `adminUserNoteParamsSchema` param; `adminNotePatchSchema` body; 30/min | See service |
| `DELETE /admin/users/:id/notes/:noteId` | Cookie + MFA session, `users.read` | `adminUserNoteParamsSchema` param; 30/min | See service |
| `POST /admin/users/:id/phi-sessions` | Cookie + MFA session, any of `users.read_health`, `users.read_chats` | `adminUserParamsSchema` param; `adminPhiSessionSchema` body; 20/min; `no-store` (controller `NoStoreInterceptor`) | See service |
| `GET /admin/users/:id/phi-sessions` | Cookie + MFA session, any of `users.read_health`, `users.read_chats` | `adminUserParamsSchema` param; 60/min; `no-store` (controller `NoStoreInterceptor`) | Read only |
| `GET /admin/users/:id/prescriptions` | Cookie + MFA session, `users.read_health` | `adminUserParamsSchema` param; `adminUserPageQuerySchema` query; 120/min; `no-store` (controller `NoStoreInterceptor`) | Read only |
| `GET /admin/users/:id/prescriptions/:rxId` | Cookie + MFA session, `users.read_health` | `adminUserRxParamsSchema` param; 60/min; `no-store` (controller `NoStoreInterceptor`); requires an unexpired access session of the same admin for the same user (`FORBIDDEN` `phi_session_required`) | `phi.view` audit row per open (service), before the data leaves |
| `GET /admin/users/:id/chats` | Cookie + MFA session, `users.read_chats` | `adminUserParamsSchema` param; `adminUserPageQuerySchema` query; 120/min; `no-store` (controller `NoStoreInterceptor`) | Read only |
| `GET /admin/users/:id/chats/:chatId` | Cookie + MFA session, `users.read_chats` | `adminUserChatParamsSchema` param; `adminUserPageQuerySchema` query; 60/min; `no-store` (controller `NoStoreInterceptor`); same access-session rule; chat scoped to the viewed user | `phi.view` audit row per open (service) |
| `POST /admin/users/:id/plan-change/preview` | Cookie + MFA session, `users.upgrade` | `adminUserParamsSchema` param; `adminPlanChangePreviewSchema` body; 60/min | See service |
| `POST /admin/users/:id/plan-change` | Cookie + MFA session, `users.upgrade` | `adminUserParamsSchema` param; `adminPlanChangeSchema` body; 20/min; fresh sign-in demanded by service | See service |
| `POST /admin/orgs/:id/plan-change/preview` | Cookie + MFA session, `users.upgrade` | `adminUserParamsSchema` param; `adminPlanChangePreviewSchema` body; 60/min | See service |
| `POST /admin/orgs/:id/plan-change` | Cookie + MFA session, `users.upgrade` | `adminUserParamsSchema` param; `adminPlanChangeSchema` body; 20/min; fresh sign-in demanded by service | See service |

### Phase 4 / WP3 endpoint register (content platform)

All `/admin/*` rows need a cookie session with a verified second factor (the global admin rule, section 5). Every API row answers errors from `ERROR_INFO` only; no body text is logged. Schemas come from `@wasfa/shared/schemas/content` unless noted. `content.*` permissions: `read`, `write`, `publish`, `review`, `manage`.

| Route | Authentication / permission | Boundary and protections | Audit / status |
| --- | --- | --- | --- |
| `GET /admin/content/items` | Cookie + MFA session, `content.read` | `contentListQuerySchema` query (cursor, hard cap 100); 120/min | Read only |
| `POST /admin/content/items` | Cookie + MFA session, `content.write` | `createContentItemSchema` body (`bodyMd` ≤ 200,000 chars); 60/min; actor resolved from the session, quality gates and duplicate check run on the service side | `content.item.created` audit row |
| `GET /admin/content/items/:id` | Cookie + MFA session, `content.read` | `contentIdParamSchema` param; 240/min | Read only |
| `PATCH /admin/content/items/:id` | Cookie + MFA session, `content.write` | `contentIdParamSchema` param; `updateContentItemSchema` body; 60/min; optimistic lock (`CONTENT_CONFLICT`); a new revision of a live item resets review state per `statusAfterNewRevision` | `content.item.updated` audit row (status, revision number, which parts changed; never the text) |
| `PUT /admin/content/items/:id/autosave` | Cookie + MFA session, `content.write` | `contentIdParamSchema` param; `autosaveContentSchema` body; 120/min; one mutable row per user and item | Not audited by design (not a revision, not a business event) |
| `POST /admin/content/render-preview` | Cookie + MFA session, `content.write` | `renderPreviewSchema` body (`bodyMd` ≤ 200,000 chars); 30/min (the render is CPU work); nothing stored; same sanitiser as save | Read only |
| `POST /admin/content/items/:id/actions/:action` | Cookie + MFA session, `content.read` at the route, the real permission per action enforced by the workflow state machine (submit: write, approve and request_changes: review plus a reviewer profile, publish and schedule: publish, archive and unarchive: manage); fresh auth ≤ 10 min for `archive` and `unpublish` | `contentActionParamsSchema` param; `contentActionBodySchema` body; 60/min; four-eyes and quality gates in the shared workflow, daily publish cap under an advisory lock, row lock re-check | `content.item.<submitted/approved/changes_requested/scheduled/unscheduled/published/unpublished/archived/unarchived>` audit row with status before and after |
| `POST /admin/content/items/:id/preview-token` | Cookie + MFA session, `content.write` | `contentIdParamSchema` param; 30/min; 404 when `CONTENT_PREVIEW_SECRET` is unset; expiry from `content.previewTokenHours` | Not audited (a token is stateless and expires); see carry-overs |
| `GET /admin/content/items/:id/revisions` | Cookie + MFA session, `content.read` | `contentIdParamSchema` param; 120/min | Read only |
| `GET /admin/content/items/:id/revisions/:revisionId` | Cookie + MFA session, `content.read` | `contentRevisionParamsSchema` param; 120/min | Read only |
| `POST /admin/content/items/:id/revisions/:revisionId/restore` | Cookie + MFA session, `content.write` | `contentRevisionParamsSchema` param; 30/min; creates a new revision, never edits an old one | `content.item.restored` audit row |
| `POST /admin/content/items/:id/corrections` | Cookie + MFA session, `content.publish` | `contentIdParamSchema` param; `createCorrectionSchema` body (summary 5-500 chars); 30/min | `content.item.correction_added` audit row |
| `GET /admin/content/options` | Cookie + MFA session, `content.read` | No input; 240/min; names and slugs only (read-only accounts need it for filters) | Read only |
| `GET /admin/content/link-suggestions` | Cookie + MFA session, `content.write` | `linkSuggestionsQuerySchema` query (`q` ≤ 100 chars); 120/min; at most 8 results | Read only |
| `GET /admin/content/review-inbox` | Cookie + MFA session, `content.review` | `reviewInboxQuerySchema` query (cursor); 240/min | Read only |
| `POST /admin/content/bulk` | Cookie + MFA session, `content.manage`, fresh auth ≤ 10 min | `bulkActionSchema` body (discriminated by action, 1-100 ids); 20/min; each item goes through its own workflow rules and reports `ok` or an error code | `content.bulk` audit row (action, ids, succeeded and failed counts) |
| `GET /admin/content/categories` | Cookie + MFA session, `content.read` | No input; 240/min | Read only |
| `POST /admin/content/categories` | Cookie + MFA session, `content.manage` | `categoryInputSchema` body; 60/min | `content.category.create` audit row |
| `POST /admin/content/categories/reorder` | Cookie + MFA session, `content.manage` | `reorderCategoriesSchema` body; 60/min | `content.category.reorder` audit row |
| `PATCH /admin/content/categories/:id` | Cookie + MFA session, `content.manage` | `contentIdParamSchema` param; `categoryInputSchema` body; 60/min | `content.category.update` audit row |
| `DELETE /admin/content/categories/:id` | Cookie + MFA session, `content.manage` | `contentIdParamSchema` param; 60/min; answers 204 | `content.category.delete` audit row |
| `GET /admin/content/tags` | Cookie + MFA session, `content.read` | No input; 240/min | Read only |
| `POST /admin/content/tags` | Cookie + MFA session, `content.manage` | `tagInputSchema` body; 60/min | `content.tag.create` audit row |
| `POST /admin/content/tags/merge` | Cookie + MFA session, `content.manage` | `mergeTagsSchema` body; 30/min | `content.tag.merge` audit row |
| `PATCH /admin/content/tags/:id` | Cookie + MFA session, `content.manage` | `contentIdParamSchema` param; `tagInputSchema` body; 60/min | `content.tag.update` audit row |
| `DELETE /admin/content/tags/:id` | Cookie + MFA session, `content.manage` | `contentIdParamSchema` param; 60/min; answers 204 | `content.tag.delete` audit row |
| `GET /admin/content/people` | Cookie + MFA session, `content.read` | No input; 240/min; returns `licenceNumber` to admins | Read only |
| `POST /admin/content/people` | Cookie + MFA session, `content.manage` | `personInputSchema` body (`sameAs` https URLs, at most 8); 60/min | `content.person.create` audit row (licence number not recorded) |
| `PATCH /admin/content/people/:id` | Cookie + MFA session, `content.manage` | `contentIdParamSchema` param; `personInputSchema` body; 60/min | `content.person.update` audit row (licence number not recorded) |
| `DELETE /admin/content/people/:id` | Cookie + MFA session, `content.manage` | `contentIdParamSchema` param; 60/min; answers 204 | `content.person.delete` audit row |
| `GET /admin/content/redirects` | Cookie + MFA session, `content.read` | `redirectListQuerySchema` query (cursor, `q` ≤ 100); 240/min | Read only |
| `GET /admin/content/redirects/test` | Cookie + MFA session, `content.read` | `redirectTestQuerySchema` query (`sitePathSchema`); 120/min; reports the chain and loops | Read only |
| `POST /admin/content/redirects` | Cookie + MFA session, `content.manage` | `redirectInputSchema` body (both paths `sitePathSchema`); 60/min; loops and chains refused (`CONTENT_REDIRECT_INVALID`), writes serialised by an advisory lock | `content.redirect.create` audit row |
| `PATCH /admin/content/redirects/:id` | Cookie + MFA session, `content.manage` | `contentIdParamSchema` param; `redirectInputSchema` body; 60/min; same refusals | `content.redirect.update` audit row |
| `DELETE /admin/content/redirects/:id` | Cookie + MFA session, `content.manage` | `contentIdParamSchema` param; 60/min; answers 204 | `content.redirect.delete` audit row |
| `POST /admin/media/uploads` | Cookie + MFA session, `content.write` (changed from the earlier media permission in WP3) | `createMediaUploadSchema` body (`@wasfa/shared/schemas/media`); 60/min; presigned PUT rules of Task 2.5 | `media.create` audit row |
| `POST /admin/media/:id/commit` | Cookie + MFA session, `content.write` | `mediaIdParamSchema` param; 60/min; HEAD check, worker re-checks bytes and strips metadata | `media.commit` audit row |
| `GET /admin/media` | Cookie + MFA session, `content.read` | `listMediaQuerySchema` query (cursor); 240/min | Read only |
| `GET /admin/media/:id` | Cookie + MFA session, `content.read` | `mediaIdParamSchema` param; 240/min | Read only |
| `GET /admin/media/:id/usage` | Cookie + MFA session, `content.read` | `mediaIdParamSchema` param; 240/min; lists where an asset is used | Read only |
| `PATCH /admin/media/:id` | Cookie + MFA session, `content.write` | `mediaIdParamSchema` param; `patchMediaSchema` body (alt, caption, credit, licence, licence reference) plus the `media-rules.ts` rights check; 60/min | `media.update` audit row |
| `GET /public/content/resolve` | Public (`@Public`, allowed during maintenance); published content only | `publicResolveQuerySchema` query; 240/min; response re-parsed with `publicResolveResponseSchema` (item, redirect, gone, not_found); related items bounded; `cache-control: public, max-age=30, stale-while-revalidate=300` | Read only |
| `GET /public/content/list` | Public | `publicListQuerySchema` query; 240/min; `pageSize` ≤ 24, `page` ≤ 1000; same cache header | Read only |
| `GET /public/content/taxonomy-page` | Public | `publicTaxonomyPageQuerySchema` query; 240/min; same cache header | Read only |
| `GET /public/content/taxonomy-list` | Public | `publicTaxonomyListQuerySchema` query; 240/min; same cache header | Read only |
| `GET /public/content/glossary-index` | Public | `publicGlossaryIndexQuerySchema` (locale) query; 240/min; same cache header | Read only |
| `GET /public/content/path-state` | Public | No input; 240/min; redirect and gone maps for the proxy; same cache header | Read only |
| `GET /public/content/sitemap` | Public | `publicSitemapQuerySchema` query; 240/min; ≤ 10,000 URLs per page (`hasMore`); same cache header | Read only |
| `GET /public/content/preview/:token` | Public, the signed token is the credential | `publicPreviewParamSchema` param (token ≤ 600 chars); 60/min; bad, expired or no-secret = 404; `cache-control: no-store`, `x-robots-tag: noindex` | Read only; not audited (see carry-overs) |
| `POST /api/revalidate` (web) | Server to server; HMAC-SHA256 over `<timestamp>.<raw body>` in `REVALIDATE_HEADER`, 300 s window, replay cache (409); 404 when `REVALIDATE_SECRET` is unset | `revalidateRequestSchema` body (1-50 tags, regex-checked); 120/min per process (429); bad signature = 401, bad body = 400, no echo; no cookies, no Origin | Not audited; the worker logs the call |
| `GET /sitemap.xml` (web) | Public | No input; the index lists content children from the API; on an API outage serves the last good copy (cache 300 s) | Read only |
| `GET /sitemap-pages.xml`, `/sitemap-guides.xml`, `/sitemap-glossary.xml`, `/sitemap-authors.xml`, `/sitemap-taxonomy.xml` (web) | Public | No input; built from the public sitemap API; at most 10,000 URLs per file | Read only |
| `GET /sitemap-articles-:n.xml` (web, rewrite to `/sitemap-articles/[n]`) | Public | `n` must match `^[1-9]\d{0,2}$` else 404; chunks of at most 10,000 URLs; unknown chunk 404 | Read only |
| `GET /blog/feed.xml`, `GET /en/blog/feed.xml` (web) | Public | No input; latest 50 articles (API pages of 24); never redirected or 410 by the proxy | Read only |
| `/blog`, `/blog/:slug`, `/blog/c/:slug`, `/blog/t/:slug`, `/guides`, `/guides/:slug`, `/glossary`, `/glossary/:slug`, `/authors/:slug` (+ `/en/...`) (web pages) | Public | Slugs resolved by the API (`resolve`, `list`, `taxonomy-page`) with tagged data-cache fetches; unknown slug = 404; the nonce CSP applies; only published content, `noindex` where the taxonomy page is not indexable | Read only |
| `/preview/:token` (web page) | Public, the signed token is the credential | `force-dynamic`, metadata `robots` noindex and nocache; the API call is `no-store`; invalid token = 404 | Read only |
| `/:slug*` catch-all for `page` items (web) | Public | Below every static route; a path that cannot be a page slug is 404 without an API call; otherwise one `no-store` `resolve` per path | Read only |
| Proxy 301 / 410 for `/blog`, `/guides`, `/glossary`, `/authors` (+ `/en`) | Public | `apps/web/src/proxy.ts` with `lib/path-state.ts`; redirect targets are site-relative; `Object.hasOwn` lookup; the 410 page is static HTML with `noindex`; maps cached one minute in process | Read only |

### Phase 4 / WP3 carry-overs (residual risks)

| Item | Note |
| --- | --- |
| Migration 0023 and every WP3 integration test (content items, public, taxonomy, media, worker content jobs) have **not been executed**: Docker was unavailable. Run them, and apply the migration on a copy first, before the release | Owner: next session with Docker |
| The `keyword_ownership` quality gate and the drug / auto-link entity resolvers are seams: they do nothing until WP5 supplies the data | WP5 |
| The `page` catch-all fetches with `cache: no-store` once per unknown path; it is bounded only by the API limit of 240/min per IP and Cloudflare. Consider a short negative cache | Phase 4 hardening |
| The preview chrome (header and footer) renders in Arabic on `/preview/*` whatever the item locale | Cosmetic, WP3 follow-up |
| The web sitemap index serves the last good copy during an API outage; a cold start without one answers 500 | Accepted |
| Open Graph cards per item are not generated: only an explicit OG image or the site default | Later |
| Fresh auth is enforced on archive, unpublish and bulk, but not on taxonomy, people or redirect writes (they need `content.manage` and are audited) | Decide with the owner |
| `content_people.licence_number` is stored in plaintext (returned only to `content.read` admins, never audited, shown publicly only with `showLicence`). Decide whether to seal it like other identifiers | Owner decision |
| `GET /admin/content/options` is readable with `content.read` (names and slugs only) | Accepted |
| Preview tokens cannot be revoked before they expire (stateless) and creating one is not audited; keep `content.previewTokenHours` short for sensitive drafts | Owner decision |
| The `/api/revalidate` rate limit and replay cache are per web process (in memory); with more than one web replica a replay could reach another replica inside the window | Revisit with scaling |
| The worker joins the `edge` network (compose.prod.yml) to call the web container; confirm no published port or Caddy route exposes the worker | Check on deploy |
