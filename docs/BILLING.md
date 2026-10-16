# BILLING.md — Plans, prices, checkout, payments, subscriptions

> Domain specification for Phase 3 (Milestone A, and the org parts of B). `docs/phases/phase3.md` says *when* and *in which order*; this file says *what the rules are*. If code and this file disagree, fix one of them in the same change.
> Related: `docs/REFERRALS-REWARDS.md` (points, deals, withdrawals), `docs/GROWTH-STRATEGY.md` (conversion rules), `docs/ADMIN-CONSOLE-SPEC.md` (screens), `docs/SECURITY.md`, `docs/DATABASE.md` (conventions).

---

## 1. Principles

1. **The server decides every number.** The client sends `{planKey, months, couponCode?, methodKey}`; the server computes the quote, stores it, and charges exactly that. A payment whose amount differs from its order is never activated (AGENT §5.3, §5.5).
2. **Money is `amount_minor` + ISO currency**, integers only. Percentages are **basis points** (`bps`, 100 bps = 1%). Rounding is half-up, per line, in one place (`price-engine.ts`).
3. **Append-only where it is money.** `credit_ledger`, `points_ledger`, `payment_events` are insert-only for the `wasfa_api` role. Corrections are new rows.
4. **Idempotent everywhere money moves.** Every webhook, activation, grant, reward, refund and payout carries an idempotency key backed by a UNIQUE constraint.
5. **Humans approve what machines cannot verify.** Manual payments and withdrawals are never auto-approved.
6. **Everything commercial is admin data**, not constants (AGENT §5.9): prices, promotions, fees, tax, methods, numbers to pay to, windows, caps.
7. **Honest pricing.** Fees are shown quietly, never hidden (see §6). Countdowns are real. Nothing is pre-checked.

---

## 2. Catalog

### 2.1 Plans (extends the Phase 2 `plans` table)

Phase 2 already has `plans`, `plan_entitlements`, `plan_assignments`. Phase 3 adds (expand-only migration):

- On `plans`: `tagline_ar/en`, `features jsonb` (ordered list of `{ textAr, textEn, included, highlight }`), `trial_days int`, `pin_recommended bool`, `max_members int null` (organization plans), `fair_use_note_ar/en`.
- `plan_prices`: `plan_id`, `months` (1, 3, 6, 12 or any 1–24), `currency`, `amount_minor`, `active`, UNIQUE `(plan_id, months, currency)`. **No automatic currency conversion at checkout**: a price exists per currency or the plan is not offered in that currency.
- `credit_packs` (`key`, names, `credits`, `bonus_credits`, `valid_months`, `active`, `sort`) and `credit_pack_prices` (`pack_id`, `currency`, `amount_minor`).

A plan is *offered* to a visitor when it is `public`, has an active price in the visitor's currency, and its `audience` fits the account type.

### 2.2 Proposed starting catalog (the owner decides; the margin calculator validates)

Provider cost per credit is about US$0.01 (Phase 2 target: median ≤ $0.01 per prescription page). With an **illustrative** rate of 50 EGP per US$ (the real rate is the admin setting `fx.usdToEgp`), one credit costs about 0.5 EGP when fully used.

| Plan | Credits / month | Month | 12 months (pay 10, get 12) | Notes |
|---|---|---|---|---|
| Free (`free`, default) | 30 (expire at period end) | 0 | – | 3 rx/day cap, modes fast + balanced |
| Plus (`plus`) | 150 | 99 EGP | 990 | all modes, web search off |
| Pro (`pro`) | 500 | 299 EGP | 2,990 | deep mode, web search, priority queue |
| Clinic / Pharmacy (`clinic`, audience organization) | 2,000 shared, 5 seats | 999 EGP | 9,990 | org wallet, member caps, usage report |

Credit packs: 100 credits 79 EGP, 300 credits 199 EGP (+30 bonus), 1,000 credits 549 EGP (+150 bonus). Packs cost more per credit than plans on purpose, so a plan is always the better deal for regular use.

