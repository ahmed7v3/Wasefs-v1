# Phase 1 — Identity, Admin Core & Public Front Door

> Goal: real people can create accounts and finish onboarding, admins can run the platform safely, and visitors land on a real, fast, Arabic landing page.
> Prerequisites: read `docs/AGENT.md`, `docs/ARCHITECTURE.md` (§3, §4, §9, §12, §13), `docs/ROADMAP.md`, and the Phase 0 Notes.
> Phase 1 of 4 build phases (see `ROADMAP.md`). **No AI, uploads, plans, or payments in this phase.**

---

## Outcome

- A visitor can register with email + password, Google, or phone + password (phone verified by sending us a WhatsApp message), then verify, sign in, and sign out on any device. Sessions are revocable. Facebook appears as "coming soon".
- New users go through a resumable onboarding wizard and land on the dashboard shell (RTL, 360 px → desktop).
- Every API route is **deny-by-default**: authenticated, permission-checked, rate-limited, and audited where it writes admin data.
- Admins (mandatory TOTP 2FA) manage users (suspend kills sessions), organizations, roles/permissions, site settings, feature flags, and errors (Issues page), and can read the audit log.
- Landing page v1, legal pages, and the contact hub are live, with Lighthouse targets met.
- `DATABASE.md`, `SECURITY.md`, `DESIGN-SYSTEM.md` exist and match the code.

---

## Owner prerequisites (start now — some take days)

