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
| Denial-of-wallet (AI cost) | Credit reservation before every AI call, spend caps, kill switch (Phase 2) | Phase 2 |
| Payment fraud | Server-side pricing, signed idempotent webhooks (Phase 3) | Phase 3 |
| IDOR / data mixing | `scopedRepo` for every query on user-owned data; ownership checks in services; a wrong-owner integration test for every endpoint | Task 1.6 / 1.7 |
| Injection (SQL / XSS / SSRF) | Drizzle parameterized queries only (a CHECK may inline **constants** from our own code, never input); strict nonce CSP; Markdown through a sanitizer; no user-controlled outbound URLs; `next` redirect targets are same-origin relative paths only | Done / Task 1.9 |
| Open redirect **P1** | `?next=` accepts only a relative path starting with a single `/`; anything else falls back to `/dashboard` | **Done** in the api (Task 1.3, tested); web side Task 1.9 |
| Malicious uploads | Direct-to-R2, magic bytes, re-encode (Phase 2) | Phase 2 |
| Prompt injection | Isolated prompts, schema-validated output (Phase 2) | Phase 2 |
| Secret leakage | Env validated at boot; encrypted keys in DB; log redaction; gitleaks in CI; tokens in emails are encrypted in the queue (`encryptSecret`) so Redis never holds a usable token | Done / Task 1.4 |
| PII in logs **P1** | pino redaction paths; `redactText` on stored errors; recipients and phones logged as hashes only (mail, WhatsApp bridge) | Done / Task 1.4 / 1.5 |
| Supply chain | Lockfile, `pnpm audit` (high+) in CI, Dependabot, Trivy on images, pinned base images, non-root, read-only filesystems; Baileys and Better Auth versions pinned and reviewed on every bump | Done |
| Stale permissions after a role change **P1** | Permission cache in Redis, 5 min TTL, **busted on every role/permission change**; suspension and deletion revoke sessions immediately | Task 1.6 |
| Invite abuse **P1** | 7-day single-use tokens, only the SHA-256 stored; accepting account must own the invited email/phone; pending-invite cap; rate limit | Task 1.7 |
| Public contact form abuse **P1** | Turnstile + rate limit + size limit; stored as data, never rendered as HTML | Task 1.11 |

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
| `GET /flags` | cookie | — | the caller's evaluated flags | none | 60/min | — | — | — | Done |
| `POST /me/invites/:id/accept`, `POST /invites/accept` | cookie | — | invite must be pending and addressed to the caller's verified identifier, else 404 | `idParamSchema` / `acceptInviteTokenSchema` | 10/min | 1 MB | — | `org.invite_accept` | Done |

Everything else under `/auth/*` answers 404 (§4). Tasks 1.5 to 1.11 add their rows here as each endpoint is written.

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
- The WhatsApp auth state is stored encrypted in Postgres (`wa_sessions`), never on disk.
- `API_DB_PASSWORD` (Task 1.6): password of the restricted database role the API and the bridge use; hex only because it sits in a URL. Rotating it = change the variable and re-run the `migrate` step, then restart the api and the bridge.
- Rotation: `ENCRYPTION_KEY` and `BETTER_AUTH_SECRET` rotation invalidate sessions / stored ciphertexts; a rotation procedure is written when each is first used in anger (Task 1.3 for the auth secret).
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

1. Our number **never starts a conversation**, never sends to a number that did not message it first within the last 24 h, never joins groups, never posts statuses, never sends media or links.
2. At most **one short reply** per verification ("verified" or "wrong or expired code"), sent only in the user's own conversation after a random 2-6 s delay with a typing indicator. Global cap: 1 reply per 3 s and 300 per day; above the cap it stays silent (the web UI shows the outcome anyway).
3. Inbound messages are marked read. Only 1:1 text messages are processed; groups, statuses, broadcasts, media and calls are ignored.
4. One linked session, one server IP, no frequent re-pairing; reconnect with exponential backoff; on `loggedOut` stop and alert the admin; **never auto-re-pair**.
5. Phone numbers are never logged in clear (hash only). Wrong-sender messages are counted for abuse alerts.
6. **Kill switch:** setting `auth.phoneVerification = whatsapp_inbound | disabled`. When disabled, or when the bridge is down or restricted, the UI hides phone verification and email verification keeps working.
7. Operations: the pairing code is printed to the console by a one-off admin command only (`wa-bridge ... link <number>`, DOCKER-GUIDE 3.9); rotate the linked device if the server is ever suspected compromised.

**How it is built (Task 1.5):**