At 100% utilisation Plus costs about 75 EGP against 99 EGP revenue, and Pro about 250 EGP against 299 EGP. That is thin, so two rules protect margin: (a) typical utilisation is far below 100%, and (b) the plan editor shows **break-even utilisation** and warns under 50% margin at full use. These are placeholders until the Phase 2 evaluation fixes the real cost per page.

### 2.3 Margin calculator (admin plan editor)

```
cost_full   = monthlyCredits × costPerCreditUsdMicros × fx   (per month)
revenue     = price / months (net of tax and gateway fee)
margin_full = revenue − cost_full
break_even  = revenue / cost_full         (share of credits that can be used before losing money)
```
`costPerCredit` comes from the last 30 days of `ai_usage` (cost ÷ credits charged), falling back to the credit value setting. Warn when `margin_full / revenue < 0.5`; block saving (with override and reason) when `< 0`.

---

## 3. Promotions and coupons

Both are *discount definitions*; they differ in how the customer meets them.

| | Promotion | Coupon |
|---|---|---|
| Customer action | none; applies automatically | types or follows a code |
| Visible on pricing page | yes, if `show_on_pricing` (struck-through price, badge, optional real countdown) | no |
| Targeting | plan, months, audience, country, new customers only | same, plus a **specific user or organization**, a campaign, a referral code |
| Limits | total redemptions, per owner | same |

**Kinds** (same set for both): `percent` (bps), `fixed` (minor units, per currency), `bonus_credits`, `extra_months` (adds free months to the period), and, for coupons only, `trial_extension` (days).

**Fields (both):** internal name, public title/badge (ar/en), `kind`, `value`, scope (`plan_ids[]`, `months[]`, `audience`, `countries[]`, `new_customers_only`, `min_amount_minor`), `starts_at`, `ends_at`, `max_redemptions`, `per_owner_limit`, `redeemed_count`, `stacking` (`exclusive` | `stack_with_other`), `priority`, `status` (`draft | scheduled | active | paused | ended`).

**Stacking rule (default):** when several discounts qualify, the customer gets the **single best** one (largest saving); a coupon wins a tie. Two discounts combine only if **both** are `stack_with_other`, and then percentages apply sequentially and the total discount is capped by `settings.billing.maxTotalDiscountBps` (default 70%).

**Real countdowns:** a promotion shows a countdown only when `ends_at` is real and enforced by the engine. A *personal* welcome offer (e.g. 48 h after sign-up) is stored per owner (`personal_offers`, §9) so the same deadline is true in every tab and cannot be reset by clearing cookies.

**Coupon safety**
- Redemption is **reserved** when an order is created (counter incremented under a row lock, unique `(coupon_id, order_id)`), **confirmed** on payment success and **released** when the order expires or is cancelled.
- Code lookup is rate-limited (10/min per user, 30/min per IP) and always answers with the same generic message for unknown, expired, used-up or ineligible codes, except that an owner who is *eligible later* may see "starts on …".
- Bulk generation: random 8-character codes from an alphabet without look-alike characters, with an optional prefix; CSV export; a batch can be paused as one.

---

## 4. The price engine

A **pure function** in `packages/shared/src/price-engine.ts` (no I/O). The API gathers the inputs; the web only displays the result. Unit tests plus property tests (10,000 random baskets).

```ts
quote({
  owner, plan, months, currency, country, now,
  catalog: { price, promotions[], coupon?, deal?, taxRules[], method?, personalOffer? },
  history: { isFirstPurchase, currentSubscription? },   // proration, new-customer rules
}) => PriceQuote
```

Steps, in this order:
1. **List price** = `plan_prices(plan, months, currency)`.
2. **Deal** (REFERRALS-REWARDS §7): the most specific active deal for the owner may replace the price (`fixed`) or discount it (`percent_off`). The result is the *base*. A deal states whether promotions/coupons may still apply (`stackWithPromotions`, `stackWithCoupons`).
3. **Promotions**: eligible ones; pick best or stack per §3.
4. **Coupon**: validate, apply by the same rule.
5. **Proration credit** (upgrade only, §7.3): `remaining_value` of the current paid period, capped at the discounted price.
6. **Subtotal** = max(0, base − discounts − proration).
7. **Tax** from `tax_rules` for the country: `added` (computed on subtotal) or `inclusive` (extracted from the subtotal for display only).
8. **Processing fee** of the chosen method, **grossed up** so the merchant nets the intended amount:
   `total = ceil((subtotal + taxAdded + fixed) / (1 − feeBps/10000))` when a percentage applies; `fee = total − subtotal − taxAdded`.
