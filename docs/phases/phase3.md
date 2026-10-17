# Phase 3 — Payments, Plans, Referrals & Growth

> Goal: people can pay (card through Kashier, or InstaPay / Vodafone Cash with admin approval), subscribe to flexible plans with promotions and coupons, and earn points by inviting others, withdrawing them as cash or turning them into credits. Institutions get special arrangements. Admins run all of it from a clear console, see everything about a user (including prescription history), and can upgrade anyone in two clicks. The whole experience encourages subscription by showing real value, never by pressure.
> Prerequisites: read `docs/AGENT.md`, `docs/ARCHITECTURE.md` (§7, §8, decision log), `docs/SECURITY.md`, `docs/DESIGN-SYSTEM.md`, and the Phase 1 and Phase 2 Notes. **Then the four specs of this phase, which are the source of truth for rules and screens:**
> - `docs/BILLING.md` — catalog, price engine, orders, payments, subscriptions, organisations, alerts
> - `docs/REFERRALS-REWARDS.md` — referrals, points, withdrawals, deals, anti-fraud
> - `docs/GROWTH-STRATEGY.md` — conversion mechanisms, guardrails, lifecycle, experiments
> - `docs/ADMIN-CONSOLE-SPEC.md` — every admin screen and the user 360 view

---

## Outcome

- **Pay:** `/pricing` shows live plans, promotions and a personalised recommendation; checkout shows a complete, honest summary on first render and takes a Kashier card payment, or an InstaPay / Vodafone Cash transfer to **01014677026** with a receipt screenshot that an admin approves in under a minute.
- **Subscribe:** prepaid periods of 1/3/6/12 months, upgrades with proration, scheduled downgrades, grace period, reminders with one-tap renewal, trials, credit packs, receipts. Plan credits arrive monthly.
- **Discount:** automatic promotions displayed on the plans page, coupons (single, bulk, private to a user or organisation), best-of stacking, real deadlines.
- **Invite and earn:** every user has a code and link; sign-ups give both sides points/credits, paid subscriptions give the referrer a **withdrawable** reward (default 1,000 points = 100 EGP, minimum withdrawal 1,000 points), points convert into credits with a bonus. Withdrawal requests alert **all admins** by email, in-app, Telegram (and WhatsApp once approved).
- **Institutions:** organisation wallets, seats, member caps, join links (`/join/<slug>`) with member prices, deals for any user, organisation, referral code or email domain.
- **Convert without pressure:** value moments, a free taste of Deep mode, personalised plan advice, real-deadline offers, a lifecycle that respects frequency caps, and measured experiments with guardrail metrics.
- **Control:** `/admin/billing/*` and `/admin/growth/*` consoles, a command palette, and a user 360 page with subscription, payments, credits, **prescription history**, chats (read-only, audited), referrals, notes and an **Upgrade** dialog.

### Targets (checked in the final checklist)

| Metric | Target |
|---|---|
| Price correctness | Engine property tests (10,000 baskets): total = sum of lines, never negative, deterministic |
| Payment integrity | 10 duplicate webhooks ⇒ exactly 1 activation; amount mismatch ⇒ never activates; reconciliation zero drift |
| Concurrency | 100 parallel redemptions of a 10-use coupon ⇒ exactly 10; parallel withdrawals never exceed balance |
| Manual review | median time from proof upload to alert delivered ≤ 30 s; review pane usable at 360 px |
| Checkout | Lighthouse mobile Performance ≥ 90, Accessibility 100; total visible on first render (E2E-asserted) |
| Ledger health | credits and points reconcile jobs report 0 drift |
| Admin | any user/order/payment/coupon found by palette in ≤ 3 keystrokes after typing the id fragment |
| Conversion instrumentation | every funnel step in `growth_events`; guardrail metrics visible per experiment |

---

## How this phase is executed (token-lean protocol)

The owner asked for few delegations. The rules for this phase:

1. **No scouts, no runners.** The specs above already contain the context; searching costs more than it saves.
2. **Builder work packages (WP).** Each WP is **one** `builder` (Sonnet) brief covering several tasks, 10 WPs in total (table below). A WP brief is short because it *points at spec sections* instead of repeating them: Goal · "read these spec sections" · decisions from this file · Verify commands · Return (≤ 150 words: files changed, tests run, deviations).
3. **The main session** (Opus) does only: Task 3.0 spikes, the Notes and Decisions, reviewing each WP with `git diff --stat` plus the test output, fixing small things directly, and Task 3.17. It does not re-read files the brief already specified.
4. **Parallelism ≤ 2** at a time, and only between WPs with no shared files (listed). Commit selectively; never stash (project memory).
5. **Each WP ends green** (`lint`, `typecheck`, its own tests) before review; the full workspace run happens once per milestone.
6. If a WP fails twice, the main session finishes it. If a WP reveals a spec gap, the main session edits the spec first, then re-briefs.

| WP | Tasks | Milestone | Depends on | Parallel with |
|---|---|---|---|---|
| WP1 | 3.1 data model + 3.2 price engine | A | 3.0 | – |
| WP2 | 3.3 payments core + 3.4 manual payments & alerts | A | WP1 | WP3 |
| WP3 | 3.5 subscriptions + 3.6 promotions & coupons | A | WP1 | WP2 |
| WP4 | 3.7 web: pricing, checkout, billing account | A | WP2, WP3 | WP5 |
| WP5 | 3.8 admin billing console | A | WP2, WP3 | WP4 |
| WP6 | 3.9 organisations + 3.10 deals | B | Release A | WP7 |
| WP7 | 3.11 points & rewards + 3.12 withdrawals | B | Release A | WP6 |
| WP8 | 3.13 admin growth console | B | WP6, WP7 | – |
| WP9 | 3.14 conversion engine | C | Release B | WP10 |
| WP10 | 3.15 user 360 + upgrade dialog | C | Release A | WP9 |
| (opt.) WP11 | 3.16 campaigns & tracking | C | WP7 | – |

**Releases:** A (Monetize) ships when WP1–5 pass the gate; B (Grow) when WP6–8 do; C (Convert & know) last. Each release is deployable and valuable alone.

---

## Owner prerequisites (start now)

| Item | Needed by | Notes |
|---|---|---|
| **Kashier merchant account** (test + live), merchant id, API keys, webhook secret, the fee schedule from the contract | 3.3 | Test keys are enough to build; live keys before Release A. |
| **Confirm the payment numbers**: InstaPay and Vodafone Cash receiving number **01014677026**, the holder name shown to customers, whether InstaPay uses a payment address instead | 3.4 | Seeded as editable data; confirm the wording customers see. |
| **Accountant answers**: VAT rate and whether it applies to these sales; electronic receipt/invoice obligations; **tax and legal treatment of paying cash rewards to individuals**; whether points need a terms page | 3.0 | Blocks enabling real payouts, not building. |
| **Refund policy decision** (window days, who qualifies) | 3.5 | Default 7 days. |
| **Telegram bot** token and an admin group (reuse the backup-alert bot if it exists) | 3.4 | Primary instant alert channel next to email. |
| **WhatsApp alerts decision** (Open question 1) | 3.4 | Off until the owner approves the risk. |
| **Decide the starting prices** from the BILLING §2.2 proposal after the Phase 2 evaluation gives the real cost per page | 3.8 | The margin calculator uses the real number. |
| **Reward defaults** you are comfortable with (BILLING/REFERRALS defaults) | 3.11 | Everything is changeable later in admin. |
| **Terms/privacy text updates**: payments, refunds, rewards program, admin access to prescription history for support | 3.17 | Drafts supplied by us; final wording owner/lawyer. |
| Phase 2 owner items still open (provider keys, R2 check, eval set) | 3.0 | The conversion mechanisms (Deep taste, margins) depend on them. |

---

## Decisions for this phase (record in ARCHITECTURE.md → Decision log, rows 34 onward)

