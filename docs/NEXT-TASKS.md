# Wasfa: remaining work (2026-10-29)

> **2026-10-31:** WhatsApp and prescription work moved into **Phase 6** (`docs/phases/phase6.md`): T0 and T1
> are its WP0 baseline (T1 is built on branch `feat/rx-likely-matches`, not merged); T5 and the WhatsApp parts
> of T8 are covered by WP7 and WP10. T2–T4, T6, T7 stay here.

Each task below is self-contained: goal, decisions already made, where the code is, what "done" means.
Work them in the order given. Every task ships as its own PR, green CI (lint, typecheck, unit + int tests,
e2e, Lighthouse), merged to `main`, which deploys automatically.

Contracts already in the repo: `docs/AGENT.md` (rules), `docs/MEDICATIONS.md` (medication database and
matching), `docs/WA-SIGNUP.md` (WhatsApp sign-up), `docs/WA-AGENT.md` (WhatsApp agent).

---

## Status

| Work | PR | State |
|---|---|---|
| Medication database, search, admin section | #69 | merged, deployed |
| Upload limit for the medication file (Caddy) | #75 | merged, deployed |
| Better matching and search (brand level, Arabic names, typos) | #77 | merged, deployed |
| Sign up / sign in with WhatsApp (web + agent), one-screen welcome | #74 | merged, deployed |
| Full prescription reading on WhatsApp + dosing timetable PDF | #72 | open, green, ready to merge |
| Cleaner reading (two-line layout, sanitizer) + formatted result table | #76 | open, green, ready to merge |
| WhatsApp-first homepage redesign | #73 | open, green, ready to merge |

---

## T0. Merge, deploy, import (owner, 30 minutes)

1. Merge in this order, waiting for each deploy: **#76 → #72 → #73**. (#76 and #72 both touch
   `apps/api/src/wa-agent/commerce/agent-event-messages.ts` and `apps/worker/src/documents/data.ts`; if the
   second shows a conflict, the fix is to keep both changes: the full medicine block from #72, with
   `displayName()` / `formLabel()` from #76 applied to the name and form.)
2. Admin → Medications → Imports: upload `docs/datat/egyptian_medicines.json`, source **DWA prices**,
   dry run (expect about 27,617 accepted, 6,383 placeholders rejected), commit.
3. Admin → AI → model routes: `rx_extract` and `rx_verify` on the strongest vision model available.
4. Smoke check (T8).

---

## T1. The database helps read names the model cannot read clearly (highest priority)

**Goal.** When a drug name is unclear, the model does not guess blindly and does not give up: it reads
what it can (letters, length, strength, form, directions), the database proposes the medicines that fit,
and the model chooses the one that fits the visible evidence. The name shown to the user is the
database's name. An exact letter-for-letter match is not required; a letter or a word may differ.

**Today.** Read → match → verify exists (`apps/worker/src/rx/analyze.ts`, `pipeline.ts`, `prompts.ts`).
The verify prompt and `SKILL.md` push the model to answer "none" unless sure, and auto-accept requires a
near-exact name. Result: many correct medicines end up as "AI reading" with the raw letters.