9. **Total**. If `total = 0` the order is a **free order** (§5.4); a positive total below `settings.billing.minChargeMinor` is raised to the minimum or refused, never silently dropped.

**Output**

```ts
type PriceQuote = {
  currency: string;
  lines: Array<{ kind: 'plan'|'discount'|'proration'|'tax'|'fee'|'bonus'; labelKey: string; amountMinor: number; meta?: ... }>;
  listPriceMinor: number;       // for the struck-through price
  subtotalMinor: number; taxMinor: number; feeMinor: number; totalMinor: number;
  grants: { bonusCredits: number; extraMonths: number };   // non-monetary benefits
  applied: { dealId?: string; promotionId?: string; couponId?: string };
  display: DisplayHints;        // headline price, savings text, fee line (§6)
  expiresAt: string;            // quote validity, 15 minutes
};
```
The API stores the quote on the order together with `quote_hash = HMAC_SHA256(canonicalJson(quote))`. Every payment step verifies the hash. A changed catalog never changes an open order; the user must re-quote.

**Invariants (tested):** `total = subtotal + taxAdded + fee`; no line makes a negative total; same input gives the same output; a stricter coupon never beats a more generous one under best-of; `fee` is 0 for fee-free methods; sum of lines equals `total`.

---

## 5. Orders and payments

### 5.1 Entities

- **`orders`**: what is being bought. `number` (`WSO-2026-000123` from a DB sequence), owner (user or org), `kind` (`subscription | upgrade | credit_pack`), plan/pack refs, `months`, `currency`, `quote jsonb`, `quote_hash`, money columns (`subtotal`, `discount`, `tax`, `fee`, `total`), `applied` ids, `status`, `expires_at`, `paid_at`.
- **`payments`**: attempts to pay an order (several allowed: card failed, then InstaPay). `method_key`, `gateway`, `status`, `amount_minor`, `provider_ref` (UNIQUE per gateway), manual-payment fields (`sender_phone_masked`, `txn_id` UNIQUE per method, `proof_file_id`), review fields (`reviewed_by`, `reviewed_at`, `review_note`, `reject_reason`), `failure_code`.
- **`payment_events`**: append-only log of every webhook/poll result: `provider`, `event_id` (UNIQUE with provider), `type`, redacted payload, `signature_ok`, `received_at`. This is the replay shield and the audit trail.
- **`refunds`**: `payment_id`, `amount_minor`, `reason`, `status`, `requested_by`, `approved_by`, `provider_ref`.
- **`payment_methods`**: see §5.5. **`payment_gateways`**: provider credentials, encrypted (AES-256-GCM, key id prefix), `mode` (`test|live`), key hint, last test.
- **`tax_rules`**: `country` (null = default), names ar/en, `rate_bps`, `mode` (`added|inclusive`), `applies_to`, `active`.

### 5.2 State machines

```
order:    pending_payment ─► paid ─► (partially_refunded | refunded)
              │
              ├─► expired   (24 h without a successful payment; coupon released)
              └─► canceled  (by the user)

payment:  created ─► awaiting_customer ─► processing ─► succeeded ─► (partially_refunded | refunded)
                         │                    │
                         │                    └─► failed
                         ├─► awaiting_review (manual, proof uploaded) ─► succeeded | rejected
                         └─► canceled | expired
```
Transitions happen only through `PaymentsService.transition(paymentId, from, to, ctx)`, which locks the row (`FOR UPDATE`), checks the current state, writes a `payment_events` row, and runs side effects exactly once. Illegal transitions throw `CONFLICT`.

### 5.3 Activation (the only place a purchase becomes real)

