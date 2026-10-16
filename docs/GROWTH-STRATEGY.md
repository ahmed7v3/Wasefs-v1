# GROWTH-STRATEGY.md — Converting free users to paid ones, without pressure

> Phase 3 Milestone C. This is both the strategy and the rulebook the code must follow. The brief: users should *recognise the value they already get*, feel what they would miss without a paid plan, and subscribe because it is obviously worth it, never because they were nagged, rushed or tricked.

---

## 1. The idea in one paragraph

People pay when three things are true at the same time: they **felt the product work for them** (activation), they **can see what more they would get** (clear, concrete, personal), and **paying is easy and safe** (trust, fair price, local methods). So the strategy is not louder offers. It is: (1) get every new user to a successful first analysis fast; (2) after real moments of value, show exactly what the next plan adds *for them*; (3) let them **taste** the premium experience once; (4) make the price honest and the payment effortless in Egypt (InstaPay, Vodafone Cash, cards); (5) turn happy users into inviters with rewards that cost us little. Every prompt is rare, relevant, dismissible, and measured.

---

## 2. Guardrails (hard rules; E2E tests and code review enforce them)

**We never:**
1. show a countdown that is not tied to a real server-side deadline, or reset one on reload;
2. claim scarcity that is not true ("آخر 3 أماكن") or social proof that is invented or too small to be credible;
3. add fees, items or steps after the Pay click, or pre-check any add-on or auto-renewal;
4. use fear about health or confirm-shaming copy ("لا، لا أهتم بصحتي");
5. interrupt a task, an upload, an analysis or an error screen with an upsell;
6. show more than **one** upgrade prompt per session, or the same prompt again before its cooldown (default 7 days, doubling after each dismissal, never beyond 60 days);
7. make cancelling or declining harder than subscribing;
8. gate the safety-critical parts of a result (warnings, "unreadable" notes, disclaimers) behind payment.

**We always:** state the price in the local currency, show the total before payment, say how long access lasts, offer a refund path (policy in settings), and keep every prompt closable with one tap (and remember the choice).

---

## 3. The funnel and where each mechanism lives

```
visit ─► sign up ─► verify ─► FIRST ANALYSIS (activation) ─► repeat use ─► limit/value moment ─► plan page ─► checkout ─► paid ─► renew / invite
```

| Stage | Goal | Mechanisms |
|---|---|---|
| Visit → sign up | trust | landing page (Phase 1), pricing page with a visible free plan, "no card needed", welcome credits |
| Sign up → first analysis | **activation in the first session** | onboarding ends on "ارفع أول روشتة" with capture surface prefilled; the 20 welcome credits (referral) or the free monthly credits are shown as value |
| Repeat use | habit | history, drug info and chat skills surfaced on the dashboard, gentle weekly summary |
| Value moment | desire | contextual prompts (§4), value ledger, taste of Deep mode |
| Plan page | clarity | personalised "الأنسب لك", honest savings, real promotions |
| Checkout | zero friction | complete summary on first render, local methods, WhatsApp help link |
| Paid → renew | retention | reminders with one-tap renew, value recap, loyalty perks |
| Happy → invite | acquisition | rewards page, share after success moments |

---

## 4. Contextual prompts ("value moments")

A **moment** fires only when its condition is true and the frequency caps allow it. Display forms: an inline card below content (never a modal), or a dismissible banner in the app shell. The engine is `GrowthService.nextPrompt(user, context)` returning at most one prompt; the web renders it and reports `shown / clicked / dismissed`.

