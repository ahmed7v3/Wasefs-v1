# ADMIN-CONSOLE-SPEC.md — Billing, growth and user 360 screens

> Screen-level specification for Phase 3. Builds on the Phase 1 admin shell (`components/admin/admin-shell.tsx`, `lib/admin-nav.ts`) and the Phase 2 AI console. Tokens and components: `docs/DESIGN-SYSTEM.md`. Domain rules: `BILLING.md`, `REFERRALS-REWARDS.md`, `GROWTH-STRATEGY.md`.
> Quality bar: an admin who has never seen the product can find any record in under 10 seconds, approve a payment in under 30, and understand every number on screen.

---

## 1. Principles

1. **Work comes to you.** The first screen is a "needs attention" inbox, not a chart wall.
2. **One place per object, reachable from anywhere.** Every user, order, payment, coupon, withdrawal and deal has a stable URL and appears as a link wherever it is mentioned.
3. **Drawers, not page hops.** Clicking a table row opens a right-hand (inline-start in RTL) drawer with the full record and actions; the URL updates so it can be shared and reloaded.
4. **Explain every number.** A price, a discount or a balance can be clicked to show how it was computed (the engine breakdown, the ledger rows).
5. **Safe by construction.** Dangerous actions use one pattern: a dialog stating the effect in a sentence, a required reason, fresh-auth when needed, a typed confirmation for irreversible ones, and an audit row.
6. **Fast for repetition.** Keyboard shortcuts in queues, saved filters, bulk actions, CSV export.
7. **Calm visual design.** Navy-only accents per DESIGN-SYSTEM, status chips with icon and text, `tabular-nums` for money, one raised surface per screen, 360 px usable (admins approve payments from a phone).

---

## 2. Navigation (RTL, sidebar groups)

```
الرئيسية                 ← Overview + Needs attention
الإيرادات
  المدفوعات              ← all payments, manual review queue
  الاشتراكات
  الطلبات والفواتير
  الاستردادات
التسعير
  الباقات والأسعار        ← plan editor with live preview + margin calculator
  العروض
  الكوبونات
  باقات الرصيد
  طرق الدفع والرسوم       ← methods, numbers, fees, tax, gateways
النمو
  الإحالات والمكافآت      ← programs, rules, tiers, referral tree
  طلبات السحب
  الصفقات والاتفاقيات      ← deals wizard
  الحملات والتتبّع
  تجارب الاختبار           ← prompts, offers, experiments
المستخدمون                ← list + 360 view (existing section, extended)
المؤسسات                  ← existing section, extended
الذكاء الاصطناعي           ← Phase 2
الإعدادات / السجل / المشاكل ← existing
```
Each item shows a **count badge** for work waiting (payments to review, withdrawals to review, fraud holds). Items are hidden when the admin lacks the permission (and the page still renders a calm 403 if reached by URL).

**Global tools (top bar):**
- **Command palette** (Ctrl/⌘+K): type a phone, email, name, order number (`WSO-…`), payment reference (`WSP-…`), coupon code, referral code, withdrawal number; results grouped by type; Enter opens the record. Backend: `GET /admin/search?q=` (permission-filtered, rate-limited, audited when it returns user records).
- **Alerts bell**: the in-app side of `AdminAlertService` with mark-read.
- **Environment pill**: "تجريبي" when a gateway is in test mode.

---

## 3. Overview (`/admin`, extended) and Billing overview (`/admin/billing`)

**Top: Needs attention** (cards, each with count, oldest age, and a "افتح الطابور" button)
- Manual payments waiting review (oldest age; red past SLA)
- Withdrawals waiting (oldest age)
- Reward holds / fraud flags
- Failed or mismatched payments in the last 24 h
- Subscriptions expiring in 3 days with high value (top 5 listed)
- Promotions ending in 48 h; coupons nearly used up

**Middle: KPIs for a selectable range** (today / 7 d / 30 d / custom) with prior-period comparison: Revenue (net of tax), orders, new paid subscribers, MRR, ARPU, conversion visit→paid and signup→paid, refund rate, AI cost vs revenue (margin), rewards accrued vs paid, credits sold vs consumed. Charts follow the `dataviz` rules; every KPI links to the filtered list behind it.

**Bottom:** funnel (pricing viewed → checkout started → paid) by method, plan mix, referral contribution (% of paid from referrals), top coupons/promotions by revenue.

---

## 4. Revenue

