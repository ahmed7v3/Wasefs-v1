# REFERRALS-REWARDS.md — Referrals, points, withdrawals, deals

> Domain specification for Phase 3 Milestone B. Read `docs/BILLING.md` first (orders, payments, price engine). Everything numeric below is a **default** that the admin edits; nothing is a constant in code (AGENT §5.9).

---

## 1. The model in one page

```
 invite link / code ─► sign-up ─► (verified) ─► first payment ─► renewals
        │                 │            │              │              │
        ▼                 ▼            ▼              ▼              ▼
   attribution      welcome points   reward rules evaluate on each event
   (first touch)    for both sides   → points enter the PENDING bucket
                                     → after the hold period they move to
                                        CASH   (can be withdrawn or converted to credits)
                                        CREDIT_ONLY (can only become credits)
```

- A **point** is an integer unit. **1,000 points = 100 EGP** by default (`pointValueMinor = 10`, i.e. 1 point = 10 piasters). The admin can change the rate; withdrawals snapshot the rate at request time.
- Points are **rewards, not money**: non-transferable, no interest, no purchase of points with money. The terms page says so (owner to confirm wording with a lawyer).
- Three buckets per user, because the *cost* and the *fraud risk* of each reward differ:

| Bucket | Meaning | Can become |
|---|---|---|
| `pending` | earned, still inside the hold window (refund/fraud protection) | released to `cash` or `credit_only`, or reversed |
| `cash` | earned from paid conversions | cash withdrawal **or** credits |
| `credit_only` | earned from cheap events such as verified sign-ups | credits only |

This answers the brief ("withdraw as cash or convert to credits") while limiting what a sign-up farmer can extract: fake accounts can earn `credit_only` points at most, which cost us a few cents of AI usage, never cash.

---

## 2. Attribution