| Moment | Condition | What the user sees (sample Arabic) | Plan angle |
|---|---|---|---|
| After a successful analysis | first, third and tenth analysis, result has ≥ 1 medium/low item | «حلّلنا روشتتك. 3 بنود تحتاج تدقيقًا. التحليل العميق يراجعها بدقة أعلى، جرّبه مجانًا هذه المرة.» → *taste* | Deep mode (Pro) |
| Credits running low | ≥ 70% of monthly credits used | «استهلكت 24 من 30 رصيدًا هذا الشهر. باقة بلس تمنحك 150 رصيدًا بـ 99 ج.م.» + pack link | Plus / pack |
| Credits out | 0 left | «انتهى رصيدك المجاني. يتجدد بعد 5 أيام، أو يمكنك شراء رصيد إضافي الآن.» (always shows the free renewal date first) | pack, plan |
| Locked feature touched | user taps a locked mode or web search | explains what it does with a **real sample result**, one button «شاهد الباقات» and one «ليس الآن» | matching plan |
| Repeat prescriptions | same drug appears ≥ 3 times | «تتابع علاجًا مزمنًا؟ سجل التحليلات والتذكير بالتجديد في باقة برو.» only if the feature exists | Pro |
| Pharmacy/clinic usage | ≥ 3 members or ≥ 40 analyses/month on an org | «فريقك استخدم 120 تحليلًا هذا الشهر. باقة العيادة تخفض تكلفة التحليل 40%.» with the maths | Clinic |
| Expiring free credits | 3 days before month end, credits unused | «لديك 12 رصيدًا ينتهي بعد 3 أيام.» (true, no upsell button, just a «حلّل روشتة الآن») | usage, then trust |
| Plan expiring | 7 / 3 / 1 days | «باقتك تنتهي بعد 3 أيام. جدّد بنقرة.» with renewal discount if configured | renewal |

All strings live in the i18n files with variants for A/B testing. Medical wording rule: describe *what the product does*, never what could happen to the user's health.

---

## 5. The taste: letting people feel the premium

Words do not convince; a better result does. **Taste grants** give a free-plan user one free use of a premium mode:

- Offered after a result with uncertain items (the moment where Deep mode visibly helps). Shown as «جرّب التحليل العميق مجانًا (مرة واحدة هذا الأسبوع)».
- The Deep re-analysis of **the same prescription** runs; the UI shows the two results side by side with the improved items highlighted («البند 2: كان "غير مؤكد" وأصبح مطابقًا لـ …»).
- Afterwards: one calm line with the price of the plan that includes it. No timer.
- Cost control: `growth.taste.perUserPerWeek` (1), `growth.taste.weeklyBudgetCredits` global cap, only for verified accounts, disabled by the kill switch. Expected cost is a few US cents per taste.
- Every taste is a `taste_grants` row; abuse (multiple accounts) is limited by the verified-phone rule.

---

## 6. Lifecycle (emails + in-app), with real deadlines

Marketing mail is separate from transactional mail: opt-in at registration (unchecked by default where the law requires, clearly explained), one-click unsubscribe, max **1 marketing email per week**, never during the first 24 hours. Brevo's daily cap is shared, so lifecycle mail is deferred before transactional mail is.

| When | Trigger | Content |
|---|---|---|
| Day 0 | sign-up verified | welcome + «ارفع أول روشتة» (transactional) |
| Day 1 | no analysis yet | «بدأت؟ هذه طريقة التصوير الأفضل» (guide, no offer) |
| Day 3 | ≥ 1 analysis | «ما استفدته حتى الآن» value recap (analyses, drugs checked, time saved estimate labelled «تقديري») |
| Day 6 | ≥ 3 analyses, still free | **personal welcome offer** (`personal_offers`, 48 h, real server deadline, e.g. 20% off first month) |
| Plan −7 / −3 / −1 | subscription ending | one-tap renew (+ renewal perk if set) |
| Expiry +3 | expired | «نحتفظ بسجلك. عد متى شئت» + small win-back offer (7 days) |
| Expiry +30 | still free | last gentle message, then silence for 90 days |
| After a refund / complaint | | no marketing for 30 days |

Offer creation is rule data (`growth_rules`): condition, template promotion, validity hours, per-owner limit. Admin toggles each rule and sees its performance.

---

## 7. The plans page (what the page does to help the decision)

