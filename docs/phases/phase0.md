# Phase 0 — Foundation & Security Baseline

> Goal: a production-grade skeleton. Monorepo, three apps that boot, database, Redis, Docker for dev and prod, CI/CD, hardened server, backups.
> **No product features in this phase.** Everything later is built on this, so do it carefully.
>
> Prerequisites: read `docs/AGENT.md` and `docs/ARCHITECTURE.md`.

---

## Outcome

- `pnpm dev` starts web + api + worker locally against Dockerized Postgres + Redis.
- `docker compose -f infra/docker/compose.prod.yml up -d` runs the full stack on the server behind Caddy + Cloudflare.
- CI on every push: lint, typecheck, test, build, secret scan, image scan.
- API has the security baseline (headers, CORS, rate limit, validation, error reference codes, redacted logs, health checks).
- Web renders an Arabic RTL placeholder page with correct fonts, tokens, CSP, and SEO basics.
- Nightly encrypted DB backups to R2.

---

## Task 0.1 — Monorepo bootstrap

**Files:** `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.nvmrc`, `.npmrc`, `.editorconfig`, `.gitignore`, `.gitattributes`, `packages/config/*`

Steps
1. `.nvmrc` → `24`. Root `package.json` with `"packageManager": "pnpm@<latest 10.x>"`, `"engines": { "node": ">=24" }`.
2. `pnpm-workspace.yaml`: `apps/*`, `packages/*`.
3. `turbo.json` pipelines: `build`, `dev` (persistent, no cache), `lint`, `typecheck`, `test`.
4. `packages/config`: `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), eslint flat config (typescript-eslint strict + import order + no-console), prettier config.
5. `.npmrc`: `engine-strict=true`, `auto-install-peers=true`.
6. `.gitignore` must cover `.env*` (except `.env.example`), `node_modules`, `.next`, `dist`, `coverage`, `*.pem`, `*.key`, backups.
7. Remove the stray reference images from the repo root into `docs/references/` (`1.png` dashboard, `2.png` + `3.png` AI page style).

Acceptance
- [x] `pnpm install` succeeds with a committed `pnpm-lock.yaml`.
- [x] `pnpm lint` and `pnpm typecheck` run (no-op OK) across the workspace.

---

## Task 0.2 — `packages/shared`

**Files:** `packages/shared/src/{index.ts, env.ts, errors/*, i18n/*, money.ts, ids.ts}`

Steps
1. `errors/codes.ts`: typed error-code enum (`AUTH_REQUIRED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_FAILED`, `RATE_LIMITED`, `QUOTA_EXCEEDED`, `PAYMENT_REQUIRED`, `UPSTREAM_UNAVAILABLE`, `INTERNAL`), each with Arabic + English user message.
2. `errors/app-error.ts`: `AppError` class (code, httpStatus, safe details).
3. `ids.ts`: `newId()` (UUIDv7) and `newErrorRef()` → `WSF-XXXX-XXXX` (Crockford base32, no ambiguous chars).
4. `money.ts`: `toMinor`, `fromMinor`, `formatMoney(amountMinor, currency, locale)` — integers only; unit tests.
5. `env.ts`: helper `parseEnv(schema)` that prints **which** keys are missing/invalid (never their values) and exits.
6. `i18n/`: `ar.ts` (default), `en.ts` stub, typed `t(key)` helper.
7. Register all exports in `docs/REUSE-INDEX.md` (create the file with a table header).

Acceptance
- [x] Unit tests for money, ids, env parsing pass. *(23 tests, also covering errors + i18n)*
- [x] `docs/REUSE-INDEX.md` lists every export.

---

## Task 0.3 — `packages/db` (Drizzle + Postgres)

**Files:** `packages/db/src/{client.ts, schema/*.ts}`, `packages/db/drizzle.config.ts`, `packages/db/migrations/*`

Steps
1. Drizzle with `postgres` (postgres.js) driver; pooled client factory reading `DATABASE_URL`.
2. Initial migration enables extensions: `pgcrypto`, `pg_trgm`, `unaccent`, `citext`.
3. Foundation tables only:
   - `site_settings` (key text PK, value jsonb, updated_by, updated_at)
   - `feature_flags` (key, enabled, rules jsonb)
   - `audit_logs` (id, actor_id, action, target_type, target_id, before jsonb, after jsonb, ip, user_agent, created_at) — index on (target_type, target_id), (actor_id, created_at)
   - `error_events` (id, ref unique, fingerprint, code, route, method, user_id null, request_id, message, context jsonb, stack text, status, created_at) — index on fingerprint, created_at
4. Scripts: `db:generate`, `db:migrate`, `db:seed` (seeds default site settings).
5. Conventions: snake_case columns, `created_at`/`updated_at` timestamptz default now(), UUIDv7 PKs.

Acceptance
- [x] `pnpm db:migrate` against local Postgres creates the tables and extensions.
- [x] Seed is idempotent (running twice changes nothing).

---

## Task 0.4 — `apps/api` (NestJS + Fastify) with security baseline

**Files:** `apps/api/src/{main.ts, app.module.ts, config/*, common/*, health/*}`

Steps
1. Nest 11 with `@nestjs/platform-fastify`. Boot validates env via `packages/shared/env` (`NODE_ENV`, `PORT`, `DATABASE_URL`, `REDIS_URL`, `WEB_ORIGIN`, `ENCRYPTION_KEY` (32-byte base64), `TRUST_PROXY`).
   **Module format: ESM.** `apps/api` uses `"type": "module"` with `NodeNext` resolution, because `@wasfa/shared` and `@wasfa/db` export ESM only (`import` condition). Do not switch the API to CommonJS.
2. Fastify options: `bodyLimit` 1 MB default (uploads never go through the API), `trustProxy` limited to Caddy, request id from `cf-ray` / generated.
3. `@fastify/helmet` (API-appropriate headers), `@fastify/cors` with **exact-origin allowlist** from env, credentials true.
4. **Rate limiting:** `@fastify/rate-limit` backed by Redis; global default (e.g. 120/min/IP) + decorator for stricter per-route limits; real client IP from `CF-Connecting-IP` only when request came through Caddy.
5. **Validation pipe:** zod-based global pipe (`nestjs-zod` or custom) — strips unknown keys, returns `VALIDATION_FAILED` with field paths (no echo of values).
6. **Global exception filter:** maps `AppError` → status + `{ code, message }`; any unknown error → generate ref, insert `error_events` (redacted), log, respond `{ code: 'INTERNAL', ref, message }`.
7. **Logger:** `nestjs-pino` with redact paths (`req.headers.authorization`, `req.headers.cookie`, `*.password`, `*.token`, `*.phone`, `*.email`, `*.apiKey`).
8. `common/crypto.ts`: AES-256-GCM `encryptSecret` / `decryptSecret` (for admin-stored API keys). Unit tests incl. tamper detection.
9. `common/redis.ts`: shared ioredis provider.
10. `health` module: `GET /health/live` (always 200), `GET /health/ready` (checks DB + Redis, 503 if down). Excluded from rate limit; no sensitive info in body.
11. Graceful shutdown (close Fastify, DB pool, Redis) on SIGTERM.

Acceptance
- [x] `curl /health/ready` → 200 with DB + Redis up, 503 when Postgres is stopped. *(verified on the built server: 200 → stop Postgres → 503 → start → 200)*
- [x] Throwing an unknown error in a test route returns `{ code: 'INTERNAL', ref: 'WSF-…' }` and creates an `error_events` row; stack never appears in the response.
- [x] 121st request in a minute from same IP → 429 with `RATE_LIMITED`.
- [x] Request from a non-allowlisted Origin gets no CORS headers.
- [x] Integration tests (Testcontainers) cover the above. *(38 API tests + 1 db seed test, all passing against `postgres:18-alpine` + `redis:8-alpine` containers.)*

---

## Task 0.5 — `apps/worker` (BullMQ)

**Files:** `apps/worker/src/{main.ts, queues.ts, jobs/health.job.ts}`

Steps
1. Standalone Node process; same env validation + pino logger + redaction.
2. Queue registry in `packages/shared/queues.ts` (names + payload zod schemas) so api and worker share them.
3. One demo job `system.heartbeat` scheduled every 5 minutes writing a Redis key `worker:heartbeat`.
4. Concurrency per queue from env; graceful shutdown waits for active jobs (timeout 30s).
5. `api /health/ready` additionally reports `worker: ok|stale` based on heartbeat age (internal detail only in logs; public body stays minimal).

Acceptance
- [x] Heartbeat key refreshes; stopping worker makes it stale after 10 minutes. *(worker test: key written at boot and refreshed by a manual job; `workerStatus` flips to `stale` past 10 min; API integration test covers ok → stale → missing.)*
- [x] Invalid job payload is rejected by schema and moved to failed with a clear reason. *(`UnrecoverableError`: one attempt, reason names the field, never the value.)*

---

## Task 0.6 — `apps/web` (Next.js) skeleton

**Files:** `apps/web/{next.config.ts, src/app/layout.tsx, src/app/page.tsx, src/app/not-found.tsx, src/app/error.tsx, src/app/robots.ts, src/app/sitemap.ts, src/middleware.ts, src/styles/*}`, `packages/ui/*`

Steps
1. Next.js latest stable, App Router, `output: 'standalone'` (for small Docker image), `poweredByHeader: false`, `reactStrictMode: true`.
2. Fonts via `next/font/google`: **Alexandria** (headings, weights 500/600/700) and **IBM Plex Sans Arabic** (body, 400/500/600), `display: swap`, subsets `arabic` + `latin`, exposed as CSS variables.
3. Root layout: `<html lang="ar" dir="rtl">`, light theme default, `color-scheme: light`.
4. Styling: Tailwind CSS (latest) with design tokens as CSS variables in `packages/ui/tokens.css`:
   `--color-primary: #1E3A8A; --color-accent: #60A5FA; --color-bg: #F5F7FB; --color-surface: #FFFFFF; --color-text: #0B1220;` + neutral scale, success/warning/danger, radii, shadows, spacing. Tailwind theme reads the variables. Logical properties only.
5. `middleware.ts`: generate per-request **CSP nonce**; set CSP (`default-src 'self'`, scripts `'self' 'nonce-…' 'strict-dynamic'`, connect-src includes `api.wasfa.online` and Turnstile/analytics hosts as placeholders driven by env), plus `Referrer-Policy`, `Permissions-Policy`, `X-Content-Type-Options`, `frame-ancestors 'none'`.
6. Placeholder home page: logo text "وصفة AI", one-line value proposition, uses tokens and fonts — proves RTL + typography. No real landing yet (Phase 1).
7. `robots.ts` (allow all in production, disallow all when `NEXT_PUBLIC_ENV !== 'production'`), `sitemap.ts` stub, default metadata (`metadataBase: https://wasfa.online`, title template `%s | وصفة AI`, Arabic description, Open Graph, `alternates.canonical`).
8. Friendly Arabic `not-found` and `error` pages; `error.tsx` shows the ref code if the API returned one.
9. `packages/ui`: `Button`, `Card`, `Container` primitives using tokens + `lucide-react` icons — enough to prove the design system wiring.

Acceptance
- [x] Page renders RTL at 360px and 1440px with Alexandria headings and Plex body (verify in devtools that fonts are self-hosted, no request to fonts.googleapis.com at runtime). *(Puppeteer at 360 and 1440: no horizontal overflow, fonts loaded from `/_next/static/media`, zero requests to googleapis/gstatic.)*
- [x] Response has a CSP header with a nonce; no CSP violations in console. *(Empty console in Puppeteer and Lighthouse `errors-in-console` passes on the production build.)*
- [x] Lighthouse (mobile) on the placeholder: Performance ≥ 95, SEO 100, Best Practices 100, Accessibility ≥ 95. *(Lighthouse 13.5, `next start`, built with `NEXT_PUBLIC_ENV=production`, 5 runs: Performance 95-96, Accessibility 100, Best Practices 100, SEO 100. Performance has little headroom, see the font notes below.)*

---

## Task 0.7 — Docker (dev + prod)

**Files:** `infra/docker/{web.Dockerfile, api.Dockerfile, worker.Dockerfile, compose.dev.yml, compose.prod.yml, Caddyfile, postgres/postgresql.conf, redis/redis.conf}`, `.dockerignore`, `.env.example`

Steps
1. **Multi-stage Dockerfiles** using `node:24-alpine` (pinned by digest), `pnpm deploy --prod` / `turbo prune` for minimal images. Final stage: **non-root user**, `NODE_ENV=production`, only built output, `HEALTHCHECK`.
2. `compose.dev.yml`: postgres:18-alpine, redis:8-alpine with ports published to **127.0.0.1 only**, named volumes. Apps run on host via `pnpm dev`.
3. `compose.prod.yml`:
   - Services: `caddy`, `web`, `api`, `worker`, `postgres`, `redis`, `migrate` (one-off, `profiles: [tools]`). It runs `node packages/db/dist/migrate.js` — `tsx` is a dev dependency and is not in production images.
   - Networks: `edge` (caddy↔web/api) and `internal` (`internal: true`; api/worker/postgres/redis). Postgres and Redis **publish no ports**.
   - `restart: unless-stopped`, healthchecks, `depends_on: condition: service_healthy`.
   - Resource limits (`mem_limit`, `cpus`) per service, tuned for the current server size, documented in comments.
   - `read_only: true` + `tmpfs: /tmp` for web/api/worker; `cap_drop: [ALL]`; `security_opt: [no-new-privileges:true]`.
   - Secrets via `.env.prod` on the server (chmod 600, never committed).
   - Log rotation: `logging: { driver: json-file, options: { max-size: 10m, max-file: "5" } }`.
4. **Postgres tuning** file sized for small RAM (shared_buffers, work_mem, max_connections ~50) with comments on how to scale up.
5. **Redis:** `maxmemory` with `allkeys-lru` for cache DB and `noeviction` note for queue DB (use separate logical DBs or two instances — document choice), `requirepass`, protected mode, disable `FLUSHALL`/`CONFIG`/`KEYS` via `rename-command`.
6. **Caddyfile:** sites `wasfa.online`, `www.wasfa.online` (redirect to apex), `api.wasfa.online`; TLS with **Cloudflare Origin Certificate**; `request_body max_size` (api 1MB); security headers (HSTS 2y preload); real IP from `CF-Connecting-IP` with `trusted_proxies` = Cloudflare ranges; gzip/zstd.
7. `.env.example` lists every variable with comments; no real values.

Acceptance
- [x] `docker compose -f infra/docker/compose.prod.yml config` validates. *(Needs the variables: `docker compose --env-file .env.example -f compose.prod.yml config -q` passes; without an env file it fails by design on the first missing required secret.)*
- [x] Locally, prod compose brings everything up healthy; `curl -k https://localhost/health/ready` (via Caddy with internal cert in local mode) → 200. *(All 6 services healthy; `curl -sk --resolve api.wasfa.online:8443:127.0.0.1 https://api.wasfa.online:8443/health/ready` → 200 `{"status":"ok"}` through Caddy with `CADDY_TLS_FILE=./caddy/tls.local.caddy`. The Host header must match a site, hence `--resolve` instead of `localhost`.)*
- [x] `docker exec api id` shows a non-root uid; root filesystem is read-only. *(api, web, worker: `uid=1000(node)`; `touch /probe` → "Read-only file system"; `/tmp` writable.)*
- [x] Postgres/Redis unreachable from the host network in prod compose. *(No `ports:`; `docker ps` shows only `5432/tcp` / `6379/tcp` unpublished; connecting to 127.0.0.1:5432 and :6379 fails; the `internal` network is `internal: true`.)*
- [ ] Image sizes: web < 250 MB, api < 200 MB, worker < 200 MB. *(`docker image ls` unpacked: web 231 MB ✓, worker 194 MB ✓, **api 214 MB ✗ (14 MB over)**. Compressed (what a server pulls): web 61 MB, api 52 MB, worker 51 MB. The Node 24 binary alone is 109 MB stripped; the API carries ~35 MB of dependencies. Left open rather than prune dependencies by hand.)*

---

## Task 0.8 — CI/CD (GitHub Actions)

**Files:** `.github/workflows/{ci.yml, deploy.yml}`, `.github/dependabot.yml`, `.gitleaks.toml`

Steps
1. `ci.yml` on PR + push: checkout → pnpm cache → install (frozen lockfile) → lint → typecheck → test (services: postgres, redis) → build → **gitleaks** → `pnpm audit --audit-level high`.
2. On `main`: build 3 images with Buildx (cache), tag `:<sha>` and `:latest`, push to **GHCR**, scan with **Trivy** (fail on HIGH/CRITICAL fixable).
3. `deploy.yml` (after CI success on `main`, or manual dispatch with SHA): SSH (key in GitHub secrets, restricted deploy user) →
   `docker compose pull` → `docker compose run --rm migrate` → `docker compose up -d` → poll `/health/ready` up to 60s → on failure redeploy previous SHA and fail the job.
4. Dependabot weekly for npm, GitHub Actions, Docker.
5. Branch protection on `main`: CI required, no force-push.

Acceptance
- [ ] A PR with a failing test cannot merge. *(Needs the workflows pushed to GitHub and `infra/scripts/protect-main.sh` run once by a repo admin; not done from this machine because it changes the remote repository.)*
- [x] A committed fake secret is caught by gitleaks. *(Same pinned gitleaks image and `.gitleaks.toml` as CI, on a scratch repo containing a fake `ghp_…` token: "leaks found: 1", exit 1. The real repository history scans clean.)*
- [x] Deploy of a broken image auto-rolls back. *(`infra/scripts/deploy.sh` run against the local production stack: good release → healthy; release whose API image exits immediately → "did not become ready", rolled back to the previous SHA, healthy again, exit 1, `.deployed-sha` unchanged. The SSH/GitHub half of `deploy.yml` can only be exercised on the real server.)*

---

## Task 0.9 — Server provisioning runbook

**Files:** `infra/scripts/provision.sh`, `docs/DOCKER-GUIDE.md` (beginner-friendly walkthrough of this section)

Steps (Ubuntu 24.04 LTS on AWS EC2)
1. **AWS:** Elastic IP; Security Group inbound: 443 + 80 from **Cloudflare IP ranges only**; 22 from owner IP only (or use AWS SSM Session Manager and close 22). Billing alarm configured.
2. **OS:** create `deploy` user (sudo, SSH key only), disable root login + password auth, `unattended-upgrades`, `ufw` mirroring the security group, `fail2ban` for SSH, timezone UTC, swap file sized to RAM.
3. **Docker Engine + Compose plugin** from Docker's official repo; `deploy` in `docker` group; daemon log rotation defaults.
4. **Cloudflare:** DNS A records proxied (orange cloud) for `@`, `www`, `api`; SSL mode **Full (strict)**; Origin Certificate installed for Caddy; **Authenticated Origin Pulls** enabled; "Always Use HTTPS"; HSTS; Bot Fight Mode; WAF managed rules (free set) + rate-limiting rule on `/auth/*` and `/ai/*`; cache rules: bypass for `api.*`, cache static assets.
5. Directory layout on server: `/opt/wasfa/{compose.prod.yml, Caddyfile, .env.prod, certs/, backups/}` with tight permissions.

Acceptance
- [ ] Direct request to the server IP (bypassing Cloudflare) is refused.
- [ ] `ssh root@…` and password logins fail.
- [ ] SSL Labs (via domain) grade A+; securityheaders.com grade A or better.

---

## Task 0.10 — Backups & restore

**Files:** `infra/scripts/{backup.sh, restore.sh}`, worker job `system.backup` (or host cron — pick one and document)

Steps
1. Nightly `pg_dump -Fc` → compress → **encrypt** (age or gpg with a public key; private key stored offline by the owner) → upload to private R2 bucket `wasfa-backups` with dated key.
2. Retention: 14 daily, 8 weekly (R2 lifecycle rules or script).
3. On failure → alert (email/Telegram per settings).
4. `restore.sh` documented step by step; perform one restore into a scratch database.

Acceptance
- [ ] A backup file appears in R2 and is not readable without the private key.
- [ ] Restore test recreates all tables with matching row counts.

---

## Phase 0 final checklist

- [ ] All task acceptance boxes ticked.
- [ ] `docs/REUSE-INDEX.md` up to date.
- [ ] `docs/DOCKER-GUIDE.md` written for a Docker beginner (install, commands, logs, restart, update, rollback, backup/restore).
- [ ] Production stack live at `https://wasfa.online` (placeholder page) and `https://api.wasfa.online/health/live`.
- [ ] Summary written below with any deviations.

## Notes
- **Task 0.1 deviations**
  - Machine default Node is v22.22.1; `pnpm install` was run with Node 24.14.0 (installed via nvm-windows) because `.npmrc` sets `engine-strict=true`.
  - `packageManager` pinned to `pnpm@10.34.6` (latest 10.x). The plan's "latest 10.x" is not the npm `latest` tag, which is now 12.x.
  - TypeScript pinned to `^5.9.3`, not 7.x. `typescript-eslint@8.71` declares `typescript <6.1.0`.
  - ESLint uses `tseslint.configs.strict` (non-type-aware). `strictTypeChecked` is deferred until apps exist.
  - `tsconfig.base.json` uses `NodeNext` module resolution. Next.js (Task 0.6) will override it with `Bundler`.
  - Reference images moved to `docs/references/1.png`, `2.png`, `3.png`.
  - `pnpm install` reports ignored build scripts for `unrs-resolver`. Not needed for lint or typecheck; run `pnpm approve-builds` if a later task needs it.

- **Tasks 0.2 / 0.3 deviations**
  - `packages/shared` and `packages/db` compile to `dist/` as ESM with `tsc`, and the `package.json` `exports` point at `dist`. Consumers need `pnpm build` first; the root `db:migrate` and `db:seed` scripts build `shared` automatically.
  - Subpath exports `@wasfa/shared/{env,errors,i18n,ids,money}` were added. `queues.ts` is deferred to Task 0.5.
  - UUIDv7 primary keys in the DB use Postgres 18's native `uuidv7()` default. The app-side `newId()` is a separate implementation with no `uuid` dependency.
  - `formatMoney` defaults to Western digits via `-u-nu-latn`, per AGENT.md §5.10. Currency exponents come from a small built-in table: EGP, SAR, AED, USD, EUR, QAR, JOD, KWD, BHD, OMR, JPY.
  - Migrations: `0000_extensions.sql` (hand-written, via `drizzle-kit generate --custom`) enables `pgcrypto`, `pg_trgm`, `unaccent` and `citext`. `0001_*.sql` holds the four tables.
  - Added columns beyond the plan: `created_at`/`updated_at` on `site_settings` and `feature_flags`, and `error_events.updated_at`. `audit_logs.target_id` and `ip` are `text`, not `uuid`/`inet`.
  - Seed uses `ON CONFLICT DO NOTHING`, so it never overwrites admin-edited settings.
  - Verified against a throwaway PostgreSQL 18.4 cluster (local install, port 55432, now stopped). Docker is not running on this machine, so Task 0.7 will need Docker Desktop started.

- **Review fixes after Tasks 0.2 / 0.3** (Opus review, 2026-10-10)
  - `turbo.json`: `typecheck` and `lint` now depend on `^build`. Before, a fresh checkout (CI) failed with `TS2307: Cannot find module '@wasfa/shared/env'` because `dist/` did not exist yet.
  - `timestamps().updatedAt` now has `$onUpdate(() => new Date())`, so ORM updates refresh it. Raw SQL updates must still set it themselves.
  - `error_events.status` is restricted to `new | investigating | resolved` by a check constraint (migration `0002_error_events_status_check.sql`). It has not yet been applied to a live database; it runs on the next `db:migrate`.
  - `currencyExponent` falls back to CLDR data (`Intl`) for any valid ISO 4217 code, since admins can add currencies. Unknown codes still throw.
  - `t()` substitutes only the caller's own params (`Object.hasOwn`), never inherited object properties.
  - Decisions recorded in the tasks: the API is ESM (Task 0.4), and the production `migrate` container runs `node packages/db/dist/migrate.js` (Task 0.7).
  - Deferred: seed-idempotency integration test (with Task 0.4 Testcontainers); DB role that blocks UPDATE/DELETE on `audit_logs` (SECURITY.md).

- **Task 0.4 deviations**
  - Nest pinned to **11.x** (11.2.7) as locked in AGENT.md, although 12.x is now `latest`. `fastify` is pinned to `5.11.3` and `@fastify/cors` to `11.3.0`, the exact versions `@nestjs/platform-fastify@11.2.7` uses, so there is only one copy of each type. `ioredis` is on 5.x, because 6.0 is only ~2 months old.
  - Validation is a custom `ZodValidationPipe` + `createZodDto(schema)`, not `nestjs-zod`. It is about 40 lines, works with zod 4, and returns `details.fields` (paths only, never values).
  - Extra env keys (all have defaults): `HOST` (0.0.0.0), `PORT` (4000), `RATE_LIMIT_MAX` (120), `LOG_LEVEL` (info). `WEB_ORIGIN` takes a comma-separated list of exact origins. `TRUST_PROXY` takes comma-separated IPs/CIDRs; empty means trust nobody.
  - `CF-Connecting-IP` is used for rate-limit keys only when the TCP peer matches `TRUST_PROXY`. The request id is `cf-ray` only when it matches Cloudflare's format; otherwise it is a UUIDv7. It is echoed as `x-request-id`.
  - Rate limiter uses `skipOnError: true`: if Redis is down the API keeps serving (readiness reports 503, and Cloudflare rules still apply). Revisit for AI/auth routes in their phases, where a fail-closed per-route limit may be preferable.
  - Errors raised before a handler runs (rate limit, 1 MB body limit → 413, bad JSON) go through the same `AllExceptionsFilter`, via the Fastify error handler that Nest installs. 4xx statuses with no matching code map to `VALIDATION_FAILED`. Locale is `en` only when `Accept-Language` starts with `en`; otherwise `ar`.
  - `error_events.message`/`stack` pass through `redactText` (emails, phones, bearer tokens, DSN passwords). `route` stores the route pattern, never the raw URL.
  - `encryptSecret` format is `v1.<iv>.<tag>.<ciphertext>` (base64url), with an optional AAD `context` that binds a ciphertext to its row. `maskSecret` was added for admin display.
  - `pnpm dev` (api) runs TS directly via `@swc-node/register` (esbuild/tsx cannot emit decorator metadata) and loads the repo-root `.env` if present (`--env-file-if-exists`). Tests use `unplugin-swc` for the same reason.
  - `packages/db` gained `runMigrations()` / `MIGRATIONS_FOLDER` (used by the CLI and tests) and a `connectTimeoutSeconds` option. The deferred **seed-idempotency integration test** now exists (`packages/db/test/seed.int.test.ts`).
  - Integration tests start `postgres:18-alpine` + `redis:8-alpine` with Testcontainers. If `TEST_DATABASE_URL` + `TEST_REDIS_URL` are set, they use those services instead (`turbo.json` passes these and `DOCKER_*`/`TESTCONTAINERS_*` through). Both paths are verified: first via the fallback (throwaway PostgreSQL 18.4 cluster + local Windows Redis 3.0.504) while Docker Desktop was down, then via Testcontainers (Docker 29.8.2) with all 64 workspace tests passing.
  - Graceful shutdown: `enableShutdownHooks(SIGTERM, SIGINT)` closes Fastify, then the DB pool and Redis (`OnApplicationShutdown`). Covered by `app.close()` in tests; a real SIGTERM can't be sent on Windows, so it gets checked in the Docker setup (Task 0.7).

- **Task 0.5 deviations**
  - `redactText` / `LOG_REDACT_PATHS` moved from `apps/api` to `@wasfa/shared/redact` so the worker reuses the exact same redaction. New subpath exports `@wasfa/shared/{queues,redact}`.
  - Worker env keys: `NODE_ENV`, `REDIS_URL`, `LOG_LEVEL`, `WORKER_CONCURRENCY_SYSTEM` (default 1), `WORKER_SHUTDOWN_TIMEOUT_MS` (default 30000). `DATABASE_URL` / `ENCRYPTION_KEY` are not required yet because no job uses them; add them with the first job that does.
  - On boot the worker also enqueues one manual `system.heartbeat`, so `worker: ok` does not wait up to 5 minutes after a deploy. The 5-minute job is a BullMQ job scheduler (`upsertJobScheduler`), idempotent across restarts.
  - A stale worker does **not** make `/health/ready` return 503: the API still serves requests, and failing readiness would pull it out of rotation (and trip the deploy rollback in Task 0.8) for a background problem. The state is exposed as `ReadinessResult.worker` and logged on change only (probes poll every few seconds).
  - A missing heartbeat key counts as `stale`.
  - Graceful shutdown: `worker.close()` waits for active jobs; after `WORKER_SHUTDOWN_TIMEOUT_MS` the workers are force-closed (BullMQ re-queues the job as stalled). Unit-tested with fake workers; the real SIGTERM path is checked in Docker (Task 0.7) because Windows cannot send it.

- **Task 0.6 deviations**
  - **Next.js 16.4**: `middleware.ts` is now `proxy.ts` (`src/proxy.ts`, Node runtime), same behaviour. `next lint` no longer exists, so `lint` runs ESLint directly (flat config with `@next/eslint-plugin-next` + `react-hooks`, via the new `@wasfa/config/eslint-react`). `eslint-plugin-jsx-a11y` is not used: it does not support ESLint 10; accessibility is covered by Lighthouse (100).
  - `packages/ui` ships **TypeScript source** (`transpilePackages`), not a build. Tokens are one file, `packages/ui/tokens.css`, using Tailwind v4 `@theme static`: Tailwind utilities (`bg-primary`) and plain CSS variables (`--color-primary`) both come from it. `globals.css` lives in `src/styles/`.
  - Pages are rendered per request (`await connection()` in the root layout) because the CSP nonce is per request. Consequence: HTML is not cacheable at Cloudflare, and ISR/static pages are incompatible with nonce-based CSP. For the SEO pages in Phase 1+ decide between nonce (dynamic) and hash-based CSP; the placeholder is cheap either way.
  - CSP also sets `style-src 'self' 'nonce-…'` (no `unsafe-inline`), `frame-src 'none'`, `object-src 'none'`, `base-uri`, `form-action`, `manifest-src`. `upgrade-insecure-requests` is only added when `NEXT_PUBLIC_ENV=production`, because on a local http server it would break every sub-resource. Extra hosts come from runtime env `CSP_SCRIPT_SRC_EXTRA`, `CSP_CONNECT_SRC_EXTRA`, `CSP_FRAME_SRC_EXTRA`, `CSP_IMG_SRC_EXTRA` (space or comma separated); entries that are not plain `http(s)://host` are dropped, so a typo cannot inject a directive. Example for Turnstile: `CSP_SCRIPT_SRC_EXTRA=https://challenges.cloudflare.com CSP_FRAME_SRC_EXTRA=https://challenges.cloudflare.com`.
  - Extra headers on pages: `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin` (revisit if a popup-based OAuth flow is added).
  - `alternates.canonical` is set per page (the home page sets `/`), not in the layout: a layout-level canonical would point every route at the home page. Non-production builds also emit `<meta name="robots" content="noindex">` and `robots.txt` with `Disallow: /`.
  - `NEXT_PUBLIC_ENV`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_API_URL` are inlined at **build** time, so they are Docker build args in Task 0.7. A build without `NEXT_PUBLIC_ENV=production` is noindex by design (and scores SEO 66 in Lighthouse for that reason).
  - **Fonts / performance**: with Plex 400/500/600 and Alexandria all preloaded the page scored 90. `next/font` preloads every weight × subset, so Plex is declared twice under the same family (400 preloaded; 500/600 `preload: false`), and the placeholder uses only Plex 400 on first paint. Result: 95-96. Lighthouse's simulated throttling counts non-preloaded fonts as render-blocking, which is why `preload: false` on everything was worse (91, FCP 2.0 s). `experimental.inlineCss` reached 97 but is rejected: its inline `<style>` gets no CSP nonce.
  - Added `/healthz` (container health probe) and `global-error.tsx` (root layout failures). OG image is deferred to Phase 1 (Satori does not shape Arabic reliably).
  - Error ref on `error.tsx`: shown only when the error object carries a well-formed `WSF-XXXX-XXXX` `ref` (`ApiRequestError`). Next.js strips server error details in production, so a ref survives only for errors thrown on the client from an API response.

- **Task 0.7 deviations**
  - **Images** are `alpine:3.24` + a *stripped* Node 24 binary + `libstdc++` (copied from the `node:24-alpine` build stage), not `node:24-alpine` itself: deleting npm/yarn from the official image does not shrink it (layers), and `strip` saves 17 MB. Both bases are pinned by digest; the Alpine release must match the Node image's (`cat /etc/alpine-release`). No npm, yarn, corepack or `apk` in the final image. Runs as `node` (uid 1000).
  - Build is `turbo prune --docker` (pinned `turbo@2.11.7`, `pnpm@10.34.6`) then `pnpm install --frozen-lockfile`, `pnpm --filter "<app>..." build`, and `pnpm deploy --legacy --prod` for api/worker. `--legacy` is needed because pnpm 10 otherwise requires `inject-workspace-packages=true`, which would hurt the dev workflow. `apps/api` and `apps/worker` got `"files": ["dist"]` so the deployed copy holds no sources.
  - The `migrate` service runs `node node_modules/@wasfa/db/dist/migrate.js` (the deployed layout has no `packages/db/` directory). Seed: same image, `node node_modules/@wasfa/db/dist/seed.js`.
  - **Redis**: one instance, `maxmemory-policy noeviction` instead of `allkeys-lru` (reason and the upgrade path to a second `redis-cache` instance are in `redis.conf`). `requirepass` is injected through a compose `configs` entry from `REDIS_PASSWORD`, so it is neither in a committed file nor on a command line. `rename-command` disables FLUSHALL, FLUSHDB, KEYS, CONFIG, DEBUG; BullMQ and the rate limiter work with that (verified). Inline `#` comments are not allowed in `redis.conf` (they are parsed as arguments).
  - **Networks**: `edge` has a fixed subnet and Caddy has a fixed address (`172.30.0.2`), which is what the API gets as `TRUST_PROXY`; other containers are allocated from the upper half (`ip_range`) so they can never take it. The worker is on `internal` only (no internet) until a job needs it. A third network `egress` (outbound only) is defined for the backup job (Task 0.10).
  - **Caddy**: TLS comes from `/etc/caddy/tls.caddy`: `caddy/tls.prod.caddy` (Origin Certificate + Authenticated Origin Pulls with `client_auth require_and_verify`) or `caddy/tls.local.caddy` (`tls internal`). `CF-Connecting-IP` is overwritten with Caddy's `{client_ip}` before it reaches the API, so a forged header cannot dodge per-IP rate limits (verified: the API logged the real peer, not the forged value). HTTP/3 is disabled (UDP 443 is not published). `admin off`. Cloudflare's IP ranges are inlined in the Caddyfile and must be refreshed when Cloudflare changes them.
  - Compose files are meant to be copied to `/opt/wasfa/` as a folder (`compose.prod.yml`, `Caddyfile`, `caddy/`, `postgres/`, `redis/`, `certs/`). `compose.build.yml` adds `build:` sections for CI/local use. `HTTP_PORT` / `HTTPS_PORT` (default 80/443) and `POSTGRES_PORT` / `REDIS_PORT` (dev compose) exist because this machine already has a PostgreSQL and a Redis listening on 5432/6379.
  - The worker has `src/healthcheck.ts` (container HEALTHCHECK = heartbeat is fresh); web has `/healthz`.
  - `db:migrate` / `db:seed` now read the repo-root `.env` (`tsx --env-file-if-exists`). `pnpm dev` was verified end to end against `compose.dev.yml`: web 200 with CSP nonce, `/health/ready` 200, worker heartbeat written.
  - Verified: `docker stop` sends SIGTERM and api and worker exit 0 (worker logs "Shutting down" then "Worker stopped"); the Next.js standalone server exits 143 (it has no SIGTERM handler; acceptable, it holds no state).
  - Known gap, not fixed here: requests to *unknown* routes are not rate limited (`@fastify/rate-limit` only attaches to registered routes). They are cheap 404s, but revisit with the auth/AI routes.

- **Task 0.8 deviations**
  - **Tests in CI use Testcontainers**, not `services:` containers: every suite gets its own Postgres/Redis, so suites running in parallel cannot clash (the API and worker tests both touch `worker:heartbeat`). Same containers as local runs.
  - CI is three jobs: `verify` (lint, typecheck, test, build), `security` (gitleaks over full history, `pnpm audit --audit-level high`), `images` (main only: build → Trivy → push). Images are scanned **before** they are pushed, so a HIGH/CRITICAL fixable finding never gets the `latest` tag. All actions are pinned to commit SHAs (Dependabot keeps them current).
  - **Found and fixed by the audit gate**: `@nestjs/platform-fastify@11.2.x` pins Fastify 5.11.3, which has four high-severity advisories (auth bypass via malformed URLs, validation bypasses; fixed in 5.12.2). `pnpm-workspace.yaml` now overrides `fastify` to 5.12.5 (also pinned in `apps/api`); all 38 API tests pass on it. Remove the override once Nest ships a patched dependency.
  - `auditConfig.ignoreGhsas` accepts one advisory: `braces` ReDoS (GHSA-vfj7-8cjw-p6xm), reachable only through the ESLint plugin at dev time, no patched version exists.
  - **Deploy** (`deploy.yml` + `infra/scripts/deploy.sh`): triggered by CI success on a push to `main`, or manually with a SHA (which is also the rollback path to an older release). It copies the compose/Caddy/Postgres/Redis config and `deploy.sh` to `/opt/wasfa`, then runs the script over SSH: pull → migrate → `up -d` → poll the API container's `/health/ready` for 60 s → roll back to the previous SHA and fail on error. The host key is pinned in a secret; the GHCR token is the workflow's own `GITHUB_TOKEN`, sent over stdin and kept in a temporary Docker config (no long-lived registry credential on the server). Readiness is checked inside the container because Caddy requires Cloudflare's client certificate.
  - Required GitHub setup (Task 0.9 runbook): environment `production` with secrets `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`; run `infra/scripts/protect-main.sh` once.
  - **Migrations are not rolled back** on a failed release. Write each migration so the previous release still runs against the new schema (expand, then contract in a later release); documented in `deploy.sh`.
  - Bug found while testing the rollback and fixed: `docker compose up -d` returns non-zero when a dependency never becomes healthy, which under `set -e` skipped the rollback entirely.

## Open questions
- ~~Commit for Task 0.1 not made.~~ **Resolved:** `wasfa.online` is now its own git repo (remote `github.com/ahmed7v3/Wasefs-v1`); Task 0.1 is committed as `4d17aed`. Never commit from the `C:/Users/hp` home repo.
