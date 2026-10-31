# ROADMAP — Wasfa AI

> The whole product is built in **seven phases (0–6)**; Phase 6 runs ahead of the rest of Phase 4 and Phase 5 by owner priority. Phases 0–3 are built (owner-side items are listed in each phase file); Phase 4 is planned in detail and Phase 5 closes the launch.
> Each phase ends with something a real user can use. Testing, deployment, and hardening run **inside** every phase (CI and deploy already exist from Phase 0); they are not separate phases.
> Executable detail lives in `docs/phases/phaseN.md`, which is written when the previous phase closes, so it always matches the real code.

| Phase | Name | A user can… | Status |
|---|---|---|---|
| 0 | Foundation & security baseline | open the placeholder site; the platform runs, deploys, and backs up | ✅ done (environment-bound carry-overs listed in Phase 1) |
| 1 | Identity, admin core & public front door | sign up (email / Google / phone), finish onboarding, see the dashboard shell; admins manage users, roles, settings, and errors; visitors see the real landing page | ✅ closed — open items carried over in `phase1.md` Notes |
| 2 | The AI product | analyze a prescription, chat with the AI assistant and its skills, all metered by credits under plan limits; admins control providers, models, routing, skills, plans, and the drug database | ✅ built — owner-side items open in `phase2.md` |
| 3 | Payments, plans, referrals & growth | pay (Kashier card, or InstaPay / Vodafone Cash approved by an admin), subscribe to flexible plans with promotions and coupons, invite friends and earn points to withdraw or convert into credits; institutions get special deals; admins see everything about a user and upgrade anyone; the product encourages subscription by showing real value | ✅ built (final verification 2026-10-18) — open items in `phase3.md` Notes |
| 4 | Discoverability, content engine, campaigns & ad inventory | find the site on Google and in AI answers, read reviewed articles and medicine pages; the owner publishes from a phone or through the Publishing API; campaigns are tracked with consent; ad placements can be sold | planned — `phase4.md` plus `SEO-GEO.md`, `CONTENT-PLATFORM.md`, `PUBLISHING-API.md`, `TRACKING.md`, `ADS.md`, `BRAND-AND-HOMEPAGE.md` |
| 5 | Support & launch readiness | open support tickets and get push and email replies; the launch checklist passes | planned |
| 6 | WhatsApp agent v2 & Rx Engine v2 | get an answer to every WhatsApp message, start fresh with «جديد», analyse with `/analyze` and receive a full PDF report and phone calendar; trust prescription readings held to ≥ 95 % asserted precision in every handwriting stratum; check what the pharmacy dispensed and keep the treatment plan with Wasfa Companion | planned, **runs now, before Phase 4 WP4–WP8 and Phase 5** (decision 73) — `phase6.md` plus `WA-AGENT-RUNTIME.md`, `RX-ENGINE.md`, `RX-REPORT.md`, `WA-COMPANION.md` |

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

### Phase 4 — Discoverability, content engine, campaigns & ad inventory
Three releases plus a final gate (details in `docs/phases/phase4.md`; specs `SEO-GEO.md`, `CONTENT-PLATFORM.md`, `PUBLISHING-API.md`, `TRACKING.md`, `ADS.md`, `BRAND-AND-HOMEPAGE.md`):
- **A — Fast, credible front door:** live-site fixes (Cloudflare HTML rewriting behind hydration error #418 and the CSP violation), performance and Lighthouse CI, Arabic/English URL architecture, SEO core (robots from settings, sitemap index, hreflang, structured data, IndexNow, `llms.txt`, AI crawler policy); new logo and favicon system, media pipeline and OG renderer; homepage refresh, feature, audience and trust pages.
- **B — Content engine:** blog, guides and glossary with authors, medical reviewers, review workflow, scheduling, revisions and an SEO panel, managed from a phone; the Publishing API for AI agents and automation; medicine pages from reviewed monographs; Search Console sync, SEO dashboard and health checks.
- **C — Measure & monetise:** campaign links and attribution, consent management, pixels and server-side conversions with deduplication (the deferred Phase 3 Task 3.16); first-party advertising inventory that never touches sensitive pages or medical data.

### Phase 6 — WhatsApp agent v2 & Rx Engine v2 (runs before the rest of Phase 4 and Phase 5)
Three releases on two parallel tracks (details in `docs/phases/phase6.md`):
- **A — Never silent:** reliability core (turn queue, lock with fencing, turn store, failure policy without the busy line, exactly-once tools, outbox delivery of paid results, media hardening incl. HEIC/PDF), the agent codebase restructured, sessions («جديد»), the command layer (`/analyze`, help, balance, report, privacy…), attachment handles, WhatsApp formatting.
- **B — Reads anything:** gold set and evaluation v2 with recorded replay in CI; Rx Engine v2 (quality gate, master image and zoom crops, handwriting confusion model, evidence fusion, cross-model adjudication, calibrated tiers) promoted only through the holdout gate; the agent's drug lookup and grounding guards on the same engine.
- **C — Stays with the patient:** PDF report v2 and `.ics` calendar; Wasfa Companion (dispense check, medicine cabinet, personal schedule, opt-in reminders, safety net, voice briefing).

### Phase 5 — Support & launch readiness
- Support: tickets (user + admin inbox, canned replies, internal notes), Web Push + email replies, contact form into tickets, error-ref linking.
- Launch readiness: full `SECURITY.md` checklist pass, load test of AI + auth endpoints, restore drill, English UI for the signed-in app (if the owner wants it at launch), Phase 4 carry-overs.
---

## Out of scope for phases 0–5
Mobile app (Expo), Stripe, Apple sign-in (needed only for iOS), mobile push via FCM, and moving `web` to Cloudflare. All were planned in ARCHITECTURE.md as "later".

**Outbound WhatsApp messages** (renewal reminders, campaigns, ticket replies) are also out of scope: the Phase 1 bridge is receive-only by design, and outbound bulk messaging is what gets numbers banned. Those features use email and Web Push; outbound WhatsApp waits for the official Meta Cloud API.
