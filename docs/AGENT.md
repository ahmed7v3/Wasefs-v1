# AGENT.md — Wasfa AI (وصفة AI)

> Read this file completely before touching any code. It is the contract every AI agent and human contributor follows.
> Domain: **wasfa.online** · Default locale: **Arabic (ar), RTL** · English is planned later.

---

## 1. What we are building

Wasfa AI is an Arabic-first medical-assistant SaaS for **pharmacists, doctors, organizations (pharmacies, clinics, hospitals) and patients** in Egypt, the Gulf and the wider Arab region.

Core product: **AI prescription analysis** — upload a handwritten or printed prescription, get an accurate, structured, RTL-formatted breakdown (drug names, strengths, dosage, frequency, duration, warnings).
Around it: an AI medical assistant (`/ai`) with skills (lab tests, drug info, X-ray *educational* reading), a subscription/credit system, a full admin panel, marketing tooling, and an SEO/GEO-driven public site.

### Priority order (when two goals conflict, the higher one wins)
1. **Security** — data, money, keys, and protection against attacks that raise server or AI cost.
2. **SEO / GEO** — visibility on Google and in AI answer engines.
3. **UI / UX** — calm, light, trustworthy, premium. Landing, checkout, dashboard, admin are the flagship screens.
4. **Performance & stability.**
5. **AI cost efficiency** — never at the expense of result quality.

---

## 2. Documentation map

| File | Purpose |
|---|---|
| `docs/AGENT.md` | This file. Rules, conventions, definition of done. |
| `docs/ARCHITECTURE.md` | System design, services, data flows, AI layer, payments, security architecture. |
| `docs/SECURITY.md` | Threat model, mandatory per-endpoint checklist, anti-ban rules, carry-overs. |
| `docs/DATABASE.md` | Conventions, table index with owner columns, indexes, anonymization. Update it in every task that touches the schema. |
| `docs/DESIGN-SYSTEM.md` | Tokens, typography, RTL rules, forms, states, component specs, visual targets. |
| `docs/SEO-GEO.md` | Keyword strategy, structured data, blog API, GEO *(to be written)*. |
| `docs/DOCKER-GUIDE.md` | Beginner-friendly Docker + deployment guide. |
| `docs/REUSE-INDEX.md` | Registry of every shared function/component with its path. **Update it whenever you add one.** |
| `docs/ROADMAP.md` | The five phases (0–4) with scope and order. Read before starting a phase. |
| `docs/phases/phaseN.md` | Executable phase plans with acceptance criteria. |

Work **one phase at a time**, in order. Do not start phase N+1 until phase N's acceptance criteria all pass, except items that depend on external accounts or the live server: those move to the next phase's carry-over task with a written reason.

---

## 3. Locked technology decisions

Do not replace any of these without an explicit decision recorded in `ARCHITECTURE.md` → "Decision log".

| Area | Choice |
|---|---|
| Language | **TypeScript** everywhere, `strict: true` |
| Runtime | **Node.js 24 LTS** |
| Monorepo | **pnpm workspaces + Turborepo** |
| Web | **Next.js** (latest stable, App Router, RSC, SSR/ISR) |
| API | **NestJS 11 on Fastify adapter** |
| Background jobs | **BullMQ** worker (separate process/container) |
| Database | **PostgreSQL 18** + **Drizzle ORM** (+ `pg_trgm`, `unaccent`) |
| Cache / queues / rate limits | **Redis 8** |
| Validation | **zod** schemas shared in `packages/shared` |
| Auth | **Better Auth** (DB sessions, Google OAuth, phone verified by inbound WhatsApp message, mandatory 2FA for admins). Authentication only: orgs, roles and permissions are our own tables. |
| Medical file storage | **Cloudflare R2, private bucket**, presigned URLs only |
| Public/blog images | ImgBB API (non-sensitive images only) |
| Image processing | **sharp** (worker) + browser-side pre-compression |
| AI | Provider-agnostic AI gateway. Launch providers: **Google Gemini** (primary) + **OpenRouter**. OpenAI-compatible adapter for others. |
| Payments | Pluggable gateway layer. Launch: **Kashier** + manual (Vodafone Cash / InstaPay / WhatsApp, admin-approved). Stripe later. |
| Edge | **Cloudflare** (DNS, WAF, DDoS, Turnstile, cache) |
| Reverse proxy | **Caddy** (TLS to Cloudflare origin, headers) |
| Hosting | One Linux server running **Docker Compose** (AWS EC2 to start; upgrade by resizing) |
| CI/CD | **GitHub Actions** → images on **GHCR** → server pulls |
| Icons | **lucide-react** (single library; no hand-drawn icons) |
| Fonts | **IBM Plex Sans Arabic** only (headings 700, body 400), self-hosted via `next/font` |
| Theme | Light by default; dark mode is secondary/optional |
| Brand colors | Primary navy `#1E3A8A`, accent soft blue `#60A5FA`, bg `#F5F7FB` (public pages: warm `#F6F6F4`), surface `#FFFFFF`, text `#0B1220` |
| Mobile (later) | Expo (React Native) reusing `packages/shared` and the same API |