`PaymentsService.onSucceeded(payment)` in **one transaction**:
1. lock order; if `paid` already, return (idempotent);
2. verify `payment.amount_minor === order.total_minor` and currency; mismatch → payment `failed(amount_mismatch)`, admin alert, **no activation**;
3. mark order `paid`; confirm coupon/promotion redemption;
4. by `kind`: create/extend the **subscription** and its `plan_assignments` row (§7), or grant credit-pack credits (`credit_ledger` kind `purchase`, idempotency key `order:<id>`);
5. grant non-monetary extras (bonus credits, extra months);
6. enqueue (after commit, via the outbox) the receipt email, in-app notification, and the referral reward evaluation (REFERRALS-REWARDS §5).

Side effects outside the database go through an **outbox table** written in the same transaction and drained by the worker, so a crash between commit and email can never lose or duplicate them.

### 5.4 Free orders
A total of 0 (100% coupon, deal, or admin comp) activates without a payment row: the order is `paid` with `payment_kind = free`, still audited, and still counts a coupon redemption. Allowed only when `settings.billing.allowFreeOrders` is true (default true) and the discount source permits it.

### 5.5 Payment methods (admin data)

`payment_methods`: `key`, `kind` (`gateway | manual`), `provider` (`kashier | instapay | vodafone_cash | bank_transfer | …`), names and instructions (ar/en, plain text with `{amount}`, `{reference}` and `{account}` placeholders), `account_display` and `account_holder` (manual), `fee_bps`, `fee_fixed_minor`, `min_amount_minor`, `max_amount_minor`, `currencies[]`, `countries[]` (null = all), `requires_proof`, `review_sla_minutes` (shown to the customer), `enabled`, `sort`, `config jsonb` (non-secret).

**Seeded defaults** (all editable in admin):
- `kashier_card` (gateway, cards and wallets via Kashier hosted page): fee set by the owner from the Kashier contract, default 0 until entered.
- `instapay` (manual): account `01014677026`, fee 0, proof required.
- `vodafone_cash` (manual): account `01014677026`, fee 0, proof required.

Manual methods being fee-free is deliberate: the checkout shows "بدون رسوم" next to them, which turns the processing fee into a visible benefit instead of a surprise.

### 5.6 Gateway interface

```ts
interface PaymentGateway {
  readonly key: string;
  createCheckout(input: { order; payment; returnUrl; webhookUrl; customer }): Promise<{ redirectUrl: string; providerRef: string }>;
  verifyWebhook(raw: Buffer, headers: Headers): Promise<GatewayEvent>;   // signature check, constant-time compare
  getStatus(providerRef: string): Promise<GatewayStatus>;                // reconciliation; never trust the return URL
  refund?(providerRef: string, amountMinor: number, reason: string): Promise<{ providerRef: string }>;
}
```
- **Kashier** is the first adapter. Its exact request/hash/webhook fields are pinned in Task 3.0's spike and recorded in the phase Notes; nothing outside `kashier.gateway.ts` may depend on them. Cards are entered only on Kashier's hosted page (PCI scope stays "redirect": no card data touches our servers).
- **Fake gateway** (refused when `NODE_ENV=production`) drives tests and E2E: scripted success, failure, delayed webhook, duplicate webhook, bad signature, amount mismatch.
- **Stripe** and others later = a new adapter plus an admin row.

Webhook handling: `POST /webhooks/:gateway` (public, `SkipOriginCheck`, raw body kept, 256 KB limit, rate-limited per IP) → verify signature → insert `payment_events` (unique `(provider, event_id)`; conflict = duplicate, answer 200 and stop) → transition. Always answer 2xx for verified events, even when a business rule rejected them, so the provider stops retrying; the rejection is recorded and alerted.

**Reconciliation job** (every 5 min): for payments in `processing`/`awaiting_customer` older than 10 minutes, call `getStatus` and apply the same transition. A nightly job compares paid-order totals with gateway settlements the admin imports (CSV) and reports differences.

### 5.7 Manual payment procedure