1. **Three clear tiers plus the free one.** No decoy tricks; the middle plan is highlighted only if it is genuinely the most chosen (§8 "الأكثر اختيارًا" requires data above a threshold; an admin pin is allowed but labelled «موصى به»).
2. **Personalised «الأنسب لك»**: from the user's last 30 days of credit use, recommend the cheapest option that covers it and show honest savings against buying packs: «تستخدم حوالي 140 رصيدًا شهريًا. بلس يكلفك 0.71 ج.م للرصيد بدل 0.79 في الباقات.»
3. **Annual framing**: monthly price struck from the 12-month price, and «وفّر شهرين» (real arithmetic from the catalog).
4. **Value ledger above the grid** (signed-in users): «حلّلت 23 روشتة · راجعت 61 دواءً · وفّرت ≈ 5 ساعات (تقدير)».
5. **Real promotions** with real end dates; countdown only if the promotion has one and `show_countdown` is on.
6. **Risk reversal**: refund window text from settings, «بدون تجديد تلقائي» (true in Phase 3), «ادفع بإنستا باي أو فودافون كاش أو بطاقة».
7. **Comparison table** that is scannable and honest, including what the free plan does well.
8. **FAQ** answering price, privacy of prescriptions, cancellation, invoices.
9. **Human help**: a WhatsApp «أحتاج مساعدة في الاختيار» button (support number from settings).
10. Organisations: a separate «للصيدليات والعيادات» section with seat maths and «اطلب عرضًا خاصًا» (creates a lead and a deal draft).

---

## 8. Social proof and honesty rules

- Counters («حُلّلت X روشتة هذا الأسبوع») show only above `growth.proof.minCount` (default 500) and come from real totals, cached hourly. Below the threshold the element is simply absent.
- «الأكثر اختيارًا» appears only when the plan holds the largest share of paid subscriptions in the last 30 days and the sample is ≥ 30.
- Testimonials need a stored consent record (`consent_ref`) and are admin-managed content, never invented.

---

## 9. Measurement and experiments

**Events** (`growth_events`, first-party, no PHI, no free text): `pricing_viewed`, `plan_selected`, `checkout_started`, `method_selected`, `payment_submitted`, `payment_succeeded`, `payment_failed`, `proof_submitted`, `prompt_shown(kind)`, `prompt_clicked`, `prompt_dismissed`, `taste_started`, `taste_completed`, `offer_shown`, `offer_used`, `referral_link_opened`, `referral_signup`, `referral_paid`, `coupon_applied`, `coupon_failed`.
Each has `user_id`, `session_id`, `occurred_at`, `props` (small jsonb), `variant`.

**Funnels and KPIs** (admin overview): visit→signup, signup→activation (first analysis within 24 h), activation→paid within 30 days, checkout start→paid, method mix, ARPU, MRR, churn at renewal, referral K-factor (invitees per inviter × conversion), payback (revenue minus AI cost minus rewards), cost per analysis vs revenue per analysis.

**Experiments**: variants are feature flags with percentage rules (existing flags system; the bucket is stable per user). Copy variants are i18n keys. An experiment ends when it reaches `minSampleSize` per arm or a time limit; the admin sees conversion plus **guardrail metrics** (refund rate, support contacts, prompt dismissals, unsubscribes). A variant that raises conversion but also refunds or complaints beyond `guardrailBps` is flagged red and not promoted.

**Settings** (`growth` registry key): `prompts.enabled`, `prompts.cooldownDays`, `prompts.maxPerSession` (1), `taste.*`, `proof.minCount`, `mostChosen.minSample`, `marketingMail.maxPerWeek`, `experiments.guardrailBps`, `welcomeOffer.*`, `winback.*`.

---

## 10. Pricing and fee presentation (decision record)

- Prefer **tax-inclusive prices** and a default card method whose fee is absorbed in the price; keep manual methods fee-free and say so. Customers dislike late surprises more than they dislike a slightly higher honest price, and last-step fees raise abandonment and chargebacks.
- When tax or fees must be added, they appear on the first checkout render as one quiet combined line, expandable, with the exact total repeated on the Pay button (BILLING §6). This meets the brief (fees not over-emphasised) without ever hiding them.
- Price experiments change **display and framing** (annual first, which tier is highlighted), never the amount charged to one user versus another for the same offer without an explicit deal or promotion.

---

## 11. Referrals as part of the loop

- The share prompt appears **after success moments** (a good analysis, a renewal, a reward earned), not on a timer.
- Copy states what both sides get in one line; the link preview (OG image) shows the product, not the reward.
- Doctors and pharmacists are the best channel: partner codes with deals (REFERRALS-REWARDS §7) and a printable QR card for counters.
- Institutions: the join link with a member price is the strongest acquisition tool in this market; the admin console makes creating one a 2-minute task.