### 4.1 Payments (`/admin/billing/payments`)
Table: time, order no., customer (name + masked phone), plan/months, method, amount, status chip, age. Filters: status, method, date, amount range, "needs review", text search; saved views ("Waiting for review", "Failed today"). Row → drawer with: order breakdown (quote lines), timeline of `payment_events`, customer summary (previous orders, plan, referral info, flags), actions (Refund, Open user, Copy reference).

### 4.2 Manual review queue (`/admin/billing/payments?view=review`)
Dedicated layout: queue on the inline-start, the **review pane** on the other side.
- Review pane: proof image (zoom, rotate, open full size; loaded through a 60 s presigned URL), a checklist panel beside it with **expected amount**, **reference**, **method + account paid to**, **sender number** and **transaction id** the customer typed, with copy buttons and a "matches?" tick for each (client-side aid only).
- Warnings (red banner): duplicate proof image, duplicate transaction id, amount typed differs from expected, account age < 1 day, previous rejected proof.
- Actions: **Approve** (A), **Reject** (R: reason list + note), **Ask for clearer proof** (C), **Skip** (S). Keyboard: J/K move, A/R/C/S act. Approve and reject need fresh auth; the dialog shows the plan and period that will start.
- Above the four-eyes threshold: Approve becomes "Send for second approval", and the second admin sees "approved by X, confirm".
- Header shows SLA timer and who else is reviewing (soft lock: opening a payment marks "being reviewed by …" for 5 minutes, overridable).

### 4.3 Subscriptions (`/admin/billing/subscriptions`)
Table with status, plan, owner, period end, source (paid / trial / admin grant / deal), next action. Filters: expiring in N days, grace, canceled, by plan. Drawer: timeline, entitlements in effect, credits, orders; actions: **Change plan / extend / end** (same dialog as the user page, §8.3), cancel at period end, add credits.

### 4.4 Orders and receipts, Refunds
Orders list (searchable by number); open → receipt preview (print-ready RTL), resend receipt, copy link. Refunds: request list with state; **Issue refund** dialog (BILLING §7.4) shows the consequences before confirming: subscription change, credits to claw back (and how many were used), rewards to be reversed.

---

## 5. Pricing

### 5.1 Plans and prices (`/admin/billing/plans`)
Split view. **Left:** the editor; **right:** a **live preview** of exactly how the plan card and the comparison table look to customers (toggle mobile/desktop, currency, 1/12 months, signed-in/out).
- Plan list on top as sortable chips; a plan is a card with tabs: **Overview** (names, tagline, badge, audience, visibility, trial days, recommended pin), **Prices** (a matrix: rows = durations 1/3/6/12, columns = currencies; click a cell to edit; empty cell = not offered in that currency; "Fill the 12-month price from monthly × 10" helper), **Allowances** (entitlement table from Phase 2: tasks × modes × caps × pages × web search, monthly credits), **Features** (the bullet list customers see, drag to reorder, mark included/excluded/highlight), **Margin** (the calculator of BILLING §2.3 with colour-coded break-even and a utilisation slider), **Who is on it** (counts, link to subscriptions).
- Draft mode: edits stay in a draft until **Publish** (shows a diff: price changes, who is affected: "37 active subscribers keep their price until renewal"). Existing subscribers are never repriced mid-period; the next renewal uses the new price unless a deal says otherwise.
- Archive (never delete) a plan that has subscribers.

### 5.2 Promotions (`/admin/billing/promotions`)
Card grid with status (live / scheduled / ended / paused), dates, redemptions, revenue influenced. **Create wizard** (4 steps, always showing a live pricing-page preview on the side):
1. What (kind and value, e.g. 30% off) and a plain-language summary line generated from the data.
2. Where (plans, durations, countries, audience, new customers only, minimum amount).
3. When and how much (start/end with time zone shown, limit, per-owner limit, show on pricing page, show real countdown, badge text, stacking).
4. Review: the engine **simulator** shows three example baskets with before/after prices, and warns if any plan would fall below the margin floor.
Pause/resume is one click. Duplicating a promotion is the fastest way to build the next one.

### 5.3 Coupons (`/admin/billing/coupons`)
Create single coupon or **bulk** (count, prefix, length, same rules) → progress, CSV download. Fields as BILLING §3; extra: **assign to a user or organization**, link to a campaign or referral code. Table: code, rule summary, used/limit, status, last used; row drawer lists redemptions (who, order, discount). Pause a whole batch. Test box: enter a user + plan + code and see exactly what they would get or why it fails (the same simulator).

