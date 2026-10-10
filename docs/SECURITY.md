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
| Credential stuffing / brute force **P1** | Turnstile after 3 failures per identifier; Redis rate limits (10/15 min per IP, 5/15 min per identifier); Argon2id; breached-password check; uniform responses (no "unknown user" vs "wrong password") | Task 1.3 |
| Account enumeration **P1** | Login, register, reset and phone-verification responses are identical whether or not the identifier exists; timing is not a side channel for the same reason | Task 1.3 (asserted by tests) |
| Session theft / fixation **P1** | `__Secure-` cookie, `HttpOnly; Secure; SameSite=Lax; Domain=.wasfa.online`; DB sessions with `cookieCache` off (instant revocation); a new session token on every sign-in; CSP with nonces; no tokens in URLs or logs | Task 1.3 / Task 1.6 |
| CSRF **P1** | `SameSite=Lax` + `OriginGuard` (`Origin`/`Referer` must be in `WEB_ORIGIN` on non-GET cookie requests) + exact-origin CORS (Done) | Task 1.6 |
| OAuth account takeover **P1** | Account linking only between **verified** identifiers; Google `email_verified` must be true; provider registry with per-provider status (a non-`enabled` provider's callback is rejected); OAuth tokens encrypted at rest | Task 1.3 |
| Privilege escalation / insider **P1** | Deny-by-default `AuthGuard`; typed permission catalog; the role-grant rules in §6 (no self-grant, no granting more than you hold); fresh re-auth for dangerous actions; mandatory TOTP for every admin route; 12 h admin sessions; audit on every admin write | Task 1.6 / 1.10 |
| Admin account compromise **P1** | TOTP 2FA with backup codes (shown once) and lockout on repeated wrong codes; short sessions; suspending a user kills all sessions at once; audit trail they cannot edit (§7) | Task 1.3 / 1.6 |
| Audit tampering **P1** | The API's database role cannot `UPDATE`/`DELETE` `audit_logs`; `before`/`after` pass a field allowlist and `redactText` | Task 1.6 |
| Free-tier farming / multi-accounting | One verified phone per active account (partial unique index, **Done** in schema); disposable-email blocklist; Turnstile on register | Task 1.2 / 1.3 |
| Phone-verification abuse **P1** | The proof is an inbound WhatsApp message from the number (we never send first); 6-digit code is only a correlation token; 10 min TTL, single use, constant-time compare; 3 starts/hour per user, per phone and per IP; wrong-sender messages ignored and counted | Task 1.5 |
| WhatsApp number ban **P1** | The anti-ban rules in §8; kill switch `auth.phoneVerification = disabled`; verification degrades to email, so a ban is an inconvenience, not an outage | Task 1.5 |
| Email abuse and cost **P1** | Turnstile and rate limits on every endpoint that triggers mail (register, reset, invites, phone start); daily cap guard under Brevo's 300/day with an alert at 80 %; per-organization pending-invite cap; no mail to unverified third parties beyond the verification mail itself | Task 1.3 / 1.4 / 1.7 |
| Denial-of-wallet (AI cost) | Credit reservation before every AI call, spend caps, kill switch (Phase 2) | Phase 2 |
| Payment fraud | Server-side pricing, signed idempotent webhooks (Phase 3) | Phase 3 |
| IDOR / data mixing | `scopedRepo` for every query on user-owned data; ownership checks in services; a wrong-owner integration test for every endpoint | Task 1.6 / 1.7 |
| Injection (SQL / XSS / SSRF) | Drizzle parameterized queries only (a CHECK may inline **constants** from our own code, never input); strict nonce CSP; Markdown through a sanitizer; no user-controlled outbound URLs; `next` redirect targets are same-origin relative paths only | Done / Task 1.9 |
| Open redirect **P1** | `?next=` accepts only a relative path starting with a single `/`; anything else falls back to `/dashboard` | Task 1.9 |
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

Tasks 1.3 to 1.11 add their rows here as each endpoint is written.

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
| Errors | Better Auth messages never reach the client; mapped to our `{ code, message }` (Arabic by default). |

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
- Rotation: `ENCRYPTION_KEY` and `BETTER_AUTH_SECRET` rotation invalidate sessions / stored ciphertexts; a rotation procedure is written when each is first used in anger (Task 1.3 for the auth secret).
- gitleaks runs in CI over full history; `docs/vps/` is git-ignored because it holds server credentials.

---

## 7. Audit log

- **What is audited:** every admin write; role and permission changes; user suspension and restoration; settings and feature-flag writes; 2FA enable/disable; password change; session revoke-all; account deletion and anonymization; bootstrap grants by the CLI (actor `system`).
- **Row:** actor, action, target type and id, `before`/`after`, IP, user agent, time.
- **No PII in `before`/`after`:** writers copy a **field allowlist** per entity, never the whole row, and values pass through `redactText`. Emails, phones, tokens, password hashes and secrets are never stored. This is also what lets a deleted user be anonymized without rewriting history.
- **Append-only at the database:** the API connects as a role that has `INSERT` and `SELECT` on `audit_logs` but no `UPDATE`/`DELETE`; tested ("`UPDATE audit_logs` as the API DB role fails"). Migrations run as a separate owner role. Status: Task 1.6 (a carry-over from Phase 0).

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
7. Operations: the pairing QR is printed to container logs by a one-off admin command only; rotate the linked device if the server is ever suspected compromised.

---

## 9. Personal data inventory (Phase 1)

| Data | Where | Why | Retention |
|---|---|---|---|
| Email | `users.email`, `organization_invites.email`, `verifications.identifier` | Sign-in, verification, notices | Until anonymization (14 days after a deletion request); invites until accepted or the organization is deleted. |
| Phone (E.164) | `users.phone`, `organization_invites.phone` | Sign-in, anti-farming | Same. Freed for reuse on anonymization. |
| Name, profession, country, city, usage intent | `users.name`, `user_profiles` | Product, segmentation | Deleted at anonymization. |
| Password hash, OAuth tokens, TOTP secret | `accounts`, `two_factors` | Authentication | Deleted at anonymization. OAuth tokens and TOTP are encrypted. |
| IP address and user agent | `sessions`, `audit_logs` | Session list, abuse investigation | Session rows purged with the session (expiry job); audit rows kept (admin actors only, no end-user PII beyond ids). |
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
| Restricted API DB role that cannot `UPDATE`/`DELETE` `audit_logs` (migration + compose env) | Phase 0 review | Task 1.6 |
| API image is 214 MB (target < 200 MB): audit `pnpm deploy --prod`, drop dev-only deps, or record an accepted size | Phase 0 | Task 1.12 |
| Branch protection not enforced (private repo on the free plan; `infra/scripts/protect-main.sh` is ready) | Phase 0 | Task 1.12 |
| Live checks on the server: direct-IP request refused, `ssh root` and password logins fail, SSL Labs A+, securityheaders.com ≥ A, restore drill | Phase 0 | Task 1.12 |
| Attach an Elastic IP; restrict SSH (22) in the security group to the owner's IP; rotate the Cloudflare token used for setup | Phase 0 notes | Task 1.12 |
| **Bot Fight Mode on the API host may challenge payment webhooks** (the free plan cannot skip it per path) | Phase 0 notes | Phase 3 (Kashier webhooks) |
| Requests to **unknown routes are not rate limited** (`@fastify/rate-limit` attaches only to registered routes). Cheap 404s today; revisit with the auth routes | Phase 0 | Task 1.3 |
| The rate limiter is **fail-open when Redis is down** (`skipOnError`). Decide per route: login, register, reset and phone start must **fail closed** | Phase 0 | Task 1.3 |
| `Cross-Origin-Opener-Policy: same-origin` breaks popup-based OAuth; Google uses a redirect flow, so keep redirect and re-check if a popup is ever added | Phase 0 | Task 1.9 |
| Pages are rendered per request because of the CSP nonce, so HTML is not CDN-cacheable; decide nonce vs hash-based CSP for the SEO pages (landing, legal) | Decision #10 | Task 1.11 |
| `.trivyignore.yaml` entries (age's Go standard library advisories) expire **2026-12-01**; re-evaluate then | Phase 0 | Before 2026-12-01 |
| Remove the Fastify 5.12.5 override when `@nestjs/platform-fastify` ships a patched dependency | Decision #13 | Ongoing |
| Rotation procedures for `ENCRYPTION_KEY` and `BETTER_AUTH_SECRET` | Phase 1 | Task 1.3 |
| OAuth tokens in `accounts` must be encrypted at rest (`account.encryptOAuthTokens`) | Task 1.2 review | Task 1.3 |
| `sessions` / `verifications` purge job (expired rows hold IPs and token identifiers) | Task 1.2 review | Task 1.7 |

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
