# ROADMAP — Wasfa AI

> The whole product is built in **five phases (0–4)**. Phase 0 (foundation) is done; four build phases remain.
> Each phase ends with something a real user can use. Testing, deployment, and hardening run **inside** every phase (CI and deploy already exist from Phase 0); they are not separate phases.
> Executable detail lives in `docs/phases/phaseN.md`, which is written when the previous phase closes, so it always matches the real code.

| Phase | Name | A user can… | Status |
|---|---|---|---|
| 0 | Foundation & security baseline | open the placeholder site; the platform runs, deploys, and backs up | ✅ done (environment-bound carry-overs listed in Phase 1) |
| 1 | Identity, admin core & public front door | sign up (email / Google / phone), finish onboarding, see the dashboard shell; admins manage users, roles, settings, and errors; visitors see the real landing page | ✅ closed — open items carried over in `phase1.md` Notes |
| 2 | The AI product | analyze a prescription, chat with the AI assistant and its skills, all metered by credits under plan limits; admins control providers, models, routing, skills, plans, and the drug database | ⏳ next — `phase2.md` (Task 2.0 close-out done) |
| 3 | Payments, plans, referrals & growth | pay (Kashier card, or InstaPay / Vodafone Cash approved by an admin), subscribe to flexible plans with promotions and coupons, invite friends and earn points to withdraw or convert into credits; institutions get special deals; admins see everything about a user and upgrade anyone; the product encourages subscription by showing real value | planned — `phase3.md` plus `BILLING.md`, `REFERRALS-REWARDS.md`, `GROWTH-STRATEGY.md`, `ADMIN-CONSOLE-SPEC.md` written |
| 4 | Content, SEO/GEO & support | read the blog and drug pages, find the site on Google and AI answers, open support tickets and get push and email replies; the launch checklist passes | planned |

---

## Why this order

1. **Identity first.** Every later feature needs a user, an organization, permissions, audit, and an admin panel to control it (AGENT.md §5.4, §5.9). OAuth providers also require the privacy and terms pages, so they ship in Phase 1.
2. **AI product second.** It is the reason the product exists. It needs Phase 1 (users, admin) and brings its own cost controls: credits, plans, and quotas come with it, because no AI call may run without a credit reservation (§5.5, §5.8). The free plan makes it usable before payments exist.
3. **Payments third.** Plans, prices, and the credit ledger already exist from Phase 2, so payments only add gateways, subscriptions, and growth tooling on top.
4. **Content, SEO, and support last.** These are mostly independent features, and the blog/drug pages reuse the drug DB (Phase 2). The landing page, metadata, and JSON-LD basics ship earlier (Phases 0 and 1) so the domain starts gathering SEO signal from day one.

---

## Phase scopes

### Phase 1 — Identity, admin core & public front door
- Better Auth in `api`: email + password (Argon2id), Google, phone + password; Facebook shown as "coming soon" (one setting to enable later); Turnstile; rate limits per IP and per identifier; disposable-email block. Apple is deferred to the mobile app.
- Phone verification by **inbound** WhatsApp message (free, unofficial bridge, anti-ban rules, kill switch); email via Brevo free tier (300/day).
- Users, organizations, memberships, onboarding wizard (resumable).
- RBAC: permission catalog, DB roles, `@RequirePermission()`, audit log on every admin write, mandatory admin 2FA, re-auth for dangerous actions.
- Settings service (typed, Redis-cached), feature flags, public settings endpoint.
- Email sending in the worker with Arabic templates and a daily-cap guard.
- Web: auth pages, onboarding, dashboard shell, account and security settings, legal pages, flagship landing page v1, contact hub.
- Admin v1: users, organizations, roles, settings, flags, audit log, Issues page (`error_events`).
- Docs: `DATABASE.md`, `SECURITY.md`, `DESIGN-SYSTEM.md`.

### Phase 2 — The AI product
- `packages/ai`: adapters (Gemini, OpenRouter, OpenAI-compatible), router with fallbacks, normalized streaming, token/cost accounting.
- Admin: providers (encrypted keys), models (free-text ids, prices), task routes, entitlements, skills on/off, global daily spend cap + kill switch.
- Plans (data model + admin CRUD, free plan seeded), credit ledger, reserve → settle → release, quotas.
- Uploads: presigned R2, worker image pipeline (sharp, magic bytes, EXIF strip, decompression guard).
- Drug database: schema, trigram matcher (AR/EN), admin JSON/Excel import with preview and dry run.
- Prescription pipeline: `rx_extract` → matcher → `rx_verify` → validated JSON; perceptual-hash cache; `/evals/rx` accuracy harness.
- `/ai` assistant: chats, SSE streaming (thinking / search / text), skills, history; prescription result UI (RTL table, confidence badges, disclaimers).
- Docs: `DATABASE.md` updated; AI cost runbook.

### Phase 3 — Payments, plans, referrals & growth
Three releases, each deployable on its own (details in `docs/phases/phase3.md`):
- **A — Monetize:** flexible plans with prices per duration and currency; a pure price engine (promotions, coupons, deals, proration, tax, processing fees shown quietly and honestly); payment gateway layer with Kashier; manual InstaPay / Vodafone Cash payments with proof, an admin review queue and instant admin alerts; prepaid subscriptions (renew, upgrade, downgrade, grace, trial), credit packs, receipts, refunds; pricing page, checkout and billing account; admin billing console.
- **B — Grow:** organisation wallets, seats, member caps and join links; deals for any user, organisation, referral code or email domain; referral codes, points (pending / cash / credit-only buckets, 1,000 points = 100 EGP by default), rewards for sign-ups and paid subscriptions, tiers, anti-fraud; convert points to credits or request a cash withdrawal (alerts to all admins); admin growth console.
- **C — Convert & know:** value moments, a free taste of Deep mode, personalised plan advice, real-deadline offers, lifecycle emails with frequency caps, experiments with guardrail metrics; admin user 360 (subscription, payments, credits, prescription history, chats, referrals, notes) with an Upgrade dialog; campaign links, consent-aware tracking and server-side conversion events (optional, may slide to the start of Phase 4).

### Phase 4 — Content, SEO/GEO & support
- Blog: categories, tags, authors (E-E-A-T), medical reviewer, scheduling; HMAC-signed publishing API with image upload.
- Programmatic drug pages from the drug DB; country/city landing pages; JSON-LD set; split sitemaps, RSS, `llms.txt`; `SEO-GEO.md`.
- Support: tickets (user + admin inbox, canned replies, internal notes), Web Push + email replies, contact form, error-ref linking.
- Ad slots (admin-controlled placements).
- Launch readiness: full `SECURITY.md` checklist pass, load test of AI + auth endpoints, Lighthouse CI on public pages, restore drill, English locale switch (if the owner wants it at launch).

---

## Out of scope for phases 0–4
Mobile app (Expo), Stripe, Apple sign-in (needed only for iOS), mobile push via FCM, and moving `web` to Cloudflare. All were planned in ARCHITECTURE.md as "later".

**Outbound WhatsApp messages** (renewal reminders, campaigns, ticket replies) are also out of scope: the Phase 1 bridge is receive-only by design, and outbound bulk messaging is what gets numbers banned. Those features use email and Web Push; outbound WhatsApp waits for the official Meta Cloud API.