1. Checkout: customer picks InstaPay or Vodafone Cash. The server creates `payment(awaiting_customer)` with a short **reference** `WSP-XXXX` and shows: the exact amount, the number to send to (`01014677026` from the method row, with a copy button), the reference to write in the transfer note when the app allows it, the order expiry, and the review SLA.
2. Customer transfers, then returns to the same page (also reachable from the account) and submits: **transaction id** (required), **sender number** (required, Egyptian mobile pattern), **screenshot** (JPEG/PNG/WebP/HEIC through the existing upload pipeline, purpose `payment_proof`, private, ≤ 10 MB). Payment → `awaiting_review`.
3. Duplicate defence at submit: `txn_id` must be unique per method; the proof's SHA-256 and dHash are checked against earlier proofs (a match shows the admin "this image was used on order WSO-…" and blocks auto-flow); at most 3 proof submissions per payment.
4. **Alert** to every admin holding `payments.review` (`AdminAlertService`, §10): amount, plan, masked user, age, deep link.
5. Admin opens the review drawer (ADMIN-CONSOLE-SPEC §4.3): proof image zoomable beside the expected amount, reference, sender number, user history (previous paid orders, flags). Actions: **Approve** (fresh auth ≤ 10 min; approving with a different received amount is possible only as "amount differs" which routes to *partial* handling: reject with a request for the difference, or approve a smaller plan period at the admin's explicit choice), **Reject** (reason picked from a list + note; the customer gets the reason and may resubmit once), **Ask for a clearer proof**.
6. Approve → `onSucceeded` (same activation as a gateway payment). The customer gets email + in-app notification + the receipt.
7. Amounts above `settings.billing.fourEyesThresholdMinor` need a **second admin** to confirm (the first approval puts the payment in `awaiting_second_approval`). An admin can never review a payment of their own account.
8. Unreviewed payments past the SLA raise a reminder alert every 30 minutes (business hours setting), and appear first in the overview's "needs attention" list.

---

## 6. How fees and tax are displayed

Goal: the customer is never surprised, and the price is never visually dirtied before it has to be. This is a rule set, enforced in `display` hints and checked by an E2E test.

1. **Pricing page**: show the plan price, with promotion struck-through. One grey line under the grid: "شامل الضريبة" when tax is `inclusive`, or "تُضاف الضريبة عند الدفع" when `added`. Processing fees are not mentioned here because they depend on the method the customer picks.
2. **Checkout**: the summary is complete on **first render**, before any click on Pay:
   - plan line · discount line (green) · **one combined line "الضريبة والرسوم"** with the amount, expandable (ⓘ) to the itemised tax and fee · **الإجمالي** in the largest type · a pay button that repeats the total ("ادفع 283.10 ج.م").
   - Method list shows each method's fee inline ("بدون رسوم" / "+ 7.20 ج.م"), updating the total live when the selection changes.
3. **Never**: add a line after the Pay click, show a different total on the button, hide the expandable detail, or collect fees in a field that is not part of the quote.
4. **Receipts and emails** show the full itemisation.
5. Admin chooses per tax rule `added` vs `inclusive`. Recommendation recorded in `GROWTH-STRATEGY.md`: prefer **inclusive** tax (what B2C customers expect), and absorb gateway cost in the price for the default card method, leaving manual methods fee-free.

Owner/accountant check before launch: the VAT rate and whether digital services to individuals are taxable (Egypt's standard rate is 14%; **confirm with the accountant**), and whether electronic receipts must be issued to the tax authority for these sales.

---

## 7. Subscriptions

### 7.1 Model
Phase 3 sells **prepaid periods**, not auto-renewing card subscriptions (Decision 1): the customer buys 1/3/6/12 months and renews by paying again (one tap from the reminder). Card-token auto-renewal is deferred until a gateway's recurring API is chosen.

`subscriptions`: `owner`, `plan_id`, `status` (`trialing | active | grace | expired | canceled`), `source` (`paid | trial | admin_grant | deal | promo`), `current_period_start/end`, `months_paid`, `last_order_id`, `cancel_at_period_end`, `canceled_at`, `grace_until`, `pending_change jsonb` (scheduled downgrade), `price_snapshot jsonb`, `created_by`.
`subscription_events`: timeline (`created, renewed, upgraded, downgraded_scheduled, grace_started, expired, canceled, admin_changed, refund_applied`).
`plan_assignments` (Phase 2) stays the **effective-plan record** the quota and credits code already reads; each paid period creates or extends one assignment row, linked by a new nullable `subscription_id`. The resolver is unchanged (Decision 10).

### 7.2 Rules
- **Same plan, new payment while active**: extend, starting at the current `period_end` (no overlap lost).
- **Different plan, higher**: *upgrade now* (§7.3).
- **Different plan, lower**: scheduled at period end (`pending_change`), nothing refunded.
- **Expiry**: at `period_end` the subscription enters `grace` for `settings.billing.graceDays` (default 2): access continues, daily reminders stop at the third, then `expired` and the assignment ends, so the owner falls back to the default plan. Unused plan credits do not carry over.
- **Plan credits**: granted **monthly on the subscription anniversary** (a 12-month prepayment receives 12 monthly grants), idempotency key `grant:<owner>:<YYYY-MM>:<subscription>`. Purchased packs never expire inside `valid_months` (default 12).
- **Trial**: `plans.trial_days` once per owner and per verified phone; grants `trial_credits` (setting), no payment, no card; ends back on the default plan. `source = trial`.
- **Cancel**: sets `cancel_at_period_end`; access continues to the end; no refund unless §7.4.
- **Reminders** (worker): 7, 3 and 1 day before the end, and on expiry, each with a one-tap renew link that pre-fills the order. Then win-back (GROWTH-STRATEGY §6).

### 7.3 Upgrade proration
```
remaining_days   = ceil((period_end − now) / 1 day)
daily_value      = floor(last_paid_net_amount / total_days_of_period)    // net = paid subtotal, excluding tax and fee
proration_credit = min(daily_value × remaining_days, discounted_new_price)
```
The new period starts now and runs the full purchased length; credits for the new plan are granted immediately for the current month. Shown to the customer as one line: "رصيد المدة المتبقية من باقتك الحالية".

### 7.4 Refunds
Policy values live in settings (`refundWindowDays` default 7). Phase 3 refunds are **admin-initiated** (the customer asks through support): refund of the whole payment or an amount, reason required, fresh auth, audited. Effects (all in one transaction): payment/order refunded, subscription ended or shortened as chosen, unused plan credits clawed back (never below zero; used credits are the admin's call, shown as "credits used: N" before confirming), referral rewards for that order reversed (REFERRALS-REWARDS §5.4), coupon redemption kept (a refund does not re-enable a single-use coupon unless the admin ticks it). Gateway payments are refunded through `gateway.refund`; manual payments are refunded outside the app and then **marked refunded with the transfer reference**.

---

## 8. Organizations (institutions)

Phase 2 left organization wallets unbuilt. Phase 3 completes them:
- `credit_wallets` already supports `owner_org_id`; add the **wallet-selection rule**: in an organization context a member spends the **organization's wallet first**, then personal credits only if `organization.allow_personal_fallback` is true; the UI always shows which wallet will pay.
- `organization_member_limits`: optional monthly credit cap per member, set by an org admin.
- Org subscriptions use the same orders, payments and subscriptions with an `owner_org_id`. Seats are limited by `plans.max_members` (or a deal); inviting beyond the limit is refused with a clear upgrade path.
- **Org join links** (`organization_join_links`): slug, role, optional deal, `max_uses`, expiry, `auto_approve | requires_approval`. `/join/<slug>` shows the organisation's name, the member benefit (e.g. a special price) and the sign-up. After sign-up and email/phone verification the user becomes a member and inherits the deal's *member terms*.
- **Org dashboard** (org admins): wallet, plan and expiry, members with usage in the period, caps, invite links, receipts and invoices list.
- Invoices for organizations are *receipt documents* in Phase 3 (printable, RTL, with order number, tax lines, company details from `site_settings.company`). Formal tax-authority e-invoicing is an owner/accountant question, not a Phase 3 deliverable.

---

## 9. Personal offers and credit packs

- `personal_offers`: `owner_user_id`, `kind` (`welcome | winback | renewal | taste`), a reference to a promotion/coupon template, `expires_at`, `consumed_at`, `shown_count`, `dismissed_at`. Created by lifecycle rules (GROWTH-STRATEGY §6). The deadline is server-side truth.
- `taste_grants`: free single uses of a premium mode (e.g. Deep) for a free user: `owner`, `feature`, `granted_at`, `used_at`, `expires_at`, with a global weekly cap (cost control) and one per owner per period.
- Credit packs are bought through the same order flow (`kind = credit_pack`), shown only to users who have used ≥ 70% of their monthly credits or have none left, plus a permanent link on the credits page.

---

## 10. Admin alerts

`AdminAlertService.notify({ kind, severity, refType, refId, summary, link })` fans out to recipients computed from permission (`alerts.receive` plus the kind's own permission, e.g. `payments.review`) and each admin's preferences (`admin_alert_prefs`: `email`, `telegram_chat_id`, `whatsapp_jid`).

| Channel | Default | Notes |
|---|---|---|
| In-app (bell + queue badge) | on | always |
| Email | on | worker `notifications` queue, existing transports and daily cap (critical kinds bypass the cap like verification mail) |
| Telegram | on if the bot is configured | reuses the backup-alert bot; plain text, no PHI |
| WhatsApp (bridge) | **off until the owner approves** (Decision 9) | outbound only to admin numbers that first messaged the bridge to opt in; max 20 messages/day in total; kill switch; digest instead of bursts |

Alert kinds in Phase 3: `payment.review_needed`, `payment.review_overdue`, `payment.amount_mismatch`, `payment.failure_spike`, `withdrawal.requested`, `withdrawal.overdue`, `reward.fraud_flag`, `credits.reconcile_drift`, `points.reconcile_drift`, `refund.requested`. Messages contain order/withdrawal number, amount, masked person, age and a deep link; never proof images, full phone numbers or destinations.

---

## 11. Settings (registry keys added in Phase 3)

`billing` (admin, partly public): `allowFreeOrders`, `minChargeMinor`, `minChargeMode` (`raise` | `refuse`, default `raise`), `quoteTtlMinutes` (15), `orderTtlHours` (24), `graceDays` (2), `refundWindowDays` (7), `maxTotalDiscountBps` (7000), `fourEyesThresholdMinor`, `reviewSlaMinutes`, `fx.usdToEgp`, `company` (legal name, address, tax id for receipts), `creditPackValidMonths` (12), `trial` (`credits`, `oncePerPhone`).
Currencies are **not** duplicated here: the existing public `currency` setting (`default`, `enabled`) is the source for checkout currencies.
`rewards` and `growth` keys are defined in REFERRALS-REWARDS §9 and GROWTH-STRATEGY §9.
Public subset (visible to the web, served inside `GET /catalog`, not as a public settings key): trial availability, whether tax is inclusive, review SLA text, refund window days.

---

## 12. Security rules for money (summary; the full register goes in SECURITY.md)

- No card data ever reaches our servers or logs. Gateway secrets are encrypted at rest, shown masked, and rotated through the same key-id mechanism as AI provider keys.
- Webhooks: signature verified with constant-time comparison, `(provider, event_id)` unique, raw body size-limited, answered 2xx once verified, amount and currency re-checked against the order.
- Orders are recomputed server-side; `quote_hash` is verified before charging; the client cannot send a price.
- `FOR UPDATE` row locks on order, payment, wallet and coupon rows in a fixed order (`order → payment → coupon → wallet`) to avoid deadlocks.
- Rate limits: quote 30/min, order create 10/min, coupon check 10/min, proof upload 10/hour, webhook 600/min/IP; all per user unless stated.
- Admin money actions (approve, refund, adjust, change payment number, change gateway keys) need fresh auth, a reason, an audit row, and `billing.write` or the narrower permission.
- Changing a manual method's **account number** is the highest-risk edit in the product (a hijacker would redirect customers' money): it needs fresh auth + 2FA, shows a diff, notifies every admin by all channels, and waits a 10-minute cooldown before taking effect.
- All amounts in logs and alerts are fine; payer phone numbers and transaction ids are masked in logs (`redact`), shown in full only in the admin review drawer.