1. **Prepaid periods, no card auto-renewal.** Fewer failure modes, no stored card tokens, matches how most Egyptian customers pay (wallets, InstaPay). Recurring card billing is a later decision.
2. **Orders and payments are separate**; the quote is stored with an HMAC hash and recomputed; payments must equal the order total.
3. **One pure price engine in `@wasfa/shared`**, used by API (authoritative) and web (display only). Best-of discount by default; stacking is opt-in per discount.
4. **Quiet but honest fees**: complete summary on first render, one combined expandable "الضريبة والرسوم" line, exact total on the Pay button; prefer tax-inclusive pricing (BILLING §6). No fee ever appears after the Pay click.
5. **Manual payments are always human-approved**, with proof, duplicate detection, SLA alerts, and four-eyes above a threshold. The receiving number is admin data, edited only through a protected flow.
6. **Points: integer, three buckets** (`pending`, `cash`, `credit_only`), append-only ledger, 1,000 points = 100 EGP by default, hold before release, reversals on refund.
7. **Rewards are computed on the net paid subtotal** (no tax, no fees) and paid in points; the rate is a setting.
8. **Withdrawals are paid manually by admins**, destinations are encrypted with a cooldown, first withdrawal gets extra review.
9. **Admin alert channels**: in-app + email + Telegram by default. **WhatsApp outbound is limited to admin numbers that opted in by messaging the bridge**, capped and behind a kill switch, and ships disabled. This is a deliberate, narrow exception to the Phase 1 "receive-only bridge" rule (decision 19); the owner must approve it (Open question 1).
10. **`plan_assignments` stays the effective-plan record**; subscriptions reference it (`subscription_id`), so quota and credits code from Phase 2 is untouched.
11. **Deals engine** with a fixed precedence (user > organisation membership > referral code > email domain), one deal per purchase.
12. **Admin access to health data** (prescriptions, chats) needs a dedicated permission, a reason per access session, an audit row per open, and no export.
13. **No dark patterns** (GROWTH-STRATEGY §2) are enforced by tests, not just policy: countdowns server-backed, one prompt per session, no post-click fees.
14. **Organisation wallets** finish the Phase 2 gap: members spend the organisation's credits first, optional personal fallback, optional member caps.
15. **Gateway credentials live in the database, encrypted**, like AI provider keys; test/live mode switch.
16. **No automatic FX at checkout.** Each plan has explicit prices per currency; the FX rate setting is only for the margin calculator and reports.
17. **Points are a rewards program, not money**: non-transferable, no purchase, terms page, optional expiry.

---

# Milestone A — Monetize

## Task 3.0 — Gate, spikes and decisions (main session)

1. Close or list every open Phase 2 final-checklist item that Phase 3 depends on (provider keys for margins, org wallets are *built here*, monthly caps are *built in 3.5*). Production is healthy on the Phase 2 head.
2. **Kashier spike** (half a day, with test credentials): read Kashier's current documentation, build a throwaway script to create a hosted-page checkout, complete a test payment, and capture the redirect, the hash/signature scheme, the webhook payload and signature header, the refund endpoint, and the status-query endpoint. Record **exact fields, versions and sample payloads** (secrets removed) in Notes, and save recorded fixtures under `apps/api/test/fixtures/kashier/`. Nothing outside `kashier.gateway.ts` may depend on them (the same discipline as Decision 2 of Phase 2).
3. Confirm with the owner: the answers in the prerequisites table that block design (VAT mode, refund window, alerts channels).
4. Write Decisions 1–17 into `ARCHITECTURE.md`; add the Phase 3 rows to the endpoint register skeleton in `SECURITY.md`.
5. Branch naming: `phase3/<wp>`; work from an up-to-date `main`.

Acceptance
- [ ] Kashier fixtures and field notes recorded; a real test-mode payment worked end to end in the spike.
- [ ] Owner decisions needed to start recorded (or defaults accepted in writing in Notes).

## Task 3.1 — Data model, value sets and permissions (WP1)

**Spec:** BILLING §2, §5.1, §7.1, §8, §9; REFERRALS-REWARDS §3–§8; ADMIN-CONSOLE-SPEC §10. **Files:** `packages/db/src/schema/{billing,subscriptions,promotions,rewards,deals,growth,alerts}.ts`, migrations `0010_billing_core.sql`, `0011_rewards_deals.sql`, `0012_growth_alerts.sql`, `packages/shared/src/{billing,rewards,growth}.ts`, `packages/shared/src/schemas/{billing,rewards,deals,growth}.ts`, `docs/DATABASE.md` (Phase 3 section).

Tables (conventions per DATABASE.md §1; closed sets are tuples in `@wasfa/shared` + CHECK; money as `*_minor` integers):
- **Billing core (0010):** `plan_prices`, `credit_packs`, `credit_pack_prices`, `tax_rules`, `payment_methods`, `payment_gateways`, `orders`, `payments`, `payment_events`, `refunds`, `order_number_seq`, `outbox` (generic transactional outbox: `topic`, `payload`, `attempts`, `available_at`, `processed_at`). Alter `plans` (tagline, features, trial_days, pin_recommended, max_members, fair-use note); `plan_assignments.subscription_id`.
- **Subscriptions & offers:** `subscriptions`, `subscription_events`, `personal_offers`, `taste_grants`, `user_notifications`.
- **Promotions:** `promotions`, `coupons`, `coupon_redemptions`.
- **Rewards & deals (0011):** `referral_programs`, `referral_codes`, `referrals`, `reward_rules`, `reward_decisions`, `referral_tiers`, `points_wallets`, `points_ledger`, `reward_debts`, `payout_methods`, `payout_destinations`, `withdrawal_requests`, `deals`, `deal_targets`, `organization_join_links`, `organization_member_limits`; `organization_members.joined_via_link_id`.
- **Growth & alerts (0012):** `growth_events`, `growth_rules`, `experiments` (name, flag key, variants, status), `admin_alerts`, `alert_deliveries`, `admin_alert_prefs`, `user_notes`, `phi_access_sessions` (admin, user, reason, expires_at), `campaign_links` (used by 3.16).
- **Append-only for `wasfa_api`** (SELECT, INSERT only): `credit_ledger` (already), `points_ledger`, `payment_events`, `subscription_events`, `phi_access_sessions` audit rows via `audit_logs`.
- Extend `CREDIT_LEDGER_KINDS` with `purchase`, `points_conversion`, `trial_grant`, `reward_bonus`.
- **Permissions** added to the catalog: the list in ADMIN-CONSOLE-SPEC §10. Seeded role grants as listed there (new roles only at creation, per the Phase 1 seed rule; a data migration adds the new permissions to existing `finance`, `support`, `marketing` roles).
- **Settings registry:** `billing`, `rewards`, `growth` with the keys in BILLING §11, REFERRALS §9, GROWTH §9. Public subset marked.
- **Seed (insert-only):** plans `plus`, `pro`, `clinic` (hidden until the owner publishes prices), tax rule (disabled until the accountant answers), payment methods `kashier_card` (disabled until keys), `instapay` and `vodafone_cash` (enabled, number `01014677026`), default reward program and rules (defaults in REFERRALS §3.3, **`rewards.enabled = false` until the owner switches it on**), referral program `standard`.

Acceptance
- [x] Migrations apply on Postgres 18; integration tests assert every CHECK, FK and unique constraint **by name**, including the append-only grants and idempotency keys.
- [x] `DATABASE.md` documents each table, ownership and retention (payment proofs: `billing.proofRetentionDays` default 365; `growth_events`: 13 months; `admin_alerts`: 90 days).

## Task 3.2 — Price engine and catalog API (WP1)

**Spec:** BILLING §3, §4, §6. **Files:** `packages/shared/src/price-engine.ts` (+ `price-engine.test.ts`), `apps/api/src/catalog/*`, `apps/api/src/billing/quote.service.ts`.