### Explicitly NOT used
- ❌ **RxNorm** — we use our own drug database (`drugs` tables, SFDA + admin imports).
- ❌ **Chatwoot** and ❌ **live chat** — support = WhatsApp / Telegram / phone buttons + in-house ticket system.
- ❌ ImgBB (or any public host) for prescriptions, lab results, X-rays, or anything with personal/health data.
- ❌ Storing raw card data anywhere. Cards are entered only on the gateway's hosted page/iframe.

---

## 4. Monorepo layout

```
wasfa.online/
├─ apps/
│  ├─ web/        # Next.js — public site, auth, onboarding, dashboard, /ai, admin UI
│  ├─ api/        # NestJS (Fastify) — REST + SSE, all business logic, the ONLY thing that touches the DB
│  └─ worker/     # BullMQ consumers — image processing, AI jobs, emails, push, subscription expiry, backups
├─ packages/
│  ├─ shared/     # zod schemas, types, constants, error codes, money/currency utils, i18n keys
│  ├─ db/         # Drizzle schema, migrations, seed scripts (imported by api + worker only)
│  ├─ ai/         # AI gateway: provider adapters, router, streaming normalizer, skills loader
│  ├─ ui/         # Shared React components (design system) used by web (and later mobile-web)
│  └─ config/     # tsconfig, eslint, prettier presets
├─ skills/        # AI skill folders (SKILL.md format, agentskills.io style)
├─ infra/
│  ├─ docker/     # Dockerfiles, compose files, Caddyfile
│  └─ scripts/    # backup, restore, provisioning helpers
├─ docs/
└─ .github/workflows/
```

**Boundary rules**
- `apps/web` never imports `packages/db` and never holds secrets other than public keys. It calls `apps/api`.
- Only `apps/api` and `apps/worker` talk to Postgres, Redis, R2, AI providers, and payment gateways.
- Anything used in two places goes into a `packages/*` module and is registered in `docs/REUSE-INDEX.md`.

---

## 5. Golden rules (non-negotiable)

### 5.1 Reuse before rebuild
Before writing a helper, search `docs/REUSE-INDEX.md` and `packages/`. If it exists, use it. If you create one, add a row: `name | path | purpose | example`.

### 5.2 Validate everything at the boundary
- Every API input (body, query, params, headers we read, webhook payloads) is parsed with a **zod schema from `packages/shared`**. Unknown keys are stripped.
- Every AI output that we display or store is parsed with a zod schema. If parsing fails → retry once with a repair prompt → else return a typed error. **Never render unvalidated model output as structured data.**

### 5.3 Never trust the client
Prices, plan limits, credit costs, discounts, roles, and ownership are always computed/checked on the server. The client only sends IDs and intent.

### 5.4 Tenant & ownership isolation
Every query on user-owned data filters by `userId` (or `organizationId` + membership check). Use the shared `scopedRepo` helpers (`apps/api/src/common/scoped-repo.ts`) — never write an unscoped `select` on user data. ESLint rejects `db.select/insert/update/delete/execute/transaction` in `*.service.ts`, `*.controller.ts`, `*.guard.ts` and `*.interceptor.ts`: queries live in `*.repo.ts`. Every route is authenticated unless it says `@Public()`; admin routes live under `/admin/*` with `@RequirePermission`; tests of owner-scoped endpoints use `wrongOwnerIsHidden`. Admin access goes through explicit admin routes with permission checks and audit logs.

### 5.5 Money and credits
- Money is stored as **integer minor units** (`amountMinor`, e.g. piasters/halalas/cents) + `currency` (ISO 4217). Never floats.
- Credits change **only** through the `credit_ledger` (append-only). Balance = sum of ledger, cached.
- AI usage: **reserve credits before the call → settle actual usage after → release the remainder**. No call without a successful reservation.
- All payment webhooks are **signature-verified** and **idempotent** (unique `providerEventId`).

### 5.6 Errors
- Users never see stack traces, provider names, SQL, or raw messages.
- Every unexpected error gets a **reference code** (`WSF-XXXX-XXXX`), is stored in `error_events` with full technical context (redacted), and the user sees a friendly Arabic message + the code + "contact support".
- Use typed error codes from `packages/shared/errors`.