- Every user gets a referral code at first login (`referral_codes`, kind `user`): 7 characters, no look-alike letters, optional **one-time vanity edit** (3–20 chars, profanity and brand-name check). Admins can create **partner codes** (doctors, influencers, pharmacies), **org codes**, and **campaign codes**.
- Entry points: `/r/<code>` (sets a first-party cookie `wasfa_ref`, 30 days, `SameSite=Lax`, also written into `sessionStorage` for the register form), a **Referral code** field on the register screen (optional, prefilled from the cookie), `?ref=` on any public URL, and organisation join links (`/join/<slug>`, which carries the organisation's code and deal).
- **First touch wins** within the window; the referred user is fixed at registration (`referrals.referred_user_id` UNIQUE), so the relation can never be re-assigned by a later link. Admins can correct an attribution (audited, reason).
- Referrers see **counts and first-name initials only** ("م. أ."), never the invitee's email or phone.
- Campaign links `/c/<slug>` (Task 3.16) write the same attribution record with `source = campaign`, so one funnel report covers both.

---

## 3. Programs, rules and tiers

### 3.1 Programs
`referral_programs`: `standard` (every user), `partner` (doctors/pharmacists/influencers, assigned by an admin), `organization` (members of an institution). A user belongs to one program; the admin moves them between programs. Each program has its own rules.

### 3.2 Reward rules (`reward_rules`)
One row = "when **event** happens, give **beneficiary** a **reward**":

| Field | Values |
|---|---|
| `event` | `referee_verified` (the referred person verified email and phone), `first_payment`, `renewal` (n-th renewal up to `max_renewals`), `credit_pack`, `org_member_joined` |
| `beneficiary` | `referrer`, `referee` |
| `reward_kind` | `fixed_points`, `percent_of_net_bps` (of the paid subtotal, excluding tax and fees), `fixed_credits` |
| `value` | integer (points, bps or credits) |
| `redeemable_as` | `cash_or_credits` or `credits_only` |
| `hold_days` | days in `pending` before release (0 allowed for credits) |
| limits | `max_per_referrer_per_day`, `max_per_referrer_total`, `min_order_minor`, `valid_from/to`, `max_renewals` |
| `program_id`, `priority`, `active` | the most specific active rule per (event, beneficiary) wins |

### 3.3 Proposed defaults (editable)

| Event | Referrer gets | Referee gets |
|---|---|---|
| `referee_verified` | 50 points, `credits_only`, hold 3 days | 20 welcome credits (instant, once) |
| `first_payment` | 20% of net paid, as points, `cash_or_credits`, hold 14 days | 10% off the first payment through the referral (a rule-driven coupon) |
| `renewal` | 10% of net paid for the first 3 renewals | – |
| `credit_pack` | 5% of net paid | – |

Example: a friend subscribes to Pro for 299 EGP (net 299): the referrer earns 20% = 59.80 EGP = **598 points**, withdrawable after the 14-day hold. A friend who only registers gives the referrer 50 credit-only points and the friend 20 welcome credits: *both sides get points/credits for sign-up*, as requested.

### 3.4 Tiers (`referral_tiers`, optional per program)
Progress by **paid** referrals in the last 12 months: e.g. Bronze 0, Silver 5 (+2 percentage points), Gold 15 (+5), Platinum 40 (+8). The tier adds basis points to the `percent_of_net_bps` rules. The referrals page shows the next tier and what it unlocks. Admin edits thresholds and bonuses; a tier change is never retroactive.

---

## 4. Ledger and balances

`points_wallets`: `user_id` UNIQUE, `pending`, `cash`, `credit_only` (integers, CHECK ≥ 0), `lifetime_earned`, `updated_at`.
`points_ledger` (append-only, `wasfa_api` has INSERT and SELECT only): `wallet_id`, `group_id` (rows of one movement share it), `kind`, `bucket`, `amount` (signed), `reference_type/id` (referral, order, withdrawal), `rule_id`, `idempotency_key` (UNIQUE), `release_at` (for pending credits), `actor_id`, `reason`, `created_at`.

Kinds: `reward_pending`, `reward_release` (pending −x, cash/credit_only +x), `reward_reverse` (refund, fraud), `convert_to_credits`, `withdraw_hold`, `withdraw_paid`, `withdraw_release`, `admin_adjust`, `expiry`.

Invariants (tested, and checked nightly): wallet bucket = SUM(ledger of that bucket); no bucket negative; each `group_id` sums to zero movement or to a documented creation/removal; every ledger row has a unique idempotency key. All balance changes happen in the same transaction as their ledger rows, under `SELECT … FOR UPDATE` on the wallet (lock order: order → referral → wallet).

**Release job** (hourly): pending entries with `release_at <= now` move to their target bucket unless the referral is `blocked/void` or the order was refunded (then `reward_reverse`).
**Expiry** (optional, setting `rewards.expireAfterMonths`, default off): unused points expire with 30 days' notice.

---

## 5. Evaluating rewards

`RewardsService.onEvent(event)` runs from the outbox after an order is paid / a user verifies / a member joins:

1. Find the `referrals` row for the beneficiary context; stop if none, if `status = blocked`, or if the program is paused (`rewards.killSwitch`).
2. Resolve the deal for the referrer and referee (override rules, §7) and the matching `reward_rules` (deal rules > program rules > global).
3. Check limits and **fraud checks** (§6). A failed check writes a `reward_decisions` row with reason `held_for_review` or `denied`, never silently nothing.
4. Compute points (integer; `percent_of_net_bps` applied to the paid subtotal, floor), apply the tier bonus.
5. Insert ledger rows with idempotency key `reward:<rule>:<referral>:<order|event>:<beneficiary>`. Retrying never double-pays.
6. Notify the beneficiary ("حصلت على 598 نقطة"), in-app and optionally by email, without revealing who is who beyond initials.

### 5.4 Reversals
Refund of an order → `reward_reverse` for each reward it produced. If the points were already released and spent/withdrawn, the wallet may go to a **negative balance debt** recorded as `reward_debt` that is offset against future earnings (the wallet itself never goes below zero; the debt is its own column). Admins see debts in the withdrawals screen and can waive them.

---

## 6. Anti-fraud

| Abuse | Control |
|---|---|
| Self-referral / farming sign-ups | A referral rewards only after the referee **verifies email and phone**; one verified account per phone already exists; same verified phone, same payer number, same device/IP hash as the referrer ⇒ `held_for_review`. Sign-up rewards are `credits_only`. |
| Disposable emails, bot sign-ups | Existing blocklist, Turnstile, breached-password check; sign-up rewards need the referee's **first AI analysis** completed (setting `rewards.requireFirstUsage`, default on). |
| Buy-and-refund | Cash rewards sit in `pending` for the refund window plus a safety margin (default 14 days) and are reversed on refund. |
| Same person, many wallets | A withdrawal destination can be saved on only one account (unique hash); a second account trying it ⇒ flag. |
| Payout fraud via account takeover | New destination: 48-hour **cooldown** and an email/in-app notice; requesting a withdrawal needs fresh auth (+2FA for accounts that have it); first withdrawal always manual review with extra checks. |
| Volume | per-referrer daily/total caps, a velocity rule (e.g. > 10 sign-ups/hour ⇒ hold all and alert), global weekly reward budget (`rewards.weeklyBudgetPoints`; beyond it, new rewards queue for review). |
| Colluding admins | withdrawals above `rewards.fourEyesThresholdPoints` need two different admins; an admin cannot approve or pay their own request; reward adjustments need a reason and are audited and reported in the weekly digest. |

Each referral keeps a `fraud_score` and `flags` (rule names). `/admin/growth/fraud` lists held items with the evidence and one-click **Release / Void / Block referrer**. Scoring is rules only in Phase 3 (no ML); every rule is a toggle in settings.

---

## 7. Deals (custom arrangements for a person or an institution)

A **deal** is a named bundle of terms assigned to targets. Typical uses: "every member who joins through Al-Nour Pharmacy pays 79 EGP/month for Plus", "Dr. Ahmed's code gives 30% commission and the friend 20% off", "Clinic X gets 5 seats and 500 bonus credits a month, invoiced manually".

### 7.1 Data
- `deals`: `name`, `status` (`draft | active | paused | ended`), `starts_at`, `ends_at`, `terms jsonb` (validated by a shared zod schema, below), `notes` (internal), `created_by`.
- `deal_targets`: `deal_id`, `target_kind` (`user | organization | referral_code | email_domain`), `target_id` / `domain` (verified email domain, e.g. `alnour-pharmacy.com`), `member_only bool`.
- Orders store `deal_id` for the audit trail.

### 7.2 Terms (`deals.terms`)
```jsonc
{
  "pricing": [ { "planKey": "plus", "months": [1,12], "mode": "fixed", "amountMinor": 7900, "currency": "EGP" },
               { "planKey": "pro",  "mode": "percent_off", "bps": 2000 } ],
  "stackWithPromotions": false, "stackWithCoupons": false,
  "membership": { "durationMonths": 12, "newMembersOnly": true },       // how long the member price follows a member
  "rewards": { "referrerSignupPoints": 100, "referrerPaymentBps": 3000, "refereeSignupCredits": 30, "maxRenewals": 6 },
  "credits": { "welcomeCredits": 50, "monthlyBonusCredits": 0 },
  "seats": { "maxMembers": 20 },
  "billing": { "mode": "self_pay" }       // self_pay | org_pays | manual_invoice
}
```
Unknown keys are rejected. Money in terms is per currency.

### 7.3 Precedence
For one owner and one purchase, the engine picks **one** deal: `user` target > `organization` membership > `referral_code` used at sign-up > `email_domain`. Within a kind the newest active deal wins. The simulator (admin) shows which deal was chosen and why. A deal never makes a price negative or below `settings.billing.minChargeMinor`.

### 7.4 "Special price for everyone who joins through an institution"
1. Admin creates the organisation (or uses an existing one) and a **join link** with a deal whose `pricing` lists the member price and `membership.durationMonths`.
2. A visitor opens `/join/<slug>`: sees the institution name and the member benefit, signs up, verifies.
3. The user becomes an organisation member (`organization_members`) with `joined_via_link_id`; the deal's member terms attach to the user for the stated duration.
4. At checkout the engine resolves the deal and the member sees the special price as an ordinary discount line ("سعر أعضاء صيدلية النور").
5. Institution-level reward: the deal can also pay the *institution* (as a partner referrer) a percentage of members' payments, withdrawable like any other reward by the organisation's designated owner account.

---

## 8. Conversion and withdrawal

### 8.1 Points → credits
`POST /me/rewards/convert { points }`: uses `credit_only` first, then `cash`. Rate and bonus are settings: `rewards.pointsPerCredit` (default 5, because 1 credit ≈ 0.5 EGP at the default point value) and `rewards.creditConversionBonusBps` (default 2000 = +20% credits, a deliberate nudge: credits cost us less than cash and keep the user in the product). One transaction: points ledger rows (`convert_to_credits`) + a credit ledger `grant` (new kind `points_conversion`), idempotent per request id. The preview always shows the exact credits before confirming.

### 8.2 Withdrawal (cash only from the `cash` bucket)
**Eligibility** (all settings): `cash ≥ rewards.minWithdrawalPoints` (default **1,000 points = 100 EGP**), verified phone, account age ≥ `minAccountAgeDays` (default 7), no open request, monthly cap, kill switch off, no unresolved reward debt.

**Payout methods** (`payout_methods`, admin data): `key` (`vodafone_cash`, `instapay`, `bank`, …), names, **field schema** (e.g. wallet number with Egyptian mobile pattern, InstaPay address, IBAN), `enabled`, fee (usually 0), min/max, processing note ("خلال 48 ساعة عمل"), countries.
**Destinations** (`payout_destinations`): per user, the value stored **encrypted** (AES-256-GCM) with a masked display (`010••••7026`) and a SHA-256 `destination_hash` (uniqueness and fraud checks). Adding or changing one starts the cooldown.

**State machine**
```
requested ─► approved ─► paid
    │            │
    │            └─► rejected   (points released back to cash, reason sent)
    ├─► canceled (by the user, while requested)
    └─► rejected
(overdue timers raise alerts)
```
1. `POST /me/withdrawals { points, destinationId }`: fresh auth; points move `cash → withdraw_hold`; the cash amount and rate are **snapshotted** on the request (`amount_minor`, `currency`, `rate_minor_per_point`). Idempotent per request id; concurrent requests cannot exceed the balance.
2. Alert to every admin with `withdrawals.review`: amount, user (masked), account age, lifetime earned, fraud flags, deep link (BILLING §10). Email + in-app + Telegram by default; WhatsApp only if the owner enabled that channel.
3. Admin reviews in the queue (ADMIN-CONSOLE-SPEC §5.3): sees referral breakdown behind the balance, flags, past withdrawals, destination (decrypted only on demand, each view audited). **Approve** (fresh auth; two admins above the four-eyes threshold).
4. Admin pays outside the app (Vodafone Cash / InstaPay), then **Mark paid** with the transfer reference (required, unique) and optional proof screenshot. Ledger `withdraw_paid`; user notified by email + in-app.
5. **Reject** with a reason: ledger `withdraw_release`, user notified with the reason.
6. Reconciliation: weekly "paid out" total equals the sum of `withdraw_paid` ledger rows; a report lists requests older than the SLA.

Withdrawal fee, tax withholding and KYC thresholds are settings that default to off; **the owner must confirm the legal treatment of payouts to individuals with an accountant before enabling real payouts** (Open question in phase3.md).

---

## 9. Settings (`rewards` registry key, admin; a public subset shows the user their own rules)

`enabled`, `killSwitch`, `pointValueMinor` (10), `currency` (EGP), `minWithdrawalPoints` (1000), `maxWithdrawalPointsPerMonth`, `minAccountAgeDays` (7), `destinationCooldownHours` (48), `holdDaysDefault` (14), `fourEyesThresholdPoints`, `pointsPerCredit` (5), `creditConversionBonusBps` (2000), `requireFirstUsage` (true), `weeklyBudgetPoints`, `expireAfterMonths` (null), `fraud` toggles and thresholds, `payoutSlaHours` (48), `tiersEnabled`.
Reward rules, programs, tiers, payout methods, and deals are tables, edited from the console, all audited.

---

## 10. What users see

`/rewards` (named **الدعوات والمكافآت** in navigation):
1. **Hero**: your code + link + copy/share buttons (WhatsApp, Telegram, copy) with a one-line preview of what each side gets.
2. **Balance card**: cash points (with the EGP value), credit-only points, pending (with "ستُضاف خلال X يوم"), and the two actions: *تحويل إلى رصيد* (shows the +20% bonus) and *سحب* (disabled with the reason until the minimum is met, with a progress bar toward 1,000).
3. **Progress**: tier and next tier; invited / verified / paid counts.
4. **Activity**: a plain list of every ledger movement in Arabic ("+598 نقطة: اشتراك صديق في باقة برو (م. أ.)").
5. **Withdrawals**: requests with status timeline, destinations (masked), cooldown notice.
6. A short, honest **how it works** with the rules (hold period, minimum, why a reward might be held).