1. Implement the engine exactly as BILLING §4, including deal override, promotions/coupon stacking, proration, tax (added/inclusive), grossed-up processing fee, free-order and minimum-charge rules, `display` hints (struck price, savings text, the combined fee line, button total).
2. Tests: table cases for every step; **property tests** over 10,000 random baskets (invariants in BILLING §4); golden fixtures for the seeded catalog in EGP and SAR; rounding edge cases.
3. API: `GET /catalog` (public: plans with prices in the visitor's currency, promotions to display, tax mode, methods summary), `GET /me/recommendation` (plan advice from usage, GROWTH §7), `POST /billing/quote` (auth; body `{planKey, months, couponCode?, methodKey?}`; returns the quote + `quoteId`). Currency from `CF-IPCountry` with a `?currency=` override and a persisted choice; unknown currencies fall back to the default.
4. Quote storage: short-lived (15 min) in Redis with the HMAC hash; checkout order creation (3.3) verifies it.

Acceptance
- [x] Engine tests green including property tests; no I/O imports in the engine file (lint rule).
- [x] `/catalog` is cacheable (per currency/country), contains no private coupon or deal data; unauthenticated `/billing/quote` ⇒ 401.

## Task 3.3 — Payments core, Kashier, reconciliation (WP2)

**Spec:** BILLING §5.1–§5.4, §5.6, §12. **Files:** `apps/api/src/payments/*` (service, repo, controller, webhook controller, gateways/{kashier,fake}.gateway.ts), `apps/api/src/orders/*`, `apps/worker/src/jobs/{payments-reconcile,outbox}.job.ts`.

1. `POST /billing/orders {quoteId, methodKey}` ⇒ re-verify the quote hash, create `order(pending_payment)` and `payment`, reserve the coupon, and for a gateway method call `createCheckout` ⇒ `{orderId, redirectUrl}`.
2. `PaymentsService.transition` with row locks and `payment_events`; `onSucceeded` activation per BILLING §5.3 (the subscription part calls the 3.5 service through an interface, with a stub until 3.5 lands; credit packs are handled here).
3. Webhook controller `POST /webhooks/:gateway` as BILLING §5.6. Return page `GET /billing/orders/:id` is a status read for polling; it never marks anything paid.
4. Kashier adapter from the spike fixtures; **fake gateway** with scripted scenarios.
5. Worker: outbox drainer, reconciliation every 5 min (BILLING §5.6), order expiry (release coupon, mark `expired`), nightly paid-vs-ledger consistency check.
6. Free orders (BILLING §5.4).
7. Refund support in the service (admin UI comes in 3.8): recording owner-issued refunds with an external reference, status transitions, effects (subscription/credits/rewards hooks through interfaces).

Acceptance
- [x] Tests: success, failure, expiry, duplicate webhooks ×10 ⇒ one activation, bad signature ⇒ 401 + recorded, **amount mismatch ⇒ no activation + alert**, webhook before return, return before webhook, reconcile picks up a lost webhook, crash between commit and outbox is safe.
- [x] Orders cannot be created from an altered or expired quote; a user cannot read or pay another owner's order (`NOT_FOUND`).
- [ ] Kashier verified against a real test-mode payment with recorded fixtures (checkout and status done 2026-10-16; webhook and refund still to record, see Notes).

## Task 3.4 — Manual payments and the admin alert service (WP2)

**Spec:** BILLING §5.5, §5.7, §10, §12. **Files:** `apps/api/src/payments/manual/*`, `apps/api/src/alerts/*`, `apps/worker/src/{alerts,notifications}/*`, `packages/shared/src/schemas/manual-payment.ts`, extend `files` with purpose `payment_proof`.

1. Customer endpoints: `GET /billing/orders/:id/instructions` (method text with placeholders filled, account number, reference `WSP-XXXX`, expiry), `POST /billing/payments/:id/proof {txnId, senderPhone, fileId}` (≤ 3 attempts, rate-limited), status polling.
2. Proof files use the Phase 2 upload pipeline (presign, magic bytes, sharp re-encode, private R2, retention per `proofRetentionDays`).
3. Duplicate defence (BILLING §5.7.3): unique transaction id per method; SHA-256 and dHash comparison with earlier proofs; flags stored on the payment.
4. Admin endpoints: review queue list/detail, `approve` (fresh auth), `reject` (reason), `request_better_proof`, second approval above the threshold, soft lock "being reviewed by". Approve calls `onSucceeded`.
5. **`AdminAlertService`** (BILLING §10): recipients by permission and preferences, channels in-app, email (worker, bypassing the daily cap for critical kinds), Telegram, WhatsApp (adapter + opt-in command in the bridge + kill switch, **disabled by default**), throttling and digest, delivery log. Alert kinds listed in BILLING §10 are wired for payments now and for withdrawals in 3.12.
6. SLA job: reminders for overdue reviews every 30 minutes within business hours.
7. Protected edit flow for a manual method's account number (BILLING §12).
8. User notifications: approved, rejected (with reason), please resubmit (email + `user_notifications`).

Acceptance
- [x] Tests: happy path, duplicate txn id, duplicate image, wrong-owner proof, 4th submission refused, second-approval flow, admin cannot review own payment, account-number change cooldown and notices, alert fan-out to two admins with different preferences, WhatsApp channel off by default and capped when on, no proof image or full phone in any alert body.
- [x] Proof upload to alert delivered measured ≤ 30 s (Notes).

## Task 3.5 — Subscriptions, credits, lifecycle (WP3)

**Spec:** BILLING §7, §8 (wallet part), §9. **Files:** `apps/api/src/subscriptions/*`, `apps/worker/src/jobs/{subscriptions,credits-grant}.job.ts`, extend `apps/api/src/{quota,credits,plans}`.

1. `SubscriptionsService`: activate/extend (same plan), upgrade with proration, scheduled downgrade, trial start (once per owner and verified phone), cancel at period end, admin grant/extend/end (used by 3.15), expiry with grace, events timeline. Each paid period creates/extends the `plan_assignments` row.
2. Monthly credit grants on anniversary (idempotent), credit pack purchase grants, trial grants, expiry of free credits at period end (already Phase 2) kept consistent.
3. **Monthly caps** (`plan_entitlements.monthly_cap`) enforced in `QuotaService` (Phase 2 left them unenforced).
4. Reminders and notifications (7/3/1 days, expiry), one-tap renew link `/billing/renew?sub=…` creating a pre-filled quote; personal offers hook (3.14).
5. Endpoints: `GET /me/subscription`, `POST /me/subscription/cancel`, `POST /me/subscription/resume`, `POST /me/trial`, `GET /me/orders` (history + receipts), `GET /me/orders/:id/receipt` (HTML data for the print page).
6. Receipt data builder (order number, lines, tax, company block from settings).

Acceptance
- [x] Tests: renew extends from current end; upgrade proration arithmetic table; downgrade scheduling; expiry → grace → free; trial once per phone; anniversary grants idempotent over 12 months with a simulated clock; refund effects; monthly cap enforcement.
- [x] Phase 2 quota/credit tests still pass unchanged.

## Task 3.6 — Promotions and coupons (WP3)

**Spec:** BILLING §3. **Files:** `apps/api/src/{promotions,coupons}/*`, `apps/worker/src/jobs/promotions.job.ts`.

1. Services and admin endpoints: CRUD with draft/scheduled/active/paused/ended, **bulk coupon generation** (count, prefix, CSV), assignment to user/org/campaign/referral code, pause batch.
2. Eligibility in the engine inputs (catalog loader picks candidates); reserve/confirm/release redemption (BILLING §3 "Coupon safety"), counters under lock, unique `(coupon_id, order_id)`.
3. Public promotions for `/catalog` (those with `show_on_pricing`), personal offers separate.
4. `POST /billing/coupons/check` (rate-limited, generic failure messages).
5. Status transitions by clock (worker job: scheduled → active → ended).
6. **Simulator endpoint** `POST /admin/billing/simulate {userId|orgId, planKey, months, couponCode?}` returning the engine's quote with explanations (reused by admin screens).

Acceptance
- [ ] Tests: **100 concurrent redemptions of a 10-use coupon ⇒ exactly 10**, per-owner limit, private coupon rejected for others, expired/paused/ineligible all give the same generic message, redemption released on order expiry, best-of vs stacking cases, bulk generation produces unique codes.

## Task 3.7 — Web: pricing, checkout, billing account (WP4)

**Spec:** BILLING §6, §7, §9; GROWTH-STRATEGY §7; DESIGN-SYSTEM. **Files:** `apps/web/src/app/(marketing)/pricing/*` (public, SEO, JSON-LD `Product`/`Offer`), `apps/web/src/app/(app)/(shell)/{billing,checkout/[orderId]}/*`, `packages/ui/src/billing/{PlanCard,PriceTag,PromoBadge,Countdown,ComparisonTable,CheckoutSummary,MethodPicker,ProofUploader,CopyField,ReceiptSheet}.tsx`, i18n files `ar.billing.ts` / `en.billing.ts`.

1. **/pricing**: plan grid (free + three), monthly/annual toggle with real savings, currency switch, promotion badges and real countdowns, personalised «الأنسب لك» when signed in, value ledger strip, comparison table, FAQ, organisations section, WhatsApp help button. Server-rendered, cacheable per currency, Lighthouse targets.
2. **Checkout** (`/checkout/<orderId>` after `POST /billing/orders`; plan and coupon chosen on a preceding step): summary complete on first render (BILLING §6), live total when the method changes, coupon field with inline feedback, method list showing fees ("بدون رسوم"), the Pay button repeating the total, trust line (secure payment, refund policy, no auto-renewal).
3. **Kashier flow:** redirect to the hosted page, return page that polls the order until paid/failed/expired with clear states and a "I paid but nothing happened" help path.
4. **Manual flow:** instructions screen (amount, number with copy button, reference, expiry, SLA), proof form with the capture component from Phase 2 (drag/drop/paste/camera), submitted state with status timeline («قيد المراجعة · نردّ عادةً خلال X دقيقة»), rejected state with reason and resubmit, approved state.
5. **Billing account** (`/billing`): current plan, period, credits (personal + organisation), renew/upgrade/cancel/resume, order history with receipts (print stylesheet), credit packs, payment help.
6. Upgrade UX: «ترقية» opens the quote with the proration line explained.
7. Strings via i18n only; RTL at 360/1440; no inline styles (CSP); icons from lucide.

Acceptance
- [ ] Playwright (fake gateway): free → pricing → checkout → pay → plan active; coupon good/bad; method change updates total; **E2E asserts the total and fee line are visible before the Pay click and equal the button text**; manual flow including rejection and resubmission; upgrade with proration; renewal from a reminder link; expired order.
- [ ] axe clean at 360/1440; Lighthouse targets met on `/pricing` and the checkout page.

## Task 3.8 — Admin billing console (WP5)

**Spec:** ADMIN-CONSOLE-SPEC §2–§5, §9. **Files:** `apps/web/src/app/admin/billing/*`, `apps/web/src/components/admin/*` (shared components of §9), `apps/api/src/admin/billing/*`, `i18n/ar.admin-billing.ts`.

1. Shared admin components of ADMIN-CONSOLE-SPEC §9 (DataTable, RecordDrawer, QueueLayout, ReasonDialog, MatrixEditor, SimulatorPanel, …), reusable by 3.13 and 3.15.
2. Command palette + `GET /admin/search`.
3. Overview with "needs attention", KPIs and funnel (queries on orders/payments/subscriptions/growth events; cached for 60 s).
4. Payments list + review queue (shortcuts), subscriptions, orders/receipts, refunds with the consequences preview.
5. Plans and prices editor with live preview, draft/publish diff, margin calculator; promotions wizard; coupons (single, bulk, assign); credit packs; methods/fees/tax/gateways with the fee-presentation preview.
6. Every write audited; money actions with `ReasonDialog` and fresh auth; calm 403 states; mobile layout for the review queue.

Acceptance
- [ ] E2E: admin creates a plan price and a promotion and sees it on `/pricing`; approves a manual payment from the queue with keyboard shortcuts; issues a partial refund; creates 50 coupons and downloads the CSV; changes the InstaPay number and observes the cooldown/notices.
- [ ] Permission tests: each page and API route denies a role lacking its permission.

### Release A gate
- [ ] Workspace lint, typecheck, tests, E2E and CI green; deployed through the normal pipeline; `migrate` ran the new migrations.
- [ ] **Production smoke test:** one real card payment in Kashier **live mode of the smallest plan price (or a 100%-off-except-minimum coupon)** and one real InstaPay/Vodafone Cash transfer approved by an admin; receipts correct; refund of the card payment works.
- [ ] Alerts reach two admins by email and Telegram within 30 s.

---

# Milestone B — Grow

## Task 3.9 — Organisations and institution billing (WP6)

**Spec:** BILLING §8; REFERRALS §7.4. **Files:** `apps/api/src/orgs/{wallet,seats,join-links,limits}/*`, `apps/web/src/app/(app)/(shell)/org/*`, `apps/web/src/app/(auth)/join/[slug]/*`.

1. **Wallet selection rule** in `CreditsService`/`QuotaService`: org context ⇒ org wallet first, personal fallback only if allowed; the UI shows the payer. Replace the Phase 2 "personal-only" behaviour in `GET /me/credits` with `wallets[]` and `payer`.
2. Org orders/subscriptions (owner = organisation); seats via `plans.max_members`/deal; invites beyond the limit refused with an upgrade path.
3. Member limits (per-member monthly cap) enforced at reserve time with a friendly message.
4. **Join links**: create/disable (org admin or platform admin), `/join/<slug>` landing, registration/login carrying the slug, membership after verification, `auto_approve | requires_approval`, usage counters, expiry.
5. Org dashboard: wallet, plan/expiry, members with usage, caps, links, orders/receipts; CSV export of usage.
6. Leads: «اطلب عرضًا خاصًا» form creating a lead record and a draft deal for admins.

Acceptance
- [ ] Tests: member spends org credits then personal fallback on/off; cap enforcement; link with max uses and expiry; non-admin cannot create links; wrong-org access ⇒ `NOT_FOUND`; the Phase 2 credit/quota suites pass.
- [ ] E2E: organisation admin creates a link, a new user joins through it and appears as a member.

## Task 3.10 — Deals engine (WP6)

**Spec:** REFERRALS §7; BILLING §4 step 2. **Files:** `apps/api/src/deals/*`, `packages/shared/src/schemas/deals.ts` (terms schema), engine integration, `apps/api/src/admin/growth/deals.*`.

1. Terms zod schema (unknown keys rejected), CRUD with draft/active/paused/ended, targets (`user`, `organization`, `referral_code`, `email_domain` with verified-email check), usage stats.
2. Resolver implementing the precedence; membership duration (`durationMonths`) and `newMembersOnly`; `stackWith*` flags; deal id stored on orders.
3. Deal effects beyond price: welcome/monthly bonus credits (through the credit ledger, idempotent), seat limits, reward overrides consumed by 3.11, billing mode (`org_pays` creates org orders for members' seats).
4. Simulator explains the chosen deal and the losing candidates.

Acceptance
- [ ] Tests: precedence matrix, expiry, membership duration, domain deals require verified email, a deal cannot push a price below the minimum, stacking off blocks coupons, audit rows on every change.
- [ ] E2E: join through an institution's link ⇒ the member sees the special price at checkout.

## Task 3.11 — Points, rewards and referrals (WP7)

**Spec:** REFERRALS-REWARDS §1–§6, §8.1, §10. **Files:** `apps/api/src/{referrals,rewards,points}/*`, `apps/worker/src/jobs/{rewards,points-release,points-reconcile}.job.ts`, `apps/web/src/app/(app)/(shell)/rewards/*`, `packages/ui/src/rewards/*`.

1. Codes and attribution: code creation on first login, vanity edit once, `/r/<code>` redirect handler (sets `wasfa_ref`), optional field on register, first-touch rule, attribution record at sign-up through the Better Auth user-creation hook.
2. `RewardsService.onEvent` for `referee_verified`, `first_payment`, `renewal`, `credit_pack`, `org_member_joined` from the outbox; rule resolution (deal > program > global), limits, tier bonus, decisions log.
3. Points ledger service with locks, idempotency keys, release job, reversal on refund (and debt handling), nightly reconcile with alert.
4. Anti-fraud checks of REFERRALS §6 as individually switchable rules; fraud score and flags; weekly budget; kill switch.
5. Conversion points → credits with preview and bonus.
6. User `/rewards` page (REFERRALS §10) with share buttons (WhatsApp, Telegram, copy), progress, activity feed, how-it-works; in-app notifications for rewards.
7. Referee benefits: welcome credits, first-payment discount via rule-generated coupon.

Acceptance
- [ ] Tests: sign-up reward only after verification and first usage; first payment creates pending then releases after the hold (simulated clock); refund reverses rewards incl. debt path; self-referral by same phone/device held; velocity rule holds; kill switch stops accrual; **idempotent reprocessing of the same event pays once**; reconcile 0 drift after concurrency tests.
- [ ] E2E: invite link → friend registers and verifies (both get points/credits) → friend subscribes (referrer gets pending points) → hold passes → referrer converts to credits.

## Task 3.12 — Withdrawals (WP7)

**Spec:** REFERRALS §8.2, BILLING §10. **Files:** `apps/api/src/withdrawals/*`, `apps/web/src/app/(app)/(shell)/rewards/withdraw/*`, admin endpoints in `apps/api/src/admin/growth/withdrawals.*`.

1. Payout methods (admin data with field schemas), destinations (encrypted, hashed, masked, cooldown).
2. `POST /me/withdrawals` (fresh auth, eligibility checks, points hold, snapshot rate) with idempotency; cancel while `requested`.
3. Admin endpoints: list/detail, approve (fresh auth, four-eyes above threshold, not own request), reject with reason, mark paid with transfer reference (unique) and optional proof, reveal destination (audited).
4. Alerts: `withdrawal.requested` to every admin with `withdrawals.review` via email/in-app/Telegram (WhatsApp if enabled); overdue reminders; user notifications for every state.
5. Weekly CSV and reconciliation of paid-out vs ledger.
6. User screens: eligibility explainer, progress to the minimum, destination manager, request form with a confirmation showing the EGP amount and ETA, status timeline.

Acceptance
- [ ] Tests: minimum 1,000 points enforced from settings; concurrent requests never exceed `cash`; new destination cooldown; first withdrawal flagged; reject returns points; paid is idempotent; reveal writes audit; admin cannot approve/pay their own request; four-eyes; alert reaches two admins; all strings Arabic.
- [ ] E2E: request → admin approves → marks paid → user sees paid with reference.

## Task 3.13 — Admin growth console (WP8)

**Spec:** ADMIN-CONSOLE-SPEC §6, §7. **Files:** `apps/web/src/app/admin/growth/*`, org drawer extensions, `apps/api/src/admin/growth/*`.

1. Referrals overview, programs/rules editor with sentence rendering and what-if, tiers, referral tree, codes (partner/org/campaign), settings with EGP equivalents.
2. Fraud queue; withdrawals queue and review pane; deals list + wizard + preview; organisation drawer tabs (plan & wallet, members, links & deals, orders).
3. All writes audited, reasons and fresh auth per spec.

Acceptance
- [ ] E2E: admin creates a partner code with a deal (30% commission), a friend subscribes through it and the partner's pending reward matches the what-if panel; admin creates an institution deal + link in the wizard in under 2 minutes of scripted steps; releases a held reward; permission tests per page.

### Release B gate
- [ ] Workspace lint, typecheck, tests, E2E, CI green; deployed; reconcile jobs 0 drift for 7 days in staging/production.
- [ ] Production smoke: invite → register → subscribe → reward pending → (clock-advanced in staging) release → convert; one real small withdrawal paid manually end to end **only after the accountant's answer** (otherwise `rewards.enabled` stays false for cash).

---

# Milestone C — Convert & know

## Task 3.14 — Conversion engine (WP9)

**Spec:** GROWTH-STRATEGY (all). **Files:** `apps/api/src/growth/*`, `apps/worker/src/jobs/{lifecycle,offers}.job.ts`, `apps/web/src/components/growth/*`, dashboard/pricing/result integrations, `i18n/ar.growth.ts`.

1. `GrowthService.nextPrompt` with moments, cooldowns (doubling to 60 days), one per session, kill switch; web `PromptSlot` component used in dashboard, results, credits page; `shown/clicked/dismissed` events.
2. **Taste of Deep mode**: grant rules, one-click re-analysis on the same prescription, side-by-side improvement view, caps and global weekly budget.
3. Personal offers: lifecycle rules (`growth_rules`) creating `personal_offers` with server deadlines; welcome, renewal, win-back; shown on pricing, dashboard card and email.
4. Lifecycle emails (templates, marketing consent, weekly cap, unsubscribe link and endpoint, shared daily cap handling), value recap.
5. Value ledger widget (honest, labelled estimates), recommendation endpoint integration, social proof thresholds.
6. `growth_events` ingestion (batched client events + server events), funnel queries for the admin overview; experiments via flags with stable bucketing, guardrail metrics, admin screens (ADMIN-CONSOLE-SPEC §6.5).
7. Tests of the guardrails (GROWTH §2) as automated checks: prompt frequency, no prompt on error/upload states, countdown equals server deadline, no pre-checked add-ons.

Acceptance
- [ ] Tests/E2E: prompt appears after a good result once, honours dismissal cooldown, never during upload/error; taste works once per week and costs recorded; welcome offer deadline identical across two browsers and after clearing storage; unsubscribe works; experiment buckets are stable.
- [ ] Funnel dashboard shows each step for a scripted user journey.

## Task 3.15 — Admin user 360 and upgrade dialog (WP10)

**Spec:** ADMIN-CONSOLE-SPEC §8. **Files:** `apps/web/src/app/admin/users/[id]/*` (tabs), `apps/api/src/admin/users/{360,phi,notes,upgrade}.*`.

1. Tabs per spec; timeline builder merging events across tables (paged); price simulator inside the subscription tab.
2. **Prescriptions tab** (essential): paginated list of all `rx_analyses` for the user and their organisation context, open with the customer-grade result viewer, image while retained; **chats tab**: list and read-only transcript.
3. PHI access sessions (reason picker, 30-minute window, audit row per open, no export), masked contact data with audited reveal.
4. **Upgrade / change plan dialog** (§8.3) with kinds (gift, compensation, paid-offline creating an approved manual payment, trial, sponsored), credits, notification, preview of the effect, reason, fresh auth above a threshold; also on subscriptions and organisation pages.
5. Notes with pinning; quick actions (credits, coupon/offer grant, suspend).

Acceptance
- [ ] Tests: `users.read_health` required for prescriptions and chats, access session required, audit rows written, support role cannot see health data unless granted; upgrade dialog creates the right subscription/assignment/events/notifications for each kind; paid-offline creates revenue-correct records.
- [ ] E2E: admin finds a user by phone through the palette, upgrades them to Pro for 3 months, opens a prescription with a reason, and the audit log shows both actions.

## Task 3.16 — Campaign links and tracking (optional, WP11; may move to Phase 4 start without blocking release)

**Spec:** ROADMAP Phase 3 scope; GROWTH §9. **Files:** `apps/api/src/campaigns/*`, `apps/web/src/lib/tracking/*`, admin `tracking` screens.

1. `/c/<slug>`: records click (UTM, referrer, country, device class), sets first-touch and last-touch attribution cookies compatible with referral attribution, redirects; funnel: clicks → signups → paid → revenue.
2. Tracking manager (admin): Meta Pixel, GA4/Google Ads, TikTok, Snap, custom, each on/off, loaded through one **consent-aware** loader (cookie consent banner, CSP additions from settings).
3. Server-side events via the outbox (Meta CAPI, GA4 Measurement Protocol, TikTok Events API) for `CompleteRegistration`, `Purchase`, `Subscribe`, deduplicated with the client `event_id`; no PHI or prescription data ever in payloads.

Acceptance
- [ ] Tests: attribution rules, consent respected (no scripts before consent), dedupe ids match between client and server events, event payload allowlist test.

## Task 3.17 — Security, observability, docs, release (main session)

1. **SECURITY.md:** endpoint register rows for every new route (auth, permission, rate limit, body limit, audit); threat rows: price tampering, webhook forgery/replay, double activation, coupon brute force and races, manual-payment fraud (reused/forged proofs), payout fraud, referral farming, account takeover then withdrawal, admin collusion, PHI access by staff, alert-channel leakage, gateway key theft; close/extend §11 items.
2. **Rate limits** (BILLING §12 plus: `POST /me/withdrawals` 3/day, `POST /me/rewards/convert` 10/hour, `/r/<code>` 60/min per IP, join-link landing 60/min per IP, `GET /admin/search` 60/min per admin).
3. **Observability:** request id propagated into orders/payments/events; alerts for payment failure spike, review overdue, mismatch, reconcile drift, withdrawal overdue, fraud holds; dashboards in the admin overview.
4. **Docs:** `docs/BILLING-RUNBOOK.md` (beginner-friendly: approve a payment, refund, change a price safely, rotate gateway keys, pay a withdrawal, handle a disputed payment, what to do when webhooks stop), update `DATABASE.md`, `DESIGN-SYSTEM.md` (billing/rewards/growth components), `REUSE-INDEX.md`, `ARCHITECTURE.md` (§7, §8, decisions), `DOCKER-GUIDE.md` (new env: gateway webhook URL, Telegram, nothing secret in compose), privacy/terms drafts (payments, refunds, rewards, staff access).
5. **Deploy:** `.env.prod` additions (Telegram bot token, webhook public URL base); gateway keys are entered in admin, not env; `migrate` applies 0010–0012 and the insert-only seed; Caddy route for `/webhooks/*` (no body buffering changes, size limit); verify Cloudflare WAF does not block gateway webhook IPs (document the allowlist step).
6. Final acceptance run and the production smoke tests of Release A, B and C.

Acceptance
- [ ] `pnpm lint`, `typecheck`, `test`, E2E, CI, `pnpm audit` gate green; image sizes recorded.
- [ ] Runbook reviewed by the owner by performing each procedure once in staging.

---

## Dependency graph

```
3.0 ─► WP1 (3.1, 3.2) ─┬─► WP2 (3.3, 3.4) ─┐
                       └─► WP3 (3.5, 3.6) ─┼─► WP4 (3.7) ─┐
                                           └─► WP5 (3.8) ─┴─► Release A
Release A ─┬─► WP6 (3.9, 3.10) ─┐
           └─► WP7 (3.11, 3.12) ─┴─► WP8 (3.13) ─► Release B
Release A ─► WP10 (3.15)          Release B ─► WP9 (3.14) ─► (WP11 3.16) ─► 3.17 ─► Release C
```

## Phase 3 final checklist

- [ ] All task acceptance boxes ticked; Releases A, B, C gates passed.
- [ ] Targets table met, with numbers in Notes (checkout Lighthouse, reconcile drift, review times).
- [ ] `pnpm lint`, `typecheck`, `test`, Playwright E2E and CI green; deployed through the normal pipeline.
- [ ] `BILLING.md`, `REFERRALS-REWARDS.md`, `GROWTH-STRATEGY.md`, `ADMIN-CONSOLE-SPEC.md`, `DATABASE.md`, `SECURITY.md`, `DESIGN-SYSTEM.md`, `ARCHITECTURE.md`, `REUSE-INDEX.md`, `BILLING-RUNBOOK.md` match the code.
- [ ] Accountant answers recorded; cash rewards enabled only after them.
- [ ] Summary written below with any deviations.

## Notes
_(agent fills in deviations here)_

### Task 3.3 (WP2, payments core)
- **Where the state machine lives.** `packages/db/src/payments.ts` (and `outbox.ts`), plain functions over a `Database` like the credits ledger, so the API (checkout, webhooks, refund recording) and the worker (reconciliation, expiry, outbox) run the same transactions. Gateway adapters live in `packages/shared/src/gateways.ts` for the same reason (the worker's reconciliation calls `getStatus`). Nothing outside the Kashier block of that file depends on Kashier's fields.
- **Kashier, partly verified (2026-10-16, one real test-mode card payment of 100.00 EGP).** Confirmed: the hosted page hash `HMAC(paymentApiKey, "/?payment=<mid>.<orderId>.<amount>.<currency>")` (the page renders even with a bad hash, so it is checked at payment time), the return redirect signature `HMAC(paymentApiKey)` over its query `key=value&...` in received order without `signature` and `mode`, and the status call `GET /payments/orders/<merchantOrderId>` with the secret key (`response.status = "CAPTURED"`, amount and currency under `response.order`, Kashier's order id in `response.orderId`; 404 "Order is not exist" before the customer pays). The spike fixed two adapter bugs: the amount was read from `response.amount` (absent, so every reconciled payment would have been an amount mismatch) and the 404 counted as an outage (now `pending`). Fixtures (card, session and key data removed) are in `packages/shared/test/fixtures/kashier/`. **Still unverified:** the webhook body and `x-kashier-signature` (Kashier cannot reach localhost; needs a public URL). The admin end-to-end test must pass against the current credentials and mode before the owner enables `kashier_card`. Wasfa does not call a refund API.
- **Our id at the provider is the payment id**, not the order id, so a retried attempt (card failed, then card again) is a new provider order.
- **Quotes carry their target.** A stored quote is `{ v: 2, userId, target, quote, signature }`; the signature covers user, target (kind, plan/pack id, months) and quote, so an order cannot be re-owned or re-targeted. `orders.quote_hash` stays the HMAC of the quote alone. Credit packs are quoted with `{ packKey, methodKey? }` (no discounts or proration for packs).
- **An order needs a quote priced with its method** (the fee depends on it); otherwise `QUOTE_EXPIRED` asks the client to re-quote. A quote is claimed atomically (Redis `DEL` = 1) before the order is written: of concurrent requests with one quote, exactly one creates an order.
- **Late provider successes count.** `failed/expired/canceled -> succeeded` is allowed for provider-verified events; reconciliation keeps asking about expired gateway payments for 24 h. An expired order paid late is activated (coupon re-taken if it still has room, otherwise kept and alerted). A second success on an already paid order is recorded and alerted (`payment.review_needed`, critical) for a manual refund.
- **Amount mismatch** (amount or currency reported by the provider differs from the order, or none reported) fails the attempt and raises a `payment.amount_mismatch` row in `admin_alerts`; fan-out to email/Telegram arrives with Task 3.4's `AdminAlertService`.
- **Subscription activation is a hook** (`PaymentHooks`, bound to `NO_SUBSCRIPTION_HOOKS` in the API's `PAYMENT_HOOKS` and the worker's payments runtime). Until Task 3.5 lands, a paid subscription order is marked paid with its outbox event but creates no period; 3.5 must backfill paid orders without a subscription. Credit packs are fully handled (ledger kind `purchase`, key `order:<id>`). Purchased-pack expiry (`valid_months`) is not enforced yet.
- **Outbox.** Topics `billing.order_paid` (in-app notification + `payment_receipt` mail, job id `outbox-<entry id>`) and `billing.order_refunded` (notification). A topic without a handler is parked for a day, never dropped. Drained every 30 s.
- **Worker schedules:** `payments.reconcile` and `payments.expire_orders` every 5 min, `payments.consistency` nightly 02:20 UTC (logs `payments.drift`, ids only), `outbox.drain` every 30 s. The worker now needs `WEB_ORIGIN` (receipt links) and has `WORKER_CONCURRENCY_PAYMENTS`.
- **Refunds never call a provider.** The owner issues the refund in the provider's dashboard or by bank/wallet transfer, then records it with the external refund reference (`PaymentsService.refund`: record `approved` -> one transaction with states, credit clawback never below zero, `onRefund` hook, outbox). A verified provider report of a refund we have not recorded raises one `payment.review_needed` alert and changes nothing. The admin refund endpoint, fresh auth and audit come with Task 3.8.
- **Kashier admin verification** (`/admin/billing/gateways`): sealed write-only credentials, a connection test, then a real test payment whose signed webhook and status API must both agree with the amount before the gateway can be enabled. Credential or mode changes disable the gateway and its methods, raise a critical alert and start a 10-minute cooldown; the owner enables `kashier_card` from the admin only after verification. Test payments (`gwtest-` ids, table `payment_gateway_tests`) never touch orders, payments, credits or revenue.
- **Not in 3.3:** the payment-failure spike alert (`payment.failure_spike`) and the settlement CSV import of BILLING §5.6 (admin console, Task 3.8).

### Task 3.4 (WP2, manual payments and alerts)
- **One alert writer, fan-out through the outbox.** `raiseAdminAlert` (`packages/db`) stays the only writer of `admin_alerts`; in the same transaction it queues `alerts.fan_out`. The worker resolves recipients in SQL (`adminRecipients`: `alerts.receive` plus the kind's permission, `super_admin` as a wildcard, active and not anonymized), applies `admin_alert_prefs` (critical alerts ignore mutes), and writes one `alert_deliveries` row per admin and channel. Delivery jobs are queued only **after** the fan-out commits (`drainOutbox` post-commit actions); a sweeper re-queues anything still `pending` after 2 minutes, including digests whose queueing failed. The API kicks the drainer right after its own commits, so delivery does not wait for the 30-second schedule.
- **Alert text never carries personal data.** Summaries are redacted on write, never refused (an alert must never abort a payment transaction): Egyptian mobiles and `+`/`00` international numbers become `012*****678`, private R2 links become `[file]`; amounts, order numbers, references and UUIDs pass unchanged. WhatsApp text also carries no link (anti-ban).
- **Throttle and digest:** non-critical alerts on email, Telegram and WhatsApp go out at most once per admin and channel per 10 minutes; the rest of the window arrives as one digest (count plus up to 5 summaries). Critical alerts and in-app are never throttled.
- **Channels.** In-app always; email through the notifications queue (critical kinds bypass the daily cap); Telegram through `ALERT_TELEGRAM_BOT_TOKEN` (compose defaults it to the backup bot's token), chat id per admin, 10 s timeout; **WhatsApp ships off** (setting `alerts.whatsapp.enabled = false` and bridge env `WA_ALERTS_ENABLED=false`, Open question 1 still unanswered). When both are on, only admins who messaged `تنبيهات` / `ALERTS ON` from their **verified** phone are linked (anyone else changes nothing and gets the same reply), at most 20 messages a day in total, and alerts and replies share the bridge's 3-second spacing.
- **Manual payments.** A manual order's payment starts in `awaiting_customer` with its `WSP-` reference. Proof submission: owner only, processed `payment_proof` file of the caller not used elsewhere, transaction id unique per method (DB index is the final guard), at most 3 submissions, and after a rejection exactly one more try (rejections are counted from the payment's transition events). Duplicate images (same SHA-256, or dHash within 6 bits of any earlier proof of any owner) are flagged with the earlier order number and make the alert critical; they do not block. The sender's full number is stored sealed (`payments.sender_phone_enc`, AAD bound to the payment) and only the review detail opens it; logs and alerts get the masked form.
- **Review.** Queue overdue first, then oldest. Approve and reject need fresh auth; nobody reviews a payment of their own account or organisation (also request-proof); at or above `fourEyesThresholdMinor` the first approval moves to `awaiting_second_approval` and a different admin completes it. The "being reviewed by" lock is advisory (Redis, 5 min); acting over someone else's lock needs `override: true`. Two concurrent approvals activate once. The detail answers with an explicit shape (never the sealed phone or the stored quote) and is audited per open; if storage cannot sign the proof link, the page still renders with `proofUnavailable: true`.
- **Deviation: no "approve a smaller period" for a different amount.** BILLING §5.7.5 allows it at the admin's explicit choice; it would rewrite a signed quote, so the only path for a wrong amount is reject with `amount_differs` (the customer pays the difference on a fresh order). Revisit with the admin console (Task 3.8) if the owner needs it.
- **Account-number changes** (`payment_method_account_changes`): `billing.write`, fresh auth and a current TOTP code, one pending change per method, effective after 10 minutes, cancellable by a **different** admin, applied by a one-minute worker job with an audit row (masked values). Requested, canceled and applied each raise a critical alert to every `billing.write` admin on every enabled channel. No other route writes `account_display`/`account_holder` (the gateway admin only toggles `enabled` on gateway methods; tested).
- **SLA:** every 30 minutes inside `alerts.businessHours` (Cairo 09:00-22:00 by default; the timezone is validated), one `payment.review_overdue` per payment per 30-minute slot, measured from the latest transition into review; the method's `review_sla_minutes` overrides the setting.
- **Customers** get an in-app notification and an email (ar/en templates) when a proof is rejected (reason as an i18n key plus the admin's note) or a clearer proof is asked for; approval reuses the paid-order receipt.
- **Measured** (worker integration test, in-process, Telegram stubbed, no BullMQ hop): proof submission to in-app and Telegram deliveries `sent`, median of 5 runs **153 ms** on the development machine (74 ms in an earlier run). Production adds the queue hop and Telegram's own latency, both far below the 30 s target.
- **HEIC** stays converted in the browser (the server pipeline accepts JPEG/PNG/WebP, as for prescriptions).
- **Known limits:** the duplicate-image check compares against the proof currently attached to each payment (a replaced proof is no longer compared) and scans every proof's dHash in the database; fine at current volume, worth an index (e.g. a BK-tree or prefix buckets) past tens of thousands of proofs. The worker's WhatsApp daily count is a check-then-push (two workers could each push the 20th message); the bridge's own counter is the hard cap.

### Task 3.5 (WP3, subscriptions)
- **Where it lives.** `packages/db/src/subscriptions.ts`, plain functions like the payments state machine, because activation and refunds run inside payment transactions (API and worker) and the lifecycle runs in the worker. `SUBSCRIPTION_HOOKS` replaced `NO_SUBSCRIPTION_HOOKS` in the API's `PAYMENT_HOOKS` and the worker's payments runtime. Lock order: order → payment → subscription → wallet. Every function takes `now`, so tests run on a simulated clock.
- **Activation** (idempotent per order: an event carrying `orderId` means done). No live subscription, or a trial/grant one: a new paid period from now (a replaced trial keeps its remaining credits). Same plan: extends from the current end; in grace (or with the period already over) it restarts from now. Higher plan (`kind = upgrade`, or more monthly credits): switches now with a full new period; the old plan's unused credits expire and the new plan's month is granted at once; the quote's proration line is recorded on the `upgraded` event. Lower plan: `pending_change`, applied by the lifecycle at the period end (in grace it starts at once). A second, different downgrade is kept apart and alerted (BILLING §7.2 now says so). Extra months from a promotion extend the period.
- **The access-end rule** (BILLING §7.2, pinned): one open `plan_assignments` row per live subscription, its `ends_at` = period end, plus `graceDays` for a paid period that is not canceled. Every operation updates it in the same transaction, so a late worker never gives free access, and the Phase 2 resolver is unchanged.
- **Credits.** Anniversary grants (`addMonthsClamped` from the period start: Jan 31 → Feb 28 → Mar 31), granted by the lifecycle job whenever due; before each new grant the previous grant's unused part expires (`expireGrantInTransaction`, Phase 2's min(balance, grant) rule), and again at expiry, cancel-at-end and replacement by an upgrade. **Deviation:** the ledger key adds the period start (`grant:<ownerType>:<ownerId>:<YYYY-MM>:<subscriptionId>:p<startMs>`), because a renewal from grace, an upgrade or an applied downgrade starts a new period whose first grant can fall in a month that already had one. Trials get `trial_grant` once (`trial:<subscriptionId>`), expiring with the trial. Admin grants and deals get monthly grants like paid periods, but no grace.
- **Phase 2 calendar grant** now skips owners with a live subscription (they are paid on their anniversaries). When a subscription ends, the owner rejoins the calendar grant on its next daily run; if that month's calendar grant was already paid before they subscribed, the next one comes the following month.
- **Grants run in the lifecycle job.** One job, `subscriptions.lifecycle` every 15 minutes, does period ends, downgrades, grace, expiry, anniversary grants and reminders for each live subscription in its own transaction (`FOR UPDATE SKIP LOCKED`). A separate hourly grant job would only have duplicated the walk.
- **Reminders** (outbox topic `subscriptions.reminder`, one key per period and slot): 7/3/1 days before the end (only the latest due slot, so a late first run does not send three), trials only `d1`, none after a cancel, one per grace day (at most three), and one at expiry. In-app notification plus the `subscription_reminder` mail (ar/en) with the one-tap link `/billing/renew?sub=<id>`; an organization's subscription reminds its `org_admin` members. The renew page (Task 3.7) calls `POST /me/subscription/renew-quote`, which prices the subscription's own plan (a plan in the body is ignored). The personal-offers seam (`SubscriptionLifecycleHooks`) is bound to a no-op for Task 3.14.
- **Trials:** a public, non-default plan with `trial_days > 0` and `billing.trial.credits > 0`; once per account and, with `trial.oncePerPhone`, once per verified phone. The phone is remembered as a SHA-256 in the trial's `created` event (never the number), so the rule survives the phone moving to another account; a transaction lock on it serialises parallel requests.
- **Refunds:** a full refund takes back the months the order bought (shortened period, or the subscription ends now if nothing would be left); a refunded scheduled downgrade is just removed; partial refunds change no access. Every refund writes `refund_applied`. Credit clawback stays the admin's number in `completeRefund`.
- **Backfill:** `subscriptions.backfill` (at worker start and nightly 02:40 UTC) activates paid subscription orders that have no period yet at their `paid_at`; the lifecycle then catches up.
- **Monthly caps** are enforced in `QuotaService` per owner, task and UTC month (Redis, 35-day TTL), after the daily cap; a refusal gives back both counters. `GET /me/credits` gains an optional `thisMonth` list. Its `nextGrantAt` still shows the calendar month (Phase 2); for subscribers the right date is `nextCreditGrantAt` in `GET /me/subscription`; the web billing page (3.7) should show that one.
- **Admin operations** (`adminGrant` / `adminExtend` / `adminEnd`) exist with events and audit rows and are tested; their routes come with the user 360 page (Task 3.15).
- **Receipts:** `GET /me/orders/:id/receipt` returns `buildReceipt` data (full itemisation from the stored quote, refunds, the company block from `billing.company`, masked buyer contact) for paid or refunded orders of the caller.
- **Not built (known gaps):** purchased credit packs still do not expire after `valid_months` (needs credit lots; noted in 3.3); organization subscriptions use the same code but have no `/me`-style routes until Task 3.9.
- **Verified:** the db suite runs the state machine as the table owner; the worker suite runs the lifecycle, reminders and the calendar-grant exclusion as the restricted `wasfa_api` role. The proration arithmetic table is the price engine's (`packages/shared/test/price-engine.test.ts`, "proration"); activation tests check the switch and the recorded credit.

### Customer notifications on WhatsApp (owner decision, 2026-10-17)
- **What the customer gets.** Payment received / subscription activated (with plan, end date and monthly credits), the 7/3/1-day, grace and expiry reminders with the one-tap renew link, proof rejected (with the reason) and "send a clearer proof", and refunds. `offer` is ready for the conversion engine (Task 3.14). In-app notifications are unchanged.
- **Channel rule.** WhatsApp only for a phone verified through our WhatsApp number that has not sent STOP or switched it off on the account page, with the owner's switch on, inside the caps and the sending hours; email otherwise. Receipts are always mailed (documents) and also go on WhatsApp. Every message that the bridge does not confirm as sent within 4 minutes is mailed instead (bridge down, switch turned off meanwhile, STOP, cap, refused text).
- **How it flows.** Outbox handlers return a `customer_message` post-commit action; the worker's `customer.notify` job picks the channel, reserves the caps atomically in Redis, renders the keyed template (ar/en), and queues the message for the bridge plus a `customer.whatsapp_check` job. The bridge's `CustomerGuard` rereads the owner's switch, drops stale or opted-out messages, allows links only to `WEB_ORIGIN`, counts real sends against the daily total, claims each message once and records the result. STOP / START go from the bridge to Redis at once and to `notification_prefs` through the worker.
- **Admin:** `/admin/whatsapp` has a "Customer messages" card: the switch (turning it on asks for confirmation and states the ban risk), the daily total, the per-customer cap, the sending hours, and today's count. **Customer:** the account page shows a WhatsApp switch under the verified phone.
- **Ships off.** The owner turns it on in `/admin/whatsapp` (it needs a linked number). Advice recorded with Decision 50: start with a small daily total (for example 50) and raise it while the number stays healthy.
- **Bugs found and fixed on the way:** relinking the WhatsApp number used to overwrite the whole `whatsapp` setting (it now keeps the rest); the bridge's day format (`YYYYMMDD`) did not match the api's, so the admin count would have read 0 (one shared `waCustomerDay`); a raw `Date` in the opt-out upsert would have failed every STOP.
- **Also fixed:** `GET /me/credits` `nextGrantAt` now shows a subscriber's next anniversary (or the period end after the last one) instead of the calendar month; the Phase 2 test "covers more users than one batch" (437 serial grants) times out under a full parallel run on a clean checkout too, so it now has a 120 s budget.

## Open questions
1. **Answered 2026-10-17:** the owner chose WhatsApp from the bridge, extended to customers (Decision 50, SECURITY §8.1); admin alerts keep their opt-in rule. **WhatsApp alerts to admins (owner decision).** The Phase 1 bridge is receive-only to avoid bans, because an unofficial client can lose the number (which would also break phone verification). The plan keeps it off by default and, if enabled, sends only to admins who opted in by messaging the bridge first, at most 20 messages/day. The safer official route is the WhatsApp Cloud API with a template message. Which do you want: (a) email + Telegram only, (b) the opt-in bridge, (c) the official API later?
2. **Payout legality and tax (accountant).** Paying cash rewards to individuals may need tax withholding, identification above some amount, or a business structure. Until answered, build everything but keep `rewards.cashOutEnabled = false` in production; points → credits works regardless.
3. **Receiving account for manual payments.** 01014677026 receives transfers for both InstaPay and Vodafone Cash. Is this a personal or a merchant wallet? Daily/monthly receiving limits on a personal wallet may cap revenue; a merchant account or bank account may be needed as volume grows.
4. **VAT and e-receipts.** The rate, inclusive vs added display, and electronic receipt duty for these sales (BILLING §6).
5. **Chat history in admin (included).** Chosen because the data and ownership checks already exist; it is read-only, reason-gated and audited. Say if you want it removed entirely for privacy positioning.
6. **Card auto-renewal.** Deferred. Decide after Phase 3 whether the conversion data justify integrating recurring card billing.
7. **Starting prices and reward levels** are proposals; real cost per page from the Phase 2 evaluation must confirm them before publishing.