### 5.7 Secrets & logs
- Secrets only via environment variables / Docker secrets, validated at boot by a zod env schema. App refuses to start if invalid.
- API keys for AI providers/payment gateways that the admin edits are stored **encrypted at rest** (AES-256-GCM, key from env), shown masked in admin.
- Logs (pino) redact: passwords, tokens, cookies, `authorization`, phone numbers, emails, file URLs, prescription content.

### 5.8 Cost protection (denial-of-wallet)
Every endpoint that triggers AI, uploads, email/SMS/WhatsApp, or heavy DB work must have: auth (unless explicitly public), rate limit (Redis), quota check, input-size limit, and Turnstile where public. See `ARCHITECTURE.md §8`.

### 5.9 Admin-controlled, not hard-coded
Plans, prices, limits, AI model routing, feature flags, site settings (logo, phones, WhatsApp, socials), tracking pixels, payment gateway on/off, ads, and texts that marketing may change all live in the DB and are editable from admin. Code holds **safe defaults only**.

### 5.10 Arabic-first, RTL-correct
- `<html lang="ar" dir="rtl">` by default.
- Use **logical CSS properties** (`ms-*`, `me-*`, `ps-*`, `start`, `end`), never `left`/`right` for layout.
- All user-facing strings go through the i18n layer (`packages/shared/i18n`), keyed — no hard-coded Arabic in components (except content pages).
- Numbers: Western digits by default (admin setting), dates in Gregorian + optional Hijri display.

### 5.11 Medical safety
- The product **assists**; it does not diagnose. Every analysis/assistant answer that includes medical judgment carries a short disclaimer and highlights low-confidence items.
- X-ray / imaging skills are labeled **educational**, always recommend professional review.
- Never fabricate drug names. If confidence is low, say so and show the raw text read from the image.

---

## 6. Coding conventions

- **Files:** `kebab-case.ts`; React components `PascalCase.tsx`; one NestJS module per domain (`auth`, `users`, `orgs`, `plans`, `billing`, `credits`, `ai`, `files`, `drugs`, `blog`, `support`, `admin`, `marketing`, `tracking`, `errors`, `settings`, `notifications`).
- **Nest module shape:** `x.module.ts`, `x.controller.ts`, `x.service.ts`, `x.repo.ts` (DB access only), `x.schemas.ts` (re-exports from shared), `x.spec.ts`.
- **Functions:** small, pure where possible; no business logic in controllers.
- **Comments:** explain *why*, not *what*.
- **Imports:** via package names (`@wasfa/shared`, `@wasfa/db`, `@wasfa/ai`, `@wasfa/ui`).
- **Commits:** Conventional Commits (`feat(api): …`, `fix(web): …`, `chore(infra): …`, `docs: …`).
- **Branches:** `main` is protected and always deployable; work on `phaseN/<short-task>` branches.

---

## 7. Testing

| Layer | Tool | Minimum |
|---|---|---|
| Unit | Vitest | All money, credit, plan-limit, coupon, permission, and parsing logic |
| API integration | Vitest + Testcontainers (Postgres, Redis) | Every endpoint: happy path, auth required, wrong owner, invalid input, rate limit |
| E2E | Playwright | Signup → onboarding → analyze → upgrade flow; admin login + key screens |
| Security | `pnpm audit`, gitleaks, Trivy (CI) | Zero high/critical |
| Performance | Lighthouse CI on public pages | Perf ≥ 90 mobile, SEO = 100, A11y ≥ 95 |

---

## 8. Definition of done (for every task)

- [ ] Types pass (`pnpm typecheck`), lint passes (`pnpm lint`), tests pass (`pnpm test`).
- [ ] Inputs validated with shared zod schemas; ownership checked; rate limit applied where relevant.
- [ ] No secrets, no `console.log`, no `any` without a justified comment.
- [ ] User-facing strings via i18n; RTL verified at 360px width and desktop.
- [ ] New shared helpers registered in `docs/REUSE-INDEX.md`.
- [ ] Admin-controllable values are read from settings, not constants.
- [ ] Phase file checkbox ticked and any deviation written in the phase's "Notes" section.

---

## 9. How an agent should execute a phase

1. Read `AGENT.md` → `ARCHITECTURE.md` → the target `phases/phaseN.md`.
2. Work through tasks **in order**; each task lists files, steps, and acceptance checks.
3. After each task: run its verification commands, tick the checkbox, commit.
4. If something in the plan is impossible or clearly wrong, **stop and write the issue in the phase's "Open questions"** instead of inventing a new architecture.
5. At phase end, run the full acceptance checklist and summarize results (what passed, what failed, with output).