**Decisions.**
1. **Three outcomes per line** (stored as `item.source` + `item.match`):
   - `confirmed`: clear name that matches a database entry (as today's accept).
   - `likely` (new): the model chose a database candidate for an unclear name, consistent with the visible
     evidence. Shown with the database name and a small "مرجّح" badge, plus "عدّل" to pick another.
   - `ai`: no candidate fits; the model's own reading stands (as today).
2. **Wider retrieval for unclear lines** (`legibility` `partial`/`unclear`, or no accept):
   query the matcher with the cleaned name, each `alternatives` reading, and a **letter-shape query**:
   first 2 letters + consonant skeleton + length window (±2) via `brand_key`, filtered by strength when a
   strength was read, and by form when a form was read. Up to 8 candidates per line, deduplicated by
   brand family (keep the variant whose strength matches).
3. **Context signals** passed to the verify step (no new model call; same batched `rx_verify` call with the
   crops): other medicines on the same prescription, their categories / active ingredients, the
   directions line. Example: a stomach medicine taken "قبل الأكل" next to a PPI favours an antacid or
   prokinetic family.
4. **Verify prompt rewrite** (`skills/prescription-analysis/SKILL.md`, verify section): "The candidates come
   from the Egyptian drug list. Choose the candidate whose name is consistent with the visible letters,
   length, strength and form, and that makes sense with the directions and the other medicines. A one-letter
   or one-word difference from what you see is acceptable for handwriting. Answer `none` only when no
   candidate is consistent with what is written." Keep: never invent a name outside the candidates; answer
   `unreadable` when nothing can be read at all.
5. **Answer schema** gains `confidence` (0–1) per verify answer. Mapping: chosen candidate with
   confidence ≥ 0.75 → `likely`; < 0.75 → `ai` with the candidate offered first in "عدّل".
6. **Safety.** A `likely` line is never presented as certain: badge, the line's dose and frequency still come
   only from the prescription, the strength comes from the prescription when written, otherwise it is left
   empty (never the database's strength for a family with several strengths, as today's `familyOnly`).
7. **Learning.** When a user corrects or confirms a `likely` line, the reading becomes an alias vote
   (existing `recordLearningVote`), so the next prescription with the same handwriting is `confirmed`.
8. Same pipeline serves website, WhatsApp and any bot (they all call `RxService`). WhatsApp text and PDF
   show "(مرجّح)" after a likely name.

**Files.** `apps/worker/src/rx/{analyze,pipeline,prompts}.ts`, `packages/shared/src/schemas/rx.ts`
(verify answer `confidence`, item `match: "confirmed" | "likely" | "ai"`), `packages/db/src/drug-matcher.ts`
(letter-shape query as a new exported function, e.g. `shapeCandidates(db, reading, { strength, form, limit })`),
`skills/prescription-analysis/SKILL.md` (+ `pnpm --filter @wasfa/ai build:skills`), display:
`packages/ui/src/RxTable.tsx`, `apps/web/src/components/rx/*`,
`apps/api/src/wa-agent/commerce/agent-event-messages.ts`, `apps/worker/src/documents/data.ts`.

**Done when.**
- Unit tests: shape query candidates, verify answer mapping (confidence thresholds), result building for the
  three outcomes, display of the badge.
- Int test with the real-case rows already in `packages/db/test/drug-matching-real-cases.int.test.ts`:
  "Ripan" (missing letter), "Bebra 20" (b/p), "Glbimet 5", "Motdyl" each reach the right family in the
  candidates; a made-up name with no consistent candidate stays `ai`.
- Pipeline unit test with mocked model calls: an unclear line + candidates → `likely` with the DB name.
- No extra model call per analysis; verify still one batched call.

---

## T2. Analysis results page, polished

**Goal.** A results page that reads like a pharmacist's summary, on phone and desktop.

**Decisions.**
1. **Header card:** date of the prescription (if read), number of medicines, overall status ("كل الأدوية
   واضحة" / "راجع ٢ دواء"), buttons: PDF, share on WhatsApp, copy, new analysis.
2. **One card per medicine** (replaces the wide table on mobile; table stays on ≥ 1024 px):
   name (bold, database name) + strength · form (Arabic labels), a status badge
   (`confirmed` none / `likely` "مرجّح" / `ai` "قراءة آلية" / low confidence "راجعها"), then readable lines:
   "الجرعة: قرص", "المواعيد: ٨ ص · ٢ م · ٨ م (مقترحة)", "المدة: ٧ أيام", "تعليمات الطبيب: …",
   "بيستخدم لـ: …", up to 2 precautions; the crop of the line from the photo on tap ("شوف السطر في الروشتة").
   Suggested times come from `packages/shared/src/rx-schedule.ts` (in #72).
3. **"عدّل"** opens the candidate picker (existing correction flow) showing the candidates from T1 first.
4. **Findings** (duplicate ingredient, strength conflict) as one clear callout above the cards.
5. **Schedule view** toggle: the dosing timetable (same data as the PDF) with check boxes.
6. **States:** analysing (step progress: reading → matching → checking → done, existing events), failed (error
   reference, retry), partially unreadable (note + crop of the unreadable area).
7. Accessibility: headings per medicine, badges with text, contrast AA, keyboard reachable "عدّل".
   Performance: no new dependencies, server components where possible, no layout shift.

**Files.** `apps/web/src/components/rx/*` (result view, overview, print sheet), `packages/ui/src/RxTable.tsx`,
i18n `packages/shared/src/i18n/{ar,en}.rx.ts`.

**Done when.** Web unit tests per state and per badge; e2e `apps/web/e2e/result.spec.ts` updated (360 px and
1440 px, axe clean); Lighthouse unaffected (the page is behind sign-in, so check bundle size of the route).

---

## T3. Sign-in and sign-up pages, polished

**Goal.** The first screen a person sees feels simple and trustworthy, with WhatsApp first.

**Decisions.**
1. **Layout:** two columns on desktop (form card | a calm brand panel: one sentence, three short benefits,
   a small chat illustration reused from the homepage scene); single column on mobile with the brand
   line on top. Same layout for `/login` and `/register`.
2. **Order:** "المتابعة عبر واتساب" (green, full width) → "المتابعة عبر Google" (if configured) → divider
   "أو" → email / phone form collapsed behind "استخدم البريد أو رقم الهاتف" on mobile, open on desktop.
3. **Copy:** short headings ("أهلاً بيك في وصفة" / "حساب جديد في ثوانٍ"), the terms line under the buttons,
   switch link ("عندك حساب؟ ادخل").
4. **WhatsApp panel** (exists in `apps/web/src/components/auth/whatsapp-login.tsx`): on desktop the QR in a
   framed card with the code in large monospace digits, a progress ring for the 5-minute timer, "مستني
   رسالتك…" with a subtle pulse; on mobile a big "افتح واتساب" button, then "رجعت؟ هنكمل لوحدنا".
5. Error and refused states written for people, not codes ("الحساب ده محمي بكلمة سر، ادخل بالطريقة
   العادية").
6. Accessibility and performance as T2; Turnstile untouched.

**Files.** `apps/web/src/app/(auth)/{login,register}/*`, `apps/web/src/components/auth/*`, i18n auth files.

**Done when.** Web unit tests for both pages and the WhatsApp panel states; e2e `auth.spec.ts`,
`turnstile.spec.ts`, `csp.spec.ts` green; axe clean at 360 / 1440 px; no inline `style` attributes (CSP).

---

## T4. First analysis before an account (from docs/WA-SIGNUP.md §6)

**Goal.** A visitor can analyse one prescription without signing up; to see the full result and save it
they continue with WhatsApp (two taps).

**Decisions.** Guest session cookie (httpOnly, 24 h) bound to one free analysis per device and per IP per day
(Turnstile always); the guest sees medicine names and a blurred rest; "اعرض النتيجة كاملة" → WhatsApp sign-up
→ the analysis is attached to the new account (claim by the guest cookie). Credits: the guest analysis is
free and does not consume the free plan's monthly credits. Abuse limits in Redis, admin switch
`rx.guestTrial` (default on). Images of unclaimed guest analyses are deleted after 24 h.

**Done when.** Unit + int tests for the claim and the limits; e2e: guest analysis → sign-up → full result.

---

## T5. Doctor's instructions on the web (from #72 note)

`notes` is shown on WhatsApp and in the PDF (#72) but not on the web result. Thread `notes` into the
result view and the print sheet (part of T2 if done together).

---

## T6. Arabic names for brands (optional, admin button)

An admin-triggered batch job writes an Arabic alias for each brand family (e.g. Riopan → ريوبان) with a
small model, once (~20,000 families), stored as `drug_aliases` (`lang: ar`, `source: ai`), reviewable in
Admin → Medications → Review. Helps Arabic search, the WhatsApp agent and handwritten Arabic names.

---

## T7. Passkeys (optional, later)

Sign-in with fingerprint / Face ID after the first sign-in, through better-auth's passkey plugin.

---

## T8. Smoke check after every deploy (owner, 5 minutes)

1. Homepage loads; WhatsApp button opens the chat.
2. `/login`: "المتابعة عبر واتساب" shows a code (mobile) / QR (desktop); sending it signs in.
3. Medication search: "بانادول", "riopan", a barcode.
4. Analyse the reference prescription (the one with Relaxon / Glibimet / Bepra / Riopan / Motidyl): every line
   has a clean name, dose and timing in the right columns, no Arabic directions in names.
5. WhatsApp: send the same photo to the agent: full reading, suggested times, PDF arrives.