### 5.4 Credit packs
Simple CRUD list with prices per currency, bonus credits, validity, visibility; preview of the pack picker.

### 5.5 Payment methods, fees and tax (`/admin/billing/methods`)
- **Methods** as cards: Kashier card (status test/live pill, "اختبار الاتصال"), InstaPay, Vodafone Cash, plus "إضافة طريقة". Each has: enable switch, display names, instructions editor with `{amount}` `{reference}` `{account}` chips and a live preview of the customer screen, **account number and holder** (manual), fee (percent + fixed), min/max, currencies/countries, proof required, SLA text.
- Editing a manual account number uses the protected flow in BILLING §12 (fresh auth + 2FA, diff, all-channel notice, 10-minute cooldown, visible countdown with a cancel button).
- **Gateways** (`/admin/billing/gateways`): Kashier credentials are write-only and masked; changing them or switching mode disables the gateway and linked methods, sends a critical alert, and starts a 10-minute cooldown. Admins test connectivity, copy the webhook URL, run a real EGP test payment and check both its signed webhook and the status API result. The gateway can be enabled only after this end-to-end verification; the owner then enables `kashier_card` from the linked payment methods. Live mode and live test payments require typing `LIVE`.
- **Tax rules**: country, rate, inclusive/added, with a preview of how checkout will show it.
- **Fee presentation preview**: the checkout summary rendered with the current rules, so the admin sees the "quiet fees" layout before publishing.

---

## 6. Growth

### 6.1 Referrals and rewards (`/admin/growth/referrals`)
Tabs:
- **Overview**: invited, verified, paid, rewards accrued/paid/pending, top referrers, referral share of revenue.
- **Programs and rules**: programs list; per program a rules table (event × beneficiary → reward) editable inline with a **plain-language sentence per row** ("عندما يدفع المدعو لأول مرة، يحصل الداعي على 20% من المبلغ نقاطًا قابلة للسحب بعد 14 يومًا"), and a **what-if** panel: choose a sample order amount and see what each side earns.
- **Tiers**: thresholds and bonuses, member counts per tier.
- **Referral tree**: search a user → tree of who invited whom, with status and amounts per node; collapse/expand; export.
- **Codes**: create partner/org/campaign codes, link a deal, pause.
- **Settings**: point value, minimum withdrawal, hold, caps, kill switch, budgets (all with the **EGP equivalent** shown next to every points field).

### 6.2 Fraud and holds (`/admin/growth/fraud`)
List of held rewards with the evidence chips (same device, same payer number, velocity, new account…), the referral chain, and one-click **Release / Void / Block referrer**; bulk select; reasons required.

### 6.3 Withdrawals (`/admin/growth/withdrawals`)
Queue like §4.2: request list (age, amount in points and EGP, method, user), review pane with: the reward breakdown behind the balance (which referrals and orders), flags, account age, previous withdrawals, destination (masked; "Reveal" button decrypts once and writes an audit row), actions **Approve / Reject / Mark paid**. Mark paid asks for the transfer reference and an optional screenshot; a one-click **Copy amount + number** helps when paying in the wallet app. Totals strip: waiting, approved-not-paid, paid this month. Weekly CSV for the accountant.

### 6.4 Deals (`/admin/growth/deals`)
List with target, summary, status, usage (members, revenue). **Deal wizard**:
1. Who (user / organisation / referral code / email domain; search-as-you-type).
2. What (price rules per plan and duration, reward overrides, welcome credits, seats, billing mode) in forms, with a generated plain-language summary.
3. How long and stacking.
4. **Preview**: pick a sample user or "a new member" and see their checkout price before and after; the simulator explains the precedence ("هذه الصفقة طُبّقت لأن المستخدم عضو في صيدلية النور").
5. Create the **join link** and a printable/QR card in one click when the target is an organisation.

### 6.5 Campaigns and experiments
Campaign links with UTM, clicks → signups → paid → revenue. Experiments list: variants, sample, conversion and guardrail metrics, promote/stop. Prompt and lifecycle-rule toggles with their performance (GROWTH-STRATEGY §4, §6).

---

## 7. Organisations (extended)

Organisation drawer gains tabs: **Plan & wallet** (balance, subscription, grant credits, change plan), **Members** (usage this period, caps), **Join links & deals**, **Orders**, **Notes**. "Create organisation deal" shortcut.

---

## 8. User 360 (`/admin/users/<id>`)