- **Challenge**: `POST /phone/verify/start` (session, Turnstile, 3 starts an hour per user, per number and per IP, all failing closed) makes a 6-digit code valid for 10 minutes and returns a `wa.me` link with the code pre-filled. Redis keys: `phone:ch:<user>` (the challenge), `phone:code:<hash(phone)>:<code>` (lookup by the inbound message, removed with `GETDEL`, so a code works once), `phone:result:<user>`. The lookup key contains the **sender's** number, so the same code from another number finds nothing.
- **Bridge to api**: the bridge appends `{id, phone, code, receivedAt, jid}` to the Redis stream `wa:inbound` (`MAXLEN ~ 10000`); the api consumes it in the consumer group `api` (any number of replicas; stale entries are claimed after 60 s), resolves the challenge, writes `phone`, `phone_verified_at` and `phone_verified`, and asks the bridge to answer through `wa:replies`. Wrong or unknown claims are counted per sender and hour (`phone:abuse:<hash>`); at 10 a warning is logged, above 5 the sender gets no reply.
- **The api cannot make the bridge say anything**: `wa:replies` carries only an outcome name; the two sentences (verified / wrong or expired) are fixed in the bridge, and `guard.ts` checks every send against the rules above (inbound seen in that chat within 24 h and for that message id, one reply per inbound message, no links, direct chats only, 2-6 s delay, at least 3 s apart, 300 a day).
- **One verified account per number** (partial unique index); the loser sees `failed / phone_in_use`.
- **Auth state**: `wa_sessions` rows are AES-256-GCM ciphertext with the session and key as AAD; a row that cannot be decrypted stops the bridge instead of minting new credentials.
- **Health**: the bridge writes `wa:heartbeat` every 30 s with its state (`connecting | connected | disconnected | logged_out`); `GET /phone/verify/status` reports `available` and why not. `/health/ready` does not depend on it. After `loggedOut` the bridge also sets `wa:alert` for the future admin dashboard.
- **Unverified in this repository**: the Baileys socket glue (`wa-bridge/main.ts`) has not run against real WhatsApp. The spike (can the sender's number be resolved from a LID?) and the end-to-end checks of Task 1.5 need the dedicated number and are tracked in phase1.md.

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
| Suspected database-key leak | Rotate `ENCRYPTION_KEY` with the re-encryption script (written with its first stored secret). |
| Admin account suspected compromised | Suspend, revoke sessions, remove roles, review `audit_logs` for that actor. |

---

## 11. Carry-overs

Open security items from Phase 0 and design decisions. Each has an owner task; none may be forgotten.

| Item | Source | Owner task |
|---|---|---|
| ~~Restricted API DB role that cannot `UPDATE`/`DELETE` `audit_logs`~~ **Done (Task 1.6).** Owner action: add `API_DB_PASSWORD` to `.env.prod` before the next deploy (DOCKER-GUIDE 3.7) | Phase 0 review | Task 1.6 |
| Admin-route rules depend on `request.routeOptions.url` starting with `/admin`; a route registered under another prefix is not an admin route. Keep every admin endpoint under `/admin` (the guard test covers an unprotected one) | Task 1.6 | - |
| `AuthService.getSession` costs three queries per request (user status, platform role, session assurance) plus the cached permission lookup. Fold into one query, or cache per session for a few seconds, when load shows it | Task 1.6 | Phase 4 |
| Server-side (SSR) mutations from the Next.js server to the API carry the session cookie but no browser `Origin`; they must set `Origin` to the site origin explicitly or they are refused by the origin guard | Task 1.6 | Task 1.9 |
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
| Pages are rendered per request because of the CSP nonce, so HTML is not CDN-cacheable; decide nonce vs hash-based CSP for the SEO pages (landing, legal) | Decision #10 | Task 1.11 |
| `.trivyignore.yaml` entries (age's Go standard library advisories) expire **2026-12-01**; re-evaluate then | Phase 0 | Before 2026-12-01 |
| Remove the Fastify 5.12.5 override when `@nestjs/platform-fastify` ships a patched dependency | Decision #13 | Ongoing |
| Rotation: `BETTER_AUTH_SECRET` = replace it in `.env.prod` and redeploy (every session, verification link and reset link is invalidated; nothing else breaks). **Done (Task 1.3).** `ENCRYPTION_KEY` rotation needs a re-encryption script, written with its first stored secret (Task 1.4 stores email tokens, Phase 2 stores provider keys) | Phase 1 | Task 1.3 / 1.4 |
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