| Item | Needed by | Notes |
|---|---|---|
| **A dedicated WhatsApp number** on a real SIM (not the owner's personal number), registered in the **WhatsApp Business app** with the brand name and logo, and used normally by a person for 1–2 weeks before launch ("warm-up") | Task 1.5 | Linked to the server as a *linked device* (QR scan). No Meta Business API needed. |
| Google OAuth client (web) | Task 1.3 | Redirect URI `https://api.wasfa.online/auth/callback/google`. Needs the privacy + terms URLs (Task 1.11). |
| Cloudflare Turnstile site + secret key | Task 1.3 | Free. One widget, "managed" mode. |
| **Brevo** free account (300 emails/day, no card) with the `wasfa.online` domain authenticated (SPF, DKIM, DMARC records in Cloudflare DNS) | Task 1.4 | Used through SMTP, so the provider can be swapped by changing env only. |
| Privacy policy, terms of use, medical disclaimer texts (Arabic) | Task 1.11 | Placeholders ship until the owner provides final text; OAuth apps need the URLs to exist. |

Not needed in Phase 1: AWS SES (owner decision), Meta WhatsApp Business API, Facebook Login app (Facebook ships as "coming soon").

---

## Decisions for this phase (record in ARCHITECTURE.md → Decision log)

1. **Better Auth handles authentication only** (core + `phone-number` + `two-factor` + `haveibeenpwned` plugins). **Organizations, roles, and permissions are our own tables**, not Better Auth's `organization`/`admin` plugins: we need DB-defined custom roles, fine-grained permission strings, audit on every change, and `scopedRepo` integration (ARCHITECTURE §4).
2. **Password hashing is Argon2id** via `@node-rs/argon2` (Better Auth's default is scrypt; override `password.hash`/`verify`). Parameters: `memoryCost 19456 KiB, timeCost 2, parallelism 1` (OWASP minimum), tunable by env.
3. **One session cookie** for web, `__Secure-wasfa.session`, `Domain=.wasfa.online; Secure; HttpOnly; SameSite=Lax`. The web server reads the session by forwarding the cookie to the API (`GET /me`); `web` never touches the DB (AGENT §4).
4. **Email via SMTP** (`nodemailer`) behind an `EmailTransport` interface. **Brevo free tier** (300/day) in production, a capture transport in dev/tests. Moving to Resend/Mailjet/any SMTP later is an env change. Email is the primary verification channel, so the daily cap is monitored (Task 1.4).
5. **Emails are sent by the worker** (`notifications` queue). The API only enqueues, so a slow provider never blocks a request.
6. **Phone verification by inbound WhatsApp message ("reverse OTP")**, not by sending codes. The user taps a `wa.me` link that opens WhatsApp with a pre-filled code and presses send. Our bridge (Baileys, linked device) **receives** it and checks that the sender's number equals the phone being verified. WhatsApp itself proves ownership of the sending number, so the code is only a correlation token. Our number never starts a conversation, which keeps ban risk as low as an unofficial client allows. Behind a `PhoneVerifier` interface: replace it with Meta Cloud API or SMS later without touching auth.
7. **Sign-in providers are a registry** (`google`, `facebook`, later `apple`) with status `enabled | coming_soon | disabled`. **Facebook ships as `coming_soon`**: a visible but disabled button with a "قريباً" badge. Enabling it later = add keys to env + flip the status in admin settings; no code change.

---

## Task 1.1 — Docs: DATABASE, SECURITY, DESIGN-SYSTEM

**Files:** `docs/DATABASE.md`, `docs/SECURITY.md`, `docs/DESIGN-SYSTEM.md`, `docs/AGENT.md` (doc map), `docs/ARCHITECTURE.md` (decision log)

Steps
1. `DATABASE.md`: conventions (snake_case, UUIDv7 via `uuidv7()`, `created_at`/`updated_at`, money as minor units, soft-delete policy: **none** except users → `deleted_at` + anonymization), a table index (Phase 0 + Phase 1 tables), the ownership column for each user-owned table, and the index list. Update it in every task that adds tables.
2. `SECURITY.md`: threat model (from ARCHITECTURE §8), plus a **mandatory per-endpoint checklist** (auth, permission, ownership, zod input, rate limit, size limit, Turnstile if public, audit if admin write, no PII in logs). Also a "carry-overs" section holding the Phase 0 open items (below) and the deferred `audit_logs` append-only DB role.
3. `DESIGN-SYSTEM.md`: tokens from `packages/ui/tokens.css`, type scale (Alexandria/Plex), spacing, radii, elevation, motion (durations, `prefers-reduced-motion`), RTL rules (logical properties, mirrored icons list), form patterns (labels, errors, field-level messages from `VALIDATION_FAILED.details.fields`), and empty/loading/error state patterns. Include screenshots/descriptions of `docs/references/*.png` as the visual target.
4. Add `ROADMAP.md` to the AGENT.md doc map; mark the three docs as written.

Acceptance
- [ ] The three docs exist, and every table and permission added in this phase is listed in them by phase end. *(The three docs exist and list everything through Task 1.2: 13 tables, 14 permissions, 6 system roles. Re-check and tick at phase end, after Tasks 1.5 and 1.11 add `wa_sessions` and `contact_messages`.)*
- [x] Decision log has entries for the seven decisions above (ARCHITECTURE §3 updated: WhatsApp OTP via Meta Cloud API → inbound "reverse OTP" via a linked-device bridge; Facebook deferred). *(Decisions #14-#20, plus #21 and #22 from Task 1.2; §2 gained the `wa-bridge` service and §4 the platform-vs-organization role split.)*

---

## Task 1.2 — Identity & organization schema

**Files:** `packages/db/src/schema/{auth.ts, users.ts, organizations.ts, rbac.ts, onboarding.ts}`, migration(s), `packages/db/src/seed-data.ts`, `packages/shared/src/permissions.ts`

Steps
1. Better Auth core tables via Drizzle (generate with `@better-auth/cli generate`, then hand-review): `users`, `accounts`, `sessions`, `verifications`, `two_factors`. Add app columns to `users`: `phone` (E.164, unique when verified), `phone_verified_at`, `account_type` (`individual | organization`), `locale`, `status` (`active | suspended | deleted`), `suspended_reason`, `deleted_at`, `last_login_at`.
2. `user_profiles` (user_id PK/FK, display name, profession enum: `pharmacist | doctor | nurse | student | patient | other`, usage_intent text[], country ISO-3166, city).
3. `organizations` (id, name, type `pharmacy | clinic | hospital | other`, country, city, created_by) and `organization_members` (org_id, user_id, role `org_admin | org_member`, unique pair, invited_by, joined_at), plus `organization_invites` (org_id, email/phone, token hash, role, expires_at, accepted_at).
4. RBAC: `roles` (key, name_ar, name_en, is_system), `role_permissions` (role_key, permission), `user_roles` (user_id, role_key, granted_by, granted_at). Permission strings are **not** a DB table; they live in `packages/shared/src/permissions.ts` as a typed const catalog (`users.read`, `users.suspend`, `users.roles.write`, `orgs.read`, `orgs.write`, `roles.write`, `settings.read`, `settings.write`, `flags.write`, `audit.read`, `issues.read`, `issues.write`, …) with Arabic/English labels for the admin UI.
5. `onboarding_progress` (user_id PK, current_step, completed_steps text[], data jsonb (validated per step), completed_at).
6. Seed system roles: `user`, `support`, `marketing`, `finance`, `admin`, `super_admin` with their permission sets (`super_admin` = all). The seed stays idempotent and never overwrites edited role permissions (insert-only, same as site settings).
7. Indexes: `users(email)` citext unique, `users(phone)` partial unique where verified, `sessions(user_id)`, `organization_members(user_id)`, `user_roles(user_id)`.

Acceptance
- [x] `pnpm db:generate` produces a clean migration; `db:migrate` + `db:seed` (twice) succeed on a fresh DB. *(`0003_identity_schema.sql`; a second `db:generate` reports "No schema changes". Fresh PostgreSQL 18 container: migrate, seed → "7 new site setting(s), 6 new role(s), 34 new role permission(s)", seed again → 0, 0, 0, migrate again OK.)*
- [x] Seed idempotency test extended to roles. *(`packages/db/test/seed.int.test.ts`: idempotent counts, every system role with its permission set and `super_admin` = whole catalog, and an admin's edits to a role survive a re-seed.)*

---

## Task 1.3 — Authentication in the API (Better Auth)

**Files:** `apps/api/src/auth/{auth.config.ts, auth.module.ts, auth.controller.ts, turnstile.ts, disposable-domains.ts, password.ts}`, `apps/api/src/config/env.ts`, `.env.example`

Steps
1. Mount Better Auth at `/auth/*` inside Nest/Fastify (convert the Fastify request to a Fetch `Request`, pass it to `auth.handler`, and copy status, headers, and `set-cookie` back). Use the Drizzle adapter on the existing pool, with `trustedOrigins = WEB_ORIGIN`.
2. Methods: email + password (email verification **required** before tool use; min length 10; `haveibeenpwned` check), Google, phone + password (`phone-number` plugin for storage and sign-in only; verification comes from Task 1.5, so the plugin's `sendOTP` is never used). Account linking is allowed only between verified identifiers.
3. Provider registry (`apps/api/src/auth/providers.ts` + setting `auth.providers`): each social provider has `status` and is configured only when its env keys exist. `GET /auth/providers` (public) returns `[{ id, status }]` for the web buttons. Facebook = `coming_soon`. A provider whose status is not `enabled` rejects its callback route.
4. **Turnstile** server verification (`turnstile.ts`, with the `remoteip` from `clientIp`) required on: register, password-reset request, phone-verification start, and login after 3 failures per identifier (failure counter in Redis, 15 min).
5. Rate limits (Redis, via `@RateLimit` or Better Auth `rateLimit` with Redis storage): login 10/15 min per IP + 5/15 min per identifier; register 5/hour per IP; reset 3/hour per identifier. All return `RATE_LIMITED`.
6. Disposable-email blocklist (bundled list + admin-extendable setting `auth.blockedEmailDomains`).
7. Sessions: 30-day sliding web sessions; **admins 12 hours**; `cookieCache` off (instant revocation); `last_login_at` updated on sign-in.
8. Errors from Better Auth are mapped to our `{ code, message }` shape (no Better Auth messages leak; Arabic by default).
9. New env: `BETTER_AUTH_SECRET` (≥32 bytes), `AUTH_COOKIE_DOMAIN`, `GOOGLE_CLIENT_ID/SECRET`, `FACEBOOK_CLIENT_ID/SECRET` (optional, unused while `coming_soon`), `TURNSTILE_SECRET_KEY`, `ARGON2_MEMORY_KIB` (default 19456). OAuth keys are optional: a provider without keys is never `enabled`. Add all of them to `.env.example`, the compose prod env, and the deploy secrets doc.
10. Password reset: by email link, or for phone-only accounts by the same inbound-WhatsApp proof as Task 1.5 (the reset is allowed only when the message arrives from the account's verified number).

Acceptance
- [x] Integration tests: register → verify email (captured) → login → `/me` → logout; wrong password ×N → Turnstile required → rate limited; phone + password sign-in for a verified phone. *(`apps/api/test/auth.int.test.ts`, 37 tests against real Postgres 18 and Redis 8. Two stand-ins until their own tasks: the mail is captured by a test `AuthMailer` (the worker-backed one and `CaptureTransport` are Task 1.4) and `/me` is a test route that calls `AuthService.getSession`, the service the real `/me` of Task 1.7 will use.)*
- [x] Password hashes in DB start with `$argon2id$`. *(Asserted with the exact parameters, and again on the production image.)*
- [x] Session cookie attributes asserted in tests (`HttpOnly`, `Secure`, `SameSite=Lax`, domain). *(`__Secure-wasfa.session; Domain=.wasfa.online; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age`.)*
- [ ] Google flow tested with a mocked provider (`msw` or a local OIDC stub); manual check against real Google in production. *(Mocked flow done with msw 2: new user, linking to a verified account, refusal for an unverified one, disposable address, and 2FA accounts. **The manual check against real Google is still open**: it needs the owner's OAuth client and the deployed API.)*
- [x] `GET /auth/providers` reports Facebook as `coming_soon`, and its callback route is rejected; a test flips it to `enabled` with fake keys and the route becomes active (proves "easy to add later"). *(Also: a provider with no keys is never `enabled`.)*

---

## Task 1.4 — Email sending (worker, Brevo free tier)

**Files:** `packages/shared/src/queues.ts` (new `notifications` queue), `apps/worker/src/notifications/{email.ts, templates/*}`, `apps/worker/src/config/env.ts`

Steps
1. Queue `notifications` with job `email.send` (template key + locale + params). Payloads are zod schemas. Links that carry a token (verify email, reset password, invite) pass the token **encrypted** (`encryptSecret`, context `email:<template>`). Move `crypto.ts` to `packages/shared` so the worker can decrypt, and update REUSE-INDEX.
2. `EmailTransport` interface: `SmtpTransport` (nodemailer, TLS required) configured for **Brevo SMTP relay** (`smtp-relay.brevo.com:587`, login + SMTP key from env), and `CaptureTransport` (dev/tests: stores the last N messages in Redis with a 10 min TTL; refuses to start when `NODE_ENV=production`). Env: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` (`"وصفة AI" <no-reply@wasfa.online>`), `MAIL_DAILY_CAP` (default 280, a margin under Brevo's 300).
3. **Daily cap guard:** a Redis counter per UTC day. Over the cap, non-critical mail (invites, suspension notices) is delayed to the next day, while verification and reset mail still try to go out; an admin alert fires at 80 %. Upgrading Brevo or switching provider is an env change only.
4. Arabic-first email templates (RTL HTML + plain text): verify email, reset password, org invite, account suspended. Strings go through i18n keys; layout uses brand tokens; no remote images or tracking pixels (logo as text or inline CID).
5. Deliverability: SPF, DKIM (Brevo-provided), and DMARC `p=quarantine` in Cloudflare DNS; a test mail to mail-tester.com scores ≥ 9/10. Check on the Brevo dashboard whether the free plan adds Brevo branding to transactional mail, and record the result in Notes.
6. Retries with backoff; permanent failures go to `failed` with a redacted reason; one log line per send (recipient hashed, never the address).
7. Per-queue concurrency from env (pattern from Task 0.5).

Acceptance
- [x] Worker integration test: an enqueued email lands in `CaptureTransport` with the correct RTL template; an invalid payload is rejected by schema. *(`apps/worker/test/email.int.test.ts`, real Redis 8; template unit tests in `email.units.test.ts`.)*
- [x] No plaintext token in Redis job data, logs, or `error_events` (test greps for it). *(Greps `bull:notifications:*` including failed history, and the log output. The worker has no `error_events` writer. `apps/api/test/notifications.int.test.ts` proves the api side through a real sign-up.)*
- [x] Cap guard test: the 281st non-critical mail of the day is delayed, and a verification mail still sends. *(Guard test with cap 280, and a job-level test with cap 2: the third invite is `delayed` with `attemptsMade = 0`, a verification mail still goes.)*
- [ ] mail-tester.com score ≥ 9/10 from production. *(Brevo domain authenticated (DKIM x2, SPF, DMARC, brevo-code), sender active, SMTP key tested from the workstation: `250 OK`. The mail-tester run itself still waits for the deploy of this branch.)*

---

## Task 1.5 — Phone verification via inbound WhatsApp ("reverse OTP")

**Files:** `apps/worker/src/wa-bridge/{main.ts, auth-state.ts, inbound.ts, guard.ts}`, `apps/api/src/phone/{phone.module.ts, phone.controller.ts, phone.service.ts, phone-verifier.ts}`, `packages/shared/src/schemas/phone.ts`, `packages/db/src/schema/wa-sessions.ts`, `infra/docker/compose.prod.yml`

How it works
```
user enters phone ──► POST /phone/verify/start  (Turnstile, rate-limited)
                       └─ creates challenge { userId, phone, code (6 digits), expires 10 min }
                       └─ returns wa.me/<OUR_NUMBER>?text=<"رمز التحقق في وصفة AI: 482913">
user taps link ──► WhatsApp opens with the text pre-filled ──► user presses Send
wa-bridge (Baileys, linked device) receives the message
  └─ sender number (remoteJidAlt / LID→PN map) + code ──► Redis stream ──► api
api: challenge found AND sender number == claimed phone AND not expired
  └─ mark phone verified (unique per active account) ──► web sees it (polls /phone/verify/status every 2 s)
```
The code is not a secret: anyone can read it on the screen. The proof is that **the message came from that WhatsApp number**, which only its owner can send from.

Steps
1. **Spike first (1 day, before building the rest):** with Baileys 7 and two real test numbers, confirm that a 1:1 inbound message from a contact who is *not* in the bridge's address book exposes the sender's phone number (`remoteJidAlt`, or the LID→PN mapping). If the phone number cannot be resolved reliably, stop and write it in Open questions (fallback: email-only verification in Phase 1).
2. `wa-bridge`: a separate long-running process in the worker image (`node dist/wa-bridge/main.js`), exactly **one** replica, its own compose service (`internal` network + outbound internet; no ports). Library: `@whiskeysockets/baileys` (no browser, so the image stays small, unlike `whatsapp-web.js`, which needs Chromium).
3. Linking: a one-off admin command prints the pairing QR/code in the container logs; the owner scans it from the WhatsApp Business app on the dedicated phone (**linked device**; the phone stays the primary device). Auth state is stored **encrypted** (`encryptSecret`) in Postgres (`wa_sessions` table), not on disk, so the read-only container survives restarts.
4. Inbound handler: only 1:1 text messages; ignore groups, statuses, broadcasts, media, and calls. Parse `/\b(\d{6})\b/`, resolve the sender to E.164, and push `{ phone, code, receivedAt }` to a Redis stream (`wa:inbound`, `MAXLEN ~10000`). Never log the phone in clear (hash only).
5. API `PhoneVerifier` interface with `WhatsAppInboundVerifier` as the first implementation (a Meta Cloud API or SMS verifier can be added later behind the same interface): `POST /phone/verify/start`, `GET /phone/verify/status`, and a stream consumer that resolves challenges. Rules: 10-minute TTL, max 3 starts per hour per user, per phone, and per IP, constant-time code compare, single use, messages from the wrong sender ignored (and counted for abuse alerts).
6. **Anti-ban rules (enforced in `guard.ts`, documented in SECURITY.md):**
   - Our number **never starts a conversation**, never sends to a number that did not message first in the last 24 h, never joins groups, never posts statuses, and never sends media or links.
   - At most **one short reply** per verification ("تم التحقق ✅" or "الرمز غير صحيح أو منتهي الصلاحية"), sent only in the user's own conversation, after a random 2–6 s delay with a typing indicator. Global reply cap: 1 per 3 s and 300 per day; above the cap, stay silent (the web UI shows the result anyway).
   - Mark inbound messages as read; the phone app has a complete business profile (name, logo, description, website) and an auto-greeting.
   - Stable identity: one linked session, one server IP, no frequent re-pairing; reconnect with exponential backoff; on `loggedOut`, stop and alert the admin, and **never** auto-re-pair.
   - Kill switch: setting `auth.phoneVerification` = `whatsapp_inbound | disabled`. If the bridge is down or the number is restricted, the UI hides phone verification and email verification keeps working, so a ban is an inconvenience, not an outage.
7. Health: the bridge writes a heartbeat key (`wa:heartbeat`) and its connection state; `/health/ready` does not depend on it (logged only); the admin dashboard shows "WhatsApp: connected / disconnected / logged out".
8. Desktop users: the verification page also shows the `wa.me` link as a QR code to scan with their phone.

Acceptance
- [ ] Spike result recorded in Notes (sender number resolution works on Baileys 7, with versions). *(**Not done: needs two real WhatsApp numbers.** Baileys `7.0.0-rc14` is installed and the code is written for both resolution paths (`remoteJidAlt`, and the LID-to-phone mapping); until the spike runs, an unresolvable sender is ignored, so the failure mode is "nobody can verify", never a wrong verification. See Notes.)*
- [x] Integration test with a fake inbound stream: right sender + right code → verified; right code from another number → not verified; expired code → not verified; replayed code → not verified; 4th start in an hour → `RATE_LIMITED`. *(`apps/api/test/phone.int.test.ts`, 18 tests on real Postgres and Redis, entries pushed to `wa:inbound`. Also: phone already verified elsewhere, two accounts claiming one number, malformed entries, per-number and per-IP limits, Turnstile.)*
- [x] Guard unit tests: no outbound send without a matching inbound message in the last 24 h; reply caps enforced. *(`apps/worker/test/wa-bridge.int.test.ts`, real Redis: no reply to a chat or message id never received, one reply per message, groups and links refused, 2-6 s delay with 3 s spacing, 300 a day. Parsing: `wa-bridge.units.test.ts`.)*
- [ ] Manual end-to-end on production with the real number: verify two different phones; restart the bridge container and verify again without re-pairing. *(Owner action: DOCKER-GUIDE 3.9. The auth state is tested to survive a restart against Postgres, and the production image was booted with Postgres and Redis, but never against WhatsApp.)*
- [x] Bridge down (kill switch) → verification UI hidden; the rest of the app works. *(`GET /phone/verify/status` returns `available: false` with the reason for the setting off, missing number, missing or logged-out heartbeat; start is refused; `/health/ready` and sign-up still work. The UI itself is Task 1.9.)*

> **Honest risk note.** Baileys is an unofficial WhatsApp client; using it is against WhatsApp's Terms of Service, and no technique removes ban risk entirely. Inbound-only, low-volume use on a warmed-up business number is the lowest-risk pattern, and the design above makes a ban recoverable (new number + re-pair, or move to Meta's Cloud API through the same `PhoneVerifier` interface). Never use the owner's personal number.

---

## Task 1.6 — Request identity, RBAC, audit

**Files:** `apps/api/src/common/{auth.guard.ts, permissions.guard.ts, current-user.ts, origin.guard.ts, fresh-auth.ts, scoped-repo.ts}`, `apps/api/src/audit/*`, `apps/api/src/rbac/*`

Steps
1. Global `AuthGuard` (**deny by default**) resolving the Better Auth session; `@Public()` opts out (health, public settings, auth routes). Suspended/deleted users → `AUTH_REQUIRED` and session destroyed.
2. `@CurrentUser()` decorator → `{ id, roles, permissions, orgIds, twoFactorEnabled, emailVerified, phoneVerified }`; permissions resolved from DB and cached in Redis (5 min TTL, busted on role change).
3. `@RequirePermission(...perms)` guard; admin routes live under `/admin/*` and additionally require `twoFactorEnabled` and a 2FA-verified session.
4. `@RequireFreshAuth(minutes)` for dangerous actions (role changes, suspensions, settings with secrets): the session must have re-authenticated (password or TOTP) within N minutes. Otherwise `AUTH_REQUIRED` with `details.reason = "reauth"`.
5. `OriginGuard`: for non-GET requests with a cookie session, `Origin` (or `Referer`) must be in `WEB_ORIGIN` (CSRF defense in depth, ARCHITECTURE §3).
6. `AuditService.record({ actorId, action, targetType, targetId, before, after, ip, userAgent })` and an `@Audited(action)` interceptor that captures before/after for admin writes; values pass through `redactText`/field allowlist (no secrets in `before/after`).
7. `scopedRepo(userId | { orgId, membership })` helper: every query on user-owned data goes through it (AGENT §5.4). Add a lint-able convention: repo files only, never raw `db.select` in services.
8. DB role carry-over: create a restricted DB role for the API that **cannot UPDATE/DELETE `audit_logs`** (migration + compose env change). Document it in SECURITY.md.

Acceptance
- [x] A test module with one route per guard proves: anonymous → 401, missing permission → 403, admin without 2FA → 403, stale auth → `reauth`, foreign Origin → 403. *(`apps/api/test/access.int.test.ts`, 21 tests on real Postgres and Redis, with the API connected as the restricted database role. Also: a 2FA session that predates the second factor, an `/admin` route without a permission, a suspended user, the permission cache and its busting, the Referer fallback.)*
- [x] Every admin write in this phase creates an `audit_logs` row (asserted per endpoint). *(There are no admin write endpoints yet; the mechanism is proven on probe routes: `@Audited` row with actor, target, IP, agent and redacted before/after; nothing is written when the action fails. **From Task 1.7/1.8 on, every new admin write adds its own assertion.** The security events that exist today (password change, 2FA enable/disable, backup codes) are audited and tested.)*
- [x] `UPDATE audit_logs` as the API DB role fails. *(`42501` for UPDATE, DELETE and TRUNCATE, in `packages/db/test/api-role.int.test.ts` and through the API's own connection in `access.int.test.ts`.)*
- [x] Wrong-owner access test pattern exists and is used by Task 1.7 endpoints. *(`wrongOwnerIsHidden` in `apps/api/test/support/wrong-owner.ts`, demonstrated on a `scopedRepo` route; Task 1.7 must use it for every owner-scoped endpoint.)*

---

## Task 1.7 — Users, organizations, onboarding API

**Files:** `apps/api/src/{users,orgs,onboarding}/*` (module shape per AGENT §6), `packages/shared/src/schemas/{user.ts, org.ts, onboarding.ts}`

Steps
1. `GET /me` (profile, roles, permissions, onboarding state, verification flags), `PATCH /me` (name, locale), `GET/DELETE /me/sessions` (list + revoke others), `DELETE /me` (account deletion request → anonymize after 14 days via worker job; immediate session kill).
2. Onboarding state machine (ARCHITECTURE §3): `account_type → phone (if missing; verified via Task 1.5, skippable when `auth.phoneVerification = disabled` and the email is verified) → name → organization (if org) → profession & intent → plan_picker (placeholder: "free" only until Phase 2) → social_follow (optional) → done`. `GET /onboarding`, `PUT /onboarding/:step` (zod per step; steps cannot be skipped except optional ones), resumable.
3. Organizations: create (during onboarding), `GET /orgs/:id`, update (org_admin), members list, invite by email/phone (token, 7-day expiry, single use), accept invite, remove member, leave org. Every query goes through ownership/membership checks.
4. "Tools require": a `@RequireVerified()` guard (email **or** phone verified + onboarding done) for Phase 2 tool routes, built and tested now.
5. One-free-account-per-verified-phone: a phone can be verified on only one active account (DB constraint + friendly error).

Acceptance
- [x] Integration tests for every endpoint: happy path, unauthenticated, wrong owner / non-member, invalid input, rate limit (AGENT §7). *(`users.int` 35, `onboarding.int` 38, `orgs.int` 91, `onboarding.units` 26; worker `accounts.int` 11. Endpoints without an id or a body have no wrong-owner / invalid-input case.)*
- [x] Onboarding resume works after logout/login mid-wizard. *(`onboarding.int.test.ts`: sign out mid-wizard, sign in, same step and answers.)*

---

## Task 1.8 — Settings & feature flags service

**Files:** `packages/shared/src/settings.ts`, `apps/api/src/settings/*`, `apps/api/src/flags/*`

Steps
1. Typed registry: each `site_settings` key has a zod schema + default + visibility (`public | admin`) in `packages/shared/src/settings.ts` (branding, contact, socials, locale, currency, access, free_tier, auth).
2. `SettingsService.get(key)`: Redis cache (TTL 10 min, every key has a TTL per decision #11) → DB → default. Writes validate, audit, bump cache, and publish an invalidation message (Redis pub/sub) for other API replicas.
3. `GET /settings/public` (public, cacheable `max-age=60`): only `public` keys; used by web for contact hub, branding, socials.
4. `maintenanceMode` and `signupOpen` enforced in the auth/register paths and a global guard (admins bypass maintenance).
5. Feature flags: rule evaluation `all | user | org | percentage` (stable hash of user id); `plan` targeting type defined and evaluated once plans exist (Phase 2). `GET /flags` returns flags for the current user.

Acceptance
- [x] Invalid setting value is rejected with field paths; a write invalidates the cache (test reads new value immediately). *(`settings.int.test.ts`, including a second app instance on the same Redis seeing the change through pub/sub.)*
- [x] Percentage rollout is stable for the same user across calls. *(`flags.units.test.ts`: stable per user, independent per flag key, proportional within 3 points over 10 000 ids.)*

---

## Task 1.9 — Web: auth, onboarding, dashboard shell, account

**Files:** `apps/web/src/app/(auth)/*`, `apps/web/src/app/(app)/{dashboard,onboarding,account}/*`, `apps/web/src/lib/{api-client.ts, session.ts}`, `packages/ui/src/*` (new primitives), `packages/shared/src/i18n/ar.ts`

Steps
1. `api-client.ts`: typed fetch wrapper (credentials `include`, `Accept-Language`, zod-parsed responses using shared schemas, maps `{ code, ref }` to `ApiRequestError`). Server-side variant forwards the incoming cookie to `GET /me`.
2. Route protection in `proxy.ts`: `(app)` routes without a session cookie → `/login?next=…` (only same-origin relative `next`, open-redirect safe). The authoritative check is server-side via `/me`; onboarding not done → `/onboarding`.
3. Pages: login (email/phone tabs, Google, Facebook button disabled with a "قريباً" badge, all driven by `GET /auth/providers`), register, verify email, phone verification (big "open WhatsApp" button, QR code for desktop, live "waiting for your message…" state, success/expired/retry states), forgot/reset password, Turnstile widget (explicit render, CSP nonce, `challenges.cloudflare.com` added to CSP via env).
4. Onboarding wizard: one step per screen, progress indicator, back/next, server-saved, resumable; RTL-correct; 360 px first.
5. Dashboard shell: sidebar (collapsible, mirrored for RTL) + top bar (account menu), empty-state home ("tools arrive soon" placeholder cards for Phase 2), and the floating contact hub.
6. Account: profile, password change, sessions list with revoke, 2FA setup (QR + backup codes, shown once), delete account (re-auth + typed confirmation).
7. New `packages/ui` primitives: `Input`, `Field` (label + hint + error), `Select`, `Checkbox`, `Dialog`, `Toast`, `Tabs`, `Avatar`, `Badge`, `Skeleton`, `EmptyState`. All accessible (labels, focus, ARIA), tokens only, logical properties. Register each in REUSE-INDEX.
8. All strings via `t()`; forms show field errors from `details.fields`; every error screen shows the `WSF-` ref when present.

Acceptance
- [ ] Playwright E2E: register (email) → verify (capture transport) → onboarding (individual + organization paths) → dashboard; phone verification with a fake inbound stream; Facebook button visible and disabled; logout; revoke other session.
- [ ] Axe (Playwright) has no serious/critical violations on auth, onboarding, dashboard, and account pages, at 360 px and 1440 px.
- [ ] No CSP violations in the console with Turnstile loaded.

---

## Task 1.10 — Admin v1

**Files:** `apps/api/src/admin/{users,orgs,roles,settings,flags,audit,issues}/*`, `apps/web/src/app/admin/*`

Steps
1. API (all `/admin/*`, permission-gated, audited, 2FA-required): users search (email/phone/name, paginated, cursor), user detail (profile, roles, orgs, sessions, recent audit), suspend/unsuspend (kills sessions, notifies the user, reason required, fresh auth), assign/revoke roles (fresh auth; cannot remove the last `super_admin`), orgs list/detail, roles CRUD (custom roles, `super_admin` only), settings read/write (by registry), flags CRUD, audit log query (filters: actor, action, target, date), Issues (error_events grouped by fingerprint: count, first/last seen, affected users, status change, human explanation per error code).
2. Web `/admin`: layout matching `docs/references/1.png` (dense, calm, data-first), permission-aware nav (UI hides what the API would reject), tables with server pagination + filters in the URL, detail drawers, confirm dialogs for dangerous actions with reason fields, re-auth modal on `reauth`.
3. Bootstrap the first super admin with a one-off CLI (`pnpm --filter @wasfa/api admin:grant <email>`), run via the `migrate`-style tools container in production and audited as `system`.

Acceptance
- [ ] Integration tests per admin endpoint (permission denied, 2FA missing, audit row written, fresh-auth enforced where marked).
- [ ] Playwright: admin suspends a user → that user's open session gets 401 on the next request.
- [ ] Issues page groups a thrown test error and lets the admin mark it resolved (audited).

---

## Task 1.11 — Public front door: landing v1, legal, contact hub

**Files:** `apps/web/src/app/(marketing)/{page.tsx, privacy, terms, disclaimer, contact}/*`, `apps/web/src/components/marketing/*`

Steps
1. Landing page v1 (flagship, AGENT priority 2 + 3): hero with value proposition + primary CTA (register) + secondary (how it works); how-it-works (3 steps: upload → analyze → structured result); feature sections (prescription analysis, AI assistant skills, organizations); trust (privacy, private storage, medical disclaimer, "assists, does not diagnose"); FAQ (6–8 Arabic questions) with `FAQPage` JSON-LD; final CTA. `Organization` + `WebSite` + `SoftwareApplication` JSON-LD. Copy lives in i18n/content files, not components.
2. Visual direction from `docs/references/2.png` / `3.png` and DESIGN-SYSTEM.md; motion subtle and `prefers-reduced-motion`-safe; images via `next/image` (AVIF/WebP, explicit sizes); no layout shift.
3. Legal pages: privacy (incl. data-retention consent per decision #8, Egypt 151/2020 / KSA / UAE PDPL references), terms, medical disclaimer, with owner-supplied text (placeholders until then, clearly marked).
4. Contact page (form → stored as a `contact_messages` row, Turnstile, rate-limited; becomes tickets in Phase 4) and the floating contact hub (WhatsApp / Telegram / phone from public settings, hidden when empty).
5. Sitemap includes the new public pages; canonical + Open Graph images per page.

Acceptance
- [ ] Lighthouse mobile on `/`: Performance ≥ 95, SEO 100, Best Practices 100, Accessibility ≥ 95 (Lighthouse CI step added to CI for `/`).
- [ ] Rich Results Test passes for FAQPage and Organization.
- [ ] RTL verified at 360 px and 1440 px; no hard-coded Arabic in components (content files only).

---

## Task 1.12 — Phase 0 carry-overs

Steps
1. API image < 200 MB (currently 214 MB): `pnpm deploy --prod` audit, drop dev-only deps from the runtime layer, check for duplicate packages (e.g. two `fastify`), or document an accepted size in Notes with owner sign-off.
2. Branch protection: run `infra/scripts/protect-main.sh` when the repo is public or on GitHub Pro; until then keep the convention and note it.
3. Live checks on the real server: direct-IP request refused, `ssh root` / password login fail, SSL Labs A+, securityheaders.com ≥ A, a real R2 backup object exists and the restore drill passes. Tick the Phase 0 boxes with evidence.

Acceptance
- [ ] Phase 0 checklist fully ticked, or each remaining item has a written owner decision.

---

## Phase 1 final checklist

- [ ] All task acceptance boxes ticked.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, Playwright E2E, and CI all green; deployed to production through the normal pipeline, with migrations run by the `migrate` container.
- [ ] `docs/REUSE-INDEX.md`, `DATABASE.md`, `SECURITY.md`, `DESIGN-SYSTEM.md` up to date.
- [ ] SECURITY.md per-endpoint checklist filled for every new endpoint.
- [ ] Summary written below with any deviations.

## Notes
- **Task 1.1 (docs)**
  - `DATABASE.md`, `SECURITY.md`, `DESIGN-SYSTEM.md` written; `AGENT.md` doc map and `REUSE-INDEX.md` updated; `ARCHITECTURE.md` §1-§4 corrected and decisions #14-#22 logged. Docs are not prettier-formatted (the committed ones are not either, and CI does not check them).
  - Added to `packages/ui/tokens.css` so `DESIGN-SYSTEM.md` matches the code: motion tokens (`--motion-fast/base/slow`, `--ease-standard`).
  - **Contrast measured from the tokens** (recorded in DESIGN-SYSTEM §3.2): `accent` on white is only 2.54:1 (never text) and `--color-border` is 1.41:1, so **input borders must use `neutral-400` (3.13:1)** to meet WCAG 1.4.11. Success/warning chips sit at 4.5-4.6:1, right at the AA limit.
  - `VALIDATION_FAILED.details.fields` carries **field paths only** (the Phase 0 pipe never echoes values), so DESIGN-SYSTEM §6 specifies that per-field text comes from running the shared zod schema in the browser, with a generic message as the fallback.
  - Rules the plan did not state, written into SECURITY.md §5 because the plan's `admin` role could otherwise promote itself: an actor may grant a role only if they already hold every permission in it; only `super_admin` may grant, revoke or edit `super_admin`; nobody changes their own roles. Task 1.10 must implement and test them.
  - Open items found while writing SECURITY.md §11 and given an owner task: OAuth tokens in `accounts` must be encrypted (`account.encryptOAuthTokens`, Task 1.3); the rate limiter fails open when Redis is down and must fail closed on auth routes (Task 1.3); unknown routes are not rate limited (Task 1.3); a purge job for expired `sessions`/`verifications` (Task 1.7).
- **Task 1.2 (identity schema)**
  - Migration `0003_identity_schema.sql`: 13 new tables. **Better Auth tables are hand-written from the reference output of `@better-auth/cli generate` (better-auth 1.7.7, run in a scratch directory because the real auth config only arrives in Task 1.3).** Differences from the CLI output: UUIDv7 keys with a database default, `timestamptz`, a unique `(provider_id, account_id)` on `accounts`, no index on `two_factors.secret`. `two_factors` has three columns beyond the plan that Better Auth 1.7 expects: `verified`, `failed_verification_count`, `locked_until` (TOTP brute-force lockout).
  - **Verified against the real library**: a scratch Better Auth 1.7.7 instance (Drizzle adapter, `advanced.database.generateId: false`, phone-number plugin remapped to `phone`/`phone_verified`, two-factor plugin) signed up and signed in against the migrated schema; the user id came back as a database-generated UUIDv7. The Task 1.3 auth config therefore needs: `generateId: false`, a plural/explicit schema map (`user → users`, ...) and `schema.user.fields: { phoneNumber: "phone", phoneNumberVerified: "phoneVerified" }` on the phone plugin.
  - **Phone columns**: `phone`, `phone_verified` (the plugin's boolean) **and** `phone_verified_at` (ours), kept consistent by CHECK `users_phone_verified_sync_check`, so the two can never disagree. Partial unique index on `phone` where verified, plus a plain `phone` index for sign-in lookups.
  - **Columns beyond the plan**: `users.anonymized_at` (lets the worker find accounts due for anonymization and stay idempotent; Task 1.7), `users.phone_verified`, `organization_invites.invited_by` and `created_at`. `account_type` is `NOT NULL DEFAULT 'individual'` (the onboarding step confirms it) so no code path has to handle "unset". `user_profiles.display_name` is optional and falls back to `users.name`, which Better Auth requires.
  - **Indexes**: the plan's `user_roles(user_id)` is not created because the composite primary key `(user_id, role_key)` already serves it; `user_roles(role_key)` was added instead (last-`super_admin` check). Added `accounts_provider_account_key`, `users_phone_idx`, `users_pending_anonymization_idx`.
  - **Value sets live in `@wasfa/shared`** (`identity.ts`, `permissions.ts`), not in `packages/db`, and the same tuples type the columns and build the CHECK constraints (`inList`, `arrayWithin`, `matches`), so the DB, the zod schemas of Task 1.7 and the web forms cannot drift. Regexes are written without backslashes so the DB can inline `.source`. `LOCALES` was added to `i18n`.
  - **Permission catalog** (14): the plan's list plus `roles.read` and `flags.read` (the role editor and flag list need a read permission that is not the write permission). Nothing is added "for later": each phase adds its own.
  - **Seed**: `seedDefaults()` now returns `{ settings, roles, rolePermissions }`. It is insert-only; a role's permissions are seeded **only in the transaction that creates the role**, so removing a permission in the admin panel is never undone by a deploy. Consequence (documented in DATABASE.md): permissions added in later phases reach existing roles through a data migration or the role editor; `super_admin` will be a wildcard in the resolver (Task 1.6).
  - **Tooling**: the shared package's `exports` gained a `default` condition because `drizzle-kit` loads the schema through CommonJS (Node 24 `require()`s the ESM build); the root `db:generate` now builds `@wasfa/shared` first, like `db:migrate`.
  - **Tests**: `packages/db/test/identity-schema.int.test.ts` (17 tests) asserts every constraint by name against a real PostgreSQL 18; `packages/shared/test/permissions.test.ts` (catalog, patterns). Totals: shared 42, db 20, api 38, web 11, worker 9, all green; workspace `lint`, `typecheck` and the web build pass.
  - Prettier reformatted three unrelated shared files while formatting; those were reverted, so the diff holds only intended changes.

- **Task 1.3 (authentication)**
  - **Better Auth 1.7.7, pinned exactly.** Mounted by `AuthController` at `/auth/*`: each request is matched against an **allowlist** (`AUTH_ROUTES`), its body re-parsed with a shared zod schema (unknown keys dropped), rate-limited and Turnstile-checked, converted to a Fetch `Request`, and the answer translated back (cookies and redirects pass through, errors become our `{ code, message, details }`, the raw session token and full user rows are removed). Anything not on the list answers 404, which includes every Better Auth route we do not use (user update/delete, change-email, account linking, session list, admin, phone OTP).
  - **Deviation: the `phone-number` plugin is not used.** Its sign-in checks "verified?" *before* the password (anyone could learn that a number is registered-but-unverified), looks up by phone alone although unverified phones are not unique, and adds a second OTP path. `phone-plugin.ts` is a small Better Auth plugin of our own: registration with a placeholder email (`p<hex>@phone.wasfa.invalid`, never mailed) and a session so the phone can be verified next (Task 1.5); sign-in by **verified** phone only, always one password verification (dummy hash if the account is missing), one identical error. The path is `/sign-in/phone-number` on purpose: Better Auth's two-factor hook is keyed on it, and a test proves phone sign-in also hits the TOTP challenge.
  - **Phone-only password reset** (step 10) is **not** done here: it depends on the inbound-WhatsApp proof of Task 1.5. Email reset is done.
  - **Turnstile** is sent in the `x-turnstile-token` header (bodies stay untouched). Required on register (email and phone), reset request, resend verification, and sign-in after 3 failures per identifier. Errors: `VALIDATION_FAILED` with `details.reason = turnstile_required | turnstile_failed`. Verified server-side with the real client IP; fails closed. The phone-verification start joins in Task 1.5. No key = off (local only); the env schema requires it in production.
  - **Rate limits** are our own Redis counters (Better Auth's limiter is off) and **fail closed**: login 10/15 min per IP + 5/15 min per identifier, register 5/h per IP (email and phone share it), reset and resend 3/h per identifier + 10/h per IP, plus per-IP limits on every other route. Keys hold a hash of the identifier, never the email or phone. Phase 0 carry-overs closed here: requests to unknown routes are limited (20/min per IP, `limitUnknownRoutes`) and the auth limits no longer fail open.
  - **Sessions**: 30-day sliding, `cookieCache` off, cookie `__Secure-wasfa.session` on the shared domain (Better Auth ignores `cookiePrefix` for a custom cookie name, so the full name is configured). Admins (any platform role) get 12 h, **absolute**: set at creation, and `AuthService.getSession` ends an admin session older than 12 h whatever the sliding refresh did. `AuthService.getSession` also ends the sessions of suspended and deleted users (Better Auth does not expose our `status` column, so it is read from the database). `last_login_at` is written when a session is created; a suspended user cannot sign in (`FORBIDDEN`, reason `account_suspended`).
  - **2FA**: the plugin is on and its five endpoints are allowlisted. Better Auth runs the TOTP challenge for **password** sign-ins only, so an account with 2FA enabled **cannot use Google** (`session.create` hook, reason `two_factor_use_password`); otherwise a social login would hand an admin a full session without TOTP. The "2FA-verified session" check for `/admin/*` is Task 1.6.
  - **Account linking**: Google links only to an existing account whose email is verified (Better Auth's `requireLocalEmailVerified`, now pinned). My own pre-takeover hook turned out to be redundant and was removed. Consequence, accepted and tracked (SECURITY.md §11): the real owner cannot use Google while a squatter's unverified account holds the address, until the purge job (Task 1.7).
  - **No enumeration, tested**: repeated registration answers like a first one (Better Auth's generic duplicate response, which also means a **403 raised during sign-up is turned into a fake success**; "sign-up closed" therefore uses a 400 code that our mapper presents as `FORBIDDEN`); wrong password and unknown account give identical bodies; reset requests for unknown addresses answer the same; unverified phone, wrong password and unknown phone are identical. Mail is never awaited.
  - **Disposable domains**: bundled list (~120) plus `auth.blockedEmailDomains`; also covers Google sign-ups, since the check is in the user-creation hook. `signupOpen=false` is enforced in the same hook (so social sign-ups too). The `auth` setting is now seeded (`providers`, `blockedEmailDomains`, `phoneVerification`); `AuthSettingsReader` reads `auth` and `access` straight from the database with a 15 s cache until Task 1.8's `SettingsService` replaces it.
  - **Breached passwords** (Have I Been Pwned, k-anonymity): enabled for register (email and phone), change and reset. It **fails closed** when the service is unreachable (Better Auth returns an error); recorded in SECURITY.md §11 as a decision to revisit.
  - **Mail**: the auth module depends on an `AuthMailer` port. Without an implementation it logs an error instead of sending (`UnconfiguredMailer`), so **verification and reset mail work only after Task 1.4**. Verification links are single-hour, do not auto-sign-in, and a correct-password sign-in to an unverified account sends a fresh link (limited by the login limits).
  - **Env** (all in `.env.example`, `compose.prod.yml` and the deploy guide): `BETTER_AUTH_SECRET` (≥ 32 chars), `API_PUBLIC_URL` (**added; not in the plan**: Better Auth builds links and callbacks from it), `AUTH_COOKIE_DOMAIN`, `ARGON2_MEMORY_KIB`, `TURNSTILE_SECRET_KEY`, `GOOGLE_*`, `FACEBOOK_*`. Cross-field checks in the schema: OAuth keys in pairs; the cookie domain must cover every web origin and the API host; production requires the cookie domain, Turnstile, and https. **Owner action before the next deploy:** `compose.prod.yml` now requires `BETTER_AUTH_SECRET` and `TURNSTILE_SECRET_KEY` in `.env.prod` (the stack will not start without them). A dev `BETTER_AUTH_SECRET` was appended to the gitignored local `.env`.
  - **Dependencies and images**: `better-auth` is pinned; `@node-rs/argon2` (its Alpine/musl binary loads in the production image, checked); `msw` 2 for the network doubles; `kysely` is now an explicit dependency of `api` and `db` because Better Auth's peers otherwise created a second copy of `drizzle-orm` with incompatible types. Better Auth lists 18 optional peer dependencies, and `auto-install-peers` resolved Next, React, Vite and TypeScript into the API's production dependencies (**image 678 MB**). `.pnpmfile.cjs` now drops every Better Auth peer except `drizzle-orm`; the three Dockerfiles copy it before `pnpm install --frozen-lockfile` (the lockfile records its checksum, and the install fails without it). API image **228 MB** (Phase 0: 214 MB; the 200 MB carry-over target is still open), worker 194 MB.
  - **Verified**: workspace `lint`, `typecheck`, `test` (API 102 = 37 auth integration + 21 auth unit + env and Phase 0 tests; shared 42; db 20; web 11; worker 9). The production API image was also booted against real Postgres, Redis, Cloudflare Turnstile (their always-pass test secret) and the real breached-password service: register, a breached password rejected (`password_compromised`), unverified sign-in refused, a non-allowlisted route 404, Argon2id hash in the database, UUIDv7 user id.

- **Task 1.4 (email)**
  - **Flow**: `QueueMailer` (the real `AUTH_MAILER`) and `EmailQueue` in `apps/api/src/notifications/` put `email.send` on the new `notifications` queue; the worker's `emailSendJob` decrypts, renders, takes a slot from the daily cap, and sends through the transport. The payload is a zod discriminated union per template (`packages/shared/src/email.ts`), validated by the producer and again by the worker.
  - **Deviation: the whole link is encrypted, not just the token.** Better Auth hands us a finished URL, so `encryptedLink` carries the URL (AAD `email:<template>`); nothing is parsed out of it. The recipient address is still plain in job data (SECURITY.md section 11).
  - `crypto.ts` moved to `@wasfa/shared/crypto` (not re-exported from the package root, which the web app imports); `decodeEncryptionKey` added. The worker now requires `ENCRYPTION_KEY` and, in production, `SMTP_HOST/USER/PASS`.
  - **Transports**: `SmtpTransport` (nodemailer; STARTTLS required on 587, implicit TLS on 465, TLS 1.2+, file/URL access off) and `CaptureTransport` (last 50 messages in Redis for 10 min, throws when `NODE_ENV=production`). Errors are reduced to the SMTP code (`SMTP rejected the message (550)`) because the provider text can echo the address. A 5xx answer or bad credentials is permanent (`UnrecoverableError`, no retries); anything else retries (the api queues mail with 5 attempts, exponential 10 s).
  - **Cap guard**: Redis counter per UTC day (`mail:count:YYYYMMDD`). Over the cap, critical mail (verify, reset) still sends and logs a warning; the rest is moved to the delayed set until the next UTC midnight plus up to 5 minutes of jitter, through a `DeferJob` that does not use a retry. A failed send gives its slot back. At 80 percent the guard logs a warning once per day and sets `mail:alert:<day>`. **The "admin alert" is that log line and key until the admin panel exists (Phase 8).**
  - **Templates**: verify, reset, org invite, account suspended; Arabic first with an English variant (strings are `email.*` keys in the shared dictionary, English falls back to Arabic), table layout with inline styles, brand colours copied from `tokens.css` as literals, no images or tracking, everything escaped, links must be http(s). A plain-text alternative for each.
  - **Not done here (owner)**: Brevo account and SMTP key, SPF/DKIM/DMARC records, the mail-tester run, and the check whether the free plan adds Brevo branding (DOCKER-GUIDE 3.7 has the steps; tell me the result and it goes here). Compose: the worker joins the `egress` network and takes `SMTP_*`, `ENCRYPTION_KEY`, `MAIL_*` (`SMTP_USER` and `SMTP_PASS` are required in `.env.prod`).
  - **Tests**: worker 31 (env, templates, transport classification, queue integration, failures, cap) and api `notifications.int.test.ts` (real sign-up to encrypted job). `auth.int.test.ts` now opts out of the real mailer with `createApp(env, { authMailer: false })`.

- **Task 1.5 (phone verification)**
  - **Built**: shared contract (`@wasfa/shared/schemas/phone`), `wa_sessions` table (migration 0004), `apps/worker/src/wa-bridge/{main,auth-state,inbound,guard,replies,config,healthcheck}.ts`, and `apps/api/src/phone/*` (`PhoneVerifier` interface with `WhatsAppInboundVerifier`, service, controller, stream consumer, repo). Compose gets a `wa-bridge` service (the worker image, one replica, `internal` + `egress`, its own health check) and the API gets `WHATSAPP_NUMBER`.
  - **Spike NOT done (needs two real numbers).** The plan says to stop and write it in Open questions if the sender's number cannot be resolved; I cannot find that out without WhatsApp, so the build proceeds on the planned design with the fallback built in: `extractInbound` reads the number from the PN jid, then `remoteJidAlt`, then `signalRepository.lidMapping.getPNForLID`, and ignores the message if all three fail. If the spike shows LIDs cannot be mapped, phone verification is simply unavailable and email verification carries Phase 1 (set `auth.phoneVerification = disabled`).
  - **Baileys `7.0.0-rc14` is a release candidate**, pinned exactly (npm `latest` is this rc; `6.7.24` is the `legacy` tag). Its optional peers (`sharp`, `jimp`, `audio-decode`, `link-preview-js`: media only) are dropped by `.pnpmfile.cjs`. The worker image grew from 194 to **222 MB** (protobuf, signal and WebSocket libraries); the bridge uses the same image with another command.
  - **Deviation: replies go through a second stream.** The plan has the api resolve challenges but never says how the bridge learns the outcome to send its one reply. The api appends `{inboundId, jid, outcome}` to `wa:replies`; the bridge picks one of two fixed sentences by outcome name and sends it only if `guard.ts` allows. The api cannot supply text.
  - **Deviation: pairing by code, not QR.** `main.js link <number>` requests a pairing code ("Link with phone number instead") and logs it, which avoids a QR dependency; `unlink` removes the session; after `loggedOut` the bridge idles and never re-pairs.
  - **Deviation: the controller resolves the user with `AuthService` for now** (Task 1.6 replaces that with the global guard and `@CurrentUser()`).
  - **Design details**: the code lookup key includes the sender's number (hashed), so the same code from another number simply finds nothing, and `GETDEL` makes a code single-use and a replay harmless; unknown claims are counted per sender (warning at 10 an hour, no reply above 5); the status endpoint reports `available` with the reason, which is what the UI will use to hide the feature; a verified number moves `users.phone`, `phone_verified_at` and `phone_verified` together (the CHECK constraints from Task 1.2 enforce they agree), and the partial unique index decides who owns a number.
  - **Verified**: worker 55 tests (inbound parsing, guard, reply loop, encrypted auth state on Postgres 18), api `phone.int.test.ts` 18, shared 62; the production worker image was booted as the bridge against real Postgres and Redis (idle as "logged out", heartbeat written, health check passes). **Not verified: any contact with WhatsApp.**

- **Task 1.6 (request identity, RBAC, audit)**
  - **Guards**: `AccessGuard` (global) runs `OriginGuard`, `AuthGuard`, `PermissionsGuard`, `FreshAuthGuard` in that order (Nest does not guarantee the order of several `APP_GUARD`s, hence the composite). Deny by default: the existing health and `/auth/*` controllers got `@Public()`, the phone controller now uses `@CurrentUser()`, and `api.int.test.ts` probe routes needed `@Public()` too, which is the proof it works. `request.authUser` is `{ id, name, email, roles, permissions, isSuperAdmin, orgIds, twoFactorEnabled, emailVerified, phoneVerified, session }` (the plan's shape plus what the guards need).
  - **Deviation: new columns `sessions.reauth_at` and `sessions.mfa_verified_at`** (migration 0005) and a new endpoint **`POST /auth/reauth`**. The plan says "2FA-verified session" and "re-authenticated within N minutes" without saying where that is recorded. Better Auth creates a session only after the TOTP challenge, so `session.create.after` stamps `mfa_verified_at` when the path is `/two-factor/verify-*` (this also covers the code that switches 2FA on), and `reauth_at` starts at creation and moves with `/auth/reauth {password}`. Fresh auth by TOTP is not offered (password only); Google-only accounts sign in again.
  - **Admin rules**: an `/admin/*` route must declare `@RequirePermission` (otherwise `403 admin_route_unprotected`); then 2FA enabled (`403 two_factor_required`) and a session with `mfa_verified_at` (`401 two_factor_session`). `super_admin` gets the whole catalog from the resolver, so later permissions need no data migration.
  - **RBAC cache**: `RbacService` (Redis, 5 min, epoch-prefixed keys) with `bustUser`, `bustRole`, `bustAll`; **callers that change roles or organization membership must bust** (nothing does yet: the writers are Task 1.7 and Phase 8). The database stays authoritative; a Redis outage is only slower.
  - **Audit**: `AuditService.record/recordFor`, `@Audited`, `@AuditCtx()`, `sanitizeAuditValue`. Deviation from the plan's "interceptor captures before/after": an interceptor cannot know the previous state, so the handler or service puts `before`/`after` in `AuditCtx` and the interceptor records them (or the response with `afterFromResponse`). A failed audit write fails the request.
  - **Deviation: also audited** (not in the plan's list, but SECURITY.md 3 requires it): password change, 2FA enable/disable and backup-code regeneration, through an `audit` flag on the `/auth` allowlist entries.
  - **DB role**: migration 0005 creates `wasfa_api` (NOLOGIN, owns nothing; `SELECT/INSERT/UPDATE/DELETE` on all tables, only `SELECT/INSERT` on `audit_logs`; default privileges for later tables). `migrate` sets its password from `API_DB_PASSWORD` (`setApiRolePassword`, quoted by Postgres' `format('%L')`). Compose: api and wa-bridge connect as `wasfa_api`, `migrate` keeps the owner. **Owner action before the next deploy: add `API_DB_PASSWORD` (hex) to `.env.prod`**, otherwise compose refuses to start. All new API integration tests run as the restricted role; the older `auth.int` and `api.int` tests still use the owner (they pass either way).
  - **Lint convention**: ESLint (`apps/api/eslint.config.mjs`) rejects raw `db.select/insert/update/delete/execute/transaction` calls in `*.service.ts`, `*.controller.ts`, `*.guard.ts`, `*.interceptor.ts`. To satisfy it, the session and credential queries of `AuthService` moved to a new `AuthRepo`. `scopedRepo` (list/find/require/update/remove with a mandatory owner id, foreign row = `NOT_FOUND`) and `requireMembership` are in `common/scoped-repo.ts`.
  - **CSRF**: `OriginGuard` only judges requests that carry the session cookie (cookie name `...wasfa.session=`); `Origin`, else `Referer`, must be in `WEB_ORIGIN`; `null` and missing are refused. `@SkipOriginCheck()` exists for webhooks. Server-side calls from Next.js must set `Origin` (SECURITY.md 11).
  - **Verified**: workspace lint, typecheck and tests (api 141, worker 55, shared 62, db 27, web 11). The production API image (235 MB, up from 228 MB with BullMQ) was booted against Postgres and Redis: `migrate` created the role and set its password, the API connected as `wasfa_api` (confirmed in `pg_stat_activity`), `/health/ready` answered 200, an unauthenticated `/phone/verify/status` answered 401, a sign-up succeeded and queued its verification mail.

- **Task 1.7 (users, organizations, onboarding)**
  - **Built**: `apps/api/src/{users,onboarding,orgs}/*`, `common/verified.guard.ts` (5th step of `AccessGuard`), shared contracts `@wasfa/shared/schemas/{user,org,onboarding}`, worker jobs `account.anonymize_due` (hourly) and `auth.purge_expired` (6 h). Endpoint register: SECURITY.md 3.1.
  - **New error code `CONFLICT` (409)**: valid request, state forbids it; `details.reason` names the rule (`last_org_admin`, `current_session`, `step_out_of_order`, `already_member`, ...).
  - **Onboarding rules**: the server computes the applicable steps; a client may submit the current step or re-submit a passed one. The phone step is derived live (verified → completed; **skippable when phone verification is unavailable for any reason**, not only when switched off, provided the email is verified: a bridge outage must not block sign-ups). `account_type` is locked once the organization step is done. **Done is sticky** (`completed_at`), so re-enabling phone verification never pushes finished users back into the wizard. `USAGE_INTENTS` catalog added to `identity.ts`.
  - **Organizations are created only by the onboarding step** (no `POST /orgs` in Phase 1). Invariant "at least one `org_admin`" is checked under a `FOR UPDATE` lock on the organization row; the sole member leaving deletes the organization.
  - **Invites (deviation in delivery)**: email invites carry the token in the URL **fragment** (`/invite#<token>`), so it never reaches server or proxy logs; only its SHA-256 is stored. **Phone invites send nothing** (the WhatsApp number never starts a conversation): the invitee sees them in `GET /me/invites` once the phone is verified and accepts by id. Accepting always requires the caller's *verified* email or phone to match. Caps: 20 pending per org, 30 per inviter per day (fail closed).
  - **Account deletion**: `DELETE /me` needs fresh auth (5 min), is refused for the sole `org_admin` of an organization with members, and sets `deleted` + kills sessions in one transaction. The worker anonymizes after 14 days as DATABASE.md §5 describes. **Unverified accounts are anonymized after 7 days** instead of being deleted (decision #22 holds), which frees squatted addresses (SECURITY.md §11 item closed). The worker now requires `DATABASE_URL` (restricted role `wasfa_api`, same `API_DB_PASSWORD`; compose updated, no new secret).
  - **One verified account per phone** was already enforced by `users_phone_verified_key` with a friendly `phone_in_use` result (Task 1.5). A deleted account keeps its number until anonymized, which also stops delete-and-re-register farming.

- **Task 1.8 (settings and flags)**
  - **Registry** in `@wasfa/shared/settings`: every key has a zod schema whose defaults are the safe default, and a visibility. `access` is **public** (the web shows maintenance / sign-up closed) and `free_tier` too; only `auth` is admin. The seed now derives from the registry (still insert-only).
  - **Cache**: in-process 30 s → Redis 10 min → DB → default. Writes invalidate Redis and publish on `settings:invalidate` / `flags:invalidate`, which every replica's subscriber uses to drop its in-process copy. Only valid DB rows are cached in Redis, so a corrupt row cannot be pinned for 10 minutes. Known limit (SECURITY §11): a write during a Redis outage leaves the old Redis copy until its TTL.
  - **Maintenance**: a step of `AccessGuard` after the session (deviation from "a global guard": it is the sixth step of the existing composite, for the ordering reason of decision #24). Exempt: health, `/auth/*`, `GET /settings/public`, `GET /me`; any platform role bypasses. Sign-up is refused during maintenance, like `signupOpen = false`. The 503 is **not** stored in `error_events` (it would write a row per request).
  - **Flags**: rules `all | user | org | percentage | plan` (`{}` = all). Percentage bucket = first 4 bytes of sha256(`<flag key>:<user id>`) mod 100, so cohorts differ per flag. `plan` is false until plans exist. Admin write methods exist on the services; their HTTP routes are Task 1.10.
  - `AuthSettingsReader` is deleted; tests switch settings through `SettingsService.set`.

## Open questions
- Should admins be allowed to "act as user" (read-only, time-boxed) in Phase 1, or wait for Phase 4 support tooling? Planned: Phase 4.