The page an admin or support agent lives in. Header: avatar, name, status chips (verified email/phone, 2FA, suspended), plan chip with expiry, wallet balances, **action buttons**: **ترقية / تغيير الباقة**, إضافة رصيد، إيقاف/تفعيل، تسجيل ملاحظة. A sticky summary strip shows: member since, last seen, lifetime revenue, lifetime AI cost, referral source.

### 8.1 Tabs

| Tab | Content | Permission |
|---|---|---|
| نظرة عامة | profile, contact (masked phone/email; reveal logs), organisation memberships, sessions & devices, risk flags, **timeline** (merged: sign-ins, orders, plan changes, credits, rewards, admin actions, support notes) | `users.read` |
| الاشتراك والمدفوعات | current subscription, history, orders and payments, coupons used, deal in effect, **price simulator** for this user | `billing.read` |
| الرصيد | credit ledger and wallets (personal + organisation), usage by task/day | `users.read` + `usage.read` |
| **الروشتات** | **list of every analysis** (date, status, items, confidence, cost, credits), filters, open a result with the same viewer customers use, the image while retained | `users.read_health` |
| المحادثات | chat list and read-only transcript viewer | `users.read_chats` |
| الإحالات والمكافآت | their code, who invited them, whom they invited, points ledger, withdrawals, flags | `referrals.read` |
| ملاحظات | internal notes (author, time, pin), support history | `users.read` |

### 8.2 Health data access rules (Decision 12)
Prescription and chat content are the most sensitive data in the product. Viewing them requires the dedicated permission **and** a short **reason** chosen once per "access session" (30 minutes) from a list (support request / dispute / fraud review / quality review) with an optional note. Every open of a result or transcript writes an audit row (`phi.view`, user, record, reason). The user's privacy policy lists this access. Lists show metadata first (counts, dates, drug names are *not* shown until opened). No export of health data from this page; the support tool never sends images through alert channels.

### 8.3 Upgrade / change plan dialog
Fields: **plan**, **duration** (months or until date), **kind** (gift / compensation / paid-offline / trial / sponsored by deal), **extra credits**, **notify the user** (email + in-app, default on), **reason** (required). If kind is *paid-offline* the dialog also records the amount and method and creates an approved manual payment so revenue reports stay correct. The right side previews: entitlements after the change, new expiry, credits to be granted, and the effect on any current subscription (replace, extend, or schedule). Confirm → fresh auth for anything above a configurable value → audit row + subscription event. The dialog is also reachable from subscriptions and organisation pages.

### 8.4 Other actions
Add/remove credits (reason, fresh auth), grant a coupon or personal offer, void or release reward holds, adjust points (reason, audited), start a refund, impersonation is **not** provided (read-only "act as user" stays Phase 4).

---

## 9. Reusable components to build (all in `packages/ui` or `apps/web/src/components/admin`)

`DataTable` (sticky header, sort, column menu, saved views, keyboard row nav), `FilterBar`, `RecordDrawer`, `StatusChip`, `MoneyCell`, `PointsCell` (points + EGP equivalent), `Timeline`, `ReasonDialog` (reason + fresh-auth + typed confirm), `CommandPalette`, `NeedsAttentionCard`, `KpiCard`, `PricePreviewCard` (customer plan card), `CheckoutSummaryPreview`, `MatrixEditor` (price grid), `SimulatorPanel`, `ProofViewer`, `QueueLayout` (list + review pane with shortcuts), `RuleSentence` (renders a rule as a readable sentence), `EmptyHint` (empty states that explain the next step).

---

## 10. API surface (admin), naming

All under `/admin/billing/*` and `/admin/growth/*`, permission-gated, keyset-paginated `{ items, nextCursor }`, filters validated by shared zod, audited writes, fresh auth where stated. The exact route list is written into `SECURITY.md` §3.1 (endpoint register) as each route is built.

New permissions (added in Task 3.1): `billing.read`, `billing.write`, `payments.review`, `payments.refund`, `promotions.write`, `coupons.write`, `referrals.read`, `referrals.write`, `rewards.adjust`, `withdrawals.review`, `withdrawals.pay`, `deals.write`, `users.upgrade`, `users.read_health`, `users.read_chats`, `finance.export`, `alerts.receive`. Seeded defaults: `super_admin` all; `finance` gets billing, payments, withdrawals, export; `support` gets `users.read`, `billing.read`, `users.upgrade` (bounded), `users.read_health` only if the owner grants it; `marketing` gets promotions, coupons, referrals, deals.
