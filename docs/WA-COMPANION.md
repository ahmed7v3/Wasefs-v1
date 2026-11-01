# رفيق وصفة — Wasfa Companion on WhatsApp (spec, 2026-10-31)

> **Owner request (2026-10-31):** one new feature that lifts the WhatsApp experience to an extraordinary level
> and makes the agent indispensable.
>
> **The idea:** today a prescription is read once and forgotten. Companion turns it into a **living treatment
> plan inside the chat the patient already uses every day**: it checks that the pharmacy dispensed the right
> medicine, builds a personal schedule, reminds and records doses, watches for duplicates across every
> prescription the patient has, and tells them before a box runs out — with the cheaper equivalents from the
> database. No app to install, no account screen to learn: a photo and a few words.
>
> Rules: `AGENT.md` §5.11 (assist, never prescribe), §5.5 (credits through the ledger), §5.9 (all switches and
> caps in admin), anti-ban rules (`SECURITY.md` §8, `WA-AGENT.md` §9). Engine: `RX-ENGINE.md` §7.

---

## 1. Why this is the feature
- **Dispensing errors are common and invisible:** look-alike/sound-alike brands, the wrong strength, a
  substitute with a different ingredient. Nobody checks the box against the handwriting at the counter.
  Wasfa can, in 10 seconds, from two photos. This is the moment that makes a family trust the product.
- **Adherence is the real problem after the pharmacy:** the timetable, reminders and a dose log in WhatsApp
  remove the paper and the guessing, for the patient and for the person caring for them.
- **Daily, useful contact** keeps the conversation (and the 24 h window) alive naturally, which is what makes
  every other agent feature (plans, renewals, questions) reachable without ever messaging first.

## 2. The five parts

### 2.1 Dispense check — «اتأكد من الصرف» (headline)
1. After an analysis (or anytime): «صوّر العلب اللي اتصرفت» → the customer sends photos of the boxes/strips.
2. For each box: **barcode first** (the model reads the 13 digits printed under the bars; exact lookup on
   `drugs.barcode`, the DWA data has it), else the box text read by a vision call (brand, strength, form are
   printed, so they weigh more in fusion) → `resolveDrugName` with packaging features (RX-ENGINE §7).
3. Each box is compared with the prescription lines by **database facts**, never by image similarity
   (Decision 87):
   | Result | Rule | Message |
   |---|---|---|
   | ✅ مطابق | same brand family + same strength | «ده نفس الدوا اللي في الروشتة» |
   | ✅ بديل مكافئ | different brand, **same active-ingredient set and strength** | «ده بديل بنفس المادة الفعالة والتركيز (X بدل Y)» |
   | ⚠️ تركيز مختلف | same ingredients, different strength | «التركيز مختلف عن المكتوب (20 بدل 40) — اسأل الصيدلي قبل ما تبدأ» |
   | ⛔ مختلف | different ingredient set | «ده مش نفس الدوا المكتوب — ارجع للصيدلي» |
   | ❓ مش متأكد | box not resolved or the prescription line is `uncertain`/`ai` | «مقدرتش أتأكد — وريه للصيدلي» + what was read |
4. A dispense report (text + optional PDF page appended to the rx report). Every message ends with «القرار
   للطبيب والصيدلي».
Cost: one vision call per batch of ≤ 6 boxes (`rx_box` task), charged `companion.dispenseCheckCredits`
(admin; default = 1 light credit); barcode-only resolutions make no model call and are free.

### 2.2 Medicine cabinet — «أدويتي»
- `med_courses` (per linked user): drug (database id or reading), strength, form, dose, frequency, meal
  relation, start date, duration/end date, source (`rx` line | `box` | `manual`), status (`active | paused |
  finished | stopped`), and the rx/line reference. Created **only with the customer's consent**: after an
  analysis «تحب أضيف الأدوية دي لخزانتك وأفكرك بمواعيدها؟ (نعم/لا)».
- Commands/tools: `my_medications`, «ضيف <اسم>» (resolved through the database with confirmation), «وقفت
  <اسم>» (marks stopped; the agent never advises stopping), «خلصت» (finished).
- Visible on the web account page too (`/medications/cabinet`), same data.

### 2.3 Personal schedule
- Asked once, in words: «بتصحى الساعة كام؟ وبتتغدى إمتى؟ وبتنام إمتى؟» → profile routine (wake, lunch,
  dinner, sleep). `rx-schedule.ts` slots are then **anchored** to the routine (morning dose at wake + 30 min,
  «قبل الأكل» 30 min before the meal, bedtime 30 min before sleep), still labelled «مواعيد مقترحة».
- Conflicts surfaced, never resolved by us: two medicines whose leaflet timing differs are shown as written.
- Output: `schedule` command (today's list), a timetable image card (Typst `card`), the PDF report section and
  the `.ics` file (RX-REPORT §3) — the zero-risk reminder path for everyone.

### 2.4 Reminders that respect the anti-ban rules (opt-in, Decision 86)
- Off by default (`companion.reminders.enabled` false until the owner decides — open question Q4 in phase6).
- Only for a customer who turned them on («فعّل التذكير»), only for asserted lines, max
  `companion.reminders.maxPerDay` (default 6) per chat, merged when doses are within 15 minutes.
- **Window-bound:** a reminder is sent only while the customer's last inbound message is < 24 h old (the same
  guard the bridge enforces). Each reminder asks for a reply: «💊 ميعاد Bepra 20 (قرص قبل العشاء). رد بـ ✓ لما
  تاخده». Replies «✓ / تم / أخدته / 1» log the dose (`dose_events`); «بعدين» snoozes 30 min once. The customer's
  reply keeps the window open, so an engaged patient keeps getting reminders; when they stop replying, reminders
  stop at the window edge, and the next message they send resumes them («رجعت 👋 أكمل التذكيرات؟»).
- Jitter ±2 min, global daily cap `companion.reminders.dailyTotal`, kill switch, per-chat pause, and the
  existing typing delay. Sent by the worker scheduler through `wa_outbox` (never directly).
- Adherence: «التزامك الأسبوع ده 18/21 ✅» on request (`meds` command) — no streak guilt, no medical judgment.

### 2.5 Safety net across prescriptions
On every new analysis, box or manual addition, deterministic checks against the **active** cabinet:
- **Duplicate ingredient** (exact ingredient-set intersection, database) — e.g. two paracetamol products;
- **Same therapeutic category twice** (database category) — shown as «اسأل طبيبك لو الاتنين مقصودين»;
- **Course ending:** «Augmentin خلص النهارده حسب المدة المكتوبة»;
- **Running out:** pack units (`drugs.units_count`) ÷ daily quantity → «العلبة هتخلص تقريبًا الخميس» with the
  database alternatives (same ingredient set, cheapest first, prices «تقريبية») and a reminder to ask the
  pharmacist before switching.
No drug–drug interaction checking (no licensed interaction database; Decision 70 stands).

## 3. Voice briefing (optional, uses the existing ElevenLabs integration)
«اشرحلي بالصوت» → a ≤ 60 s voice note in Egyptian Arabic built from the deterministic plan text (names, times,
meals, duration, the disclaimer). Valuable for older patients and people who prefer listening. Character caps as
today (`waAgent.voice.dailyCharCap`).

## 4. Data, privacy, consent
- Tables (migration): `med_courses`, `dose_events` (course, slot time, outcome `taken | snoozed | missed`,
  answered_at), `user_routines` (wake, meals, sleep, timezone), `companion_consents` (user, scope `cabinet |
  reminders`, granted_at, revoked_at, text version). All owner-scoped (AGENT §5.4, `scopedRepo`), deleted with
  the account, exported with the account data.
- Health data: same protection level as rx results; admin access only through audited user-360 views with the
  existing permission; never sent to analytics or ad destinations (TRACKING rules).
- Consent texts drafted for legal review (owner prerequisite); revocation by «وقف التذكير», «امسح خزانتي» or
  the web page.

## 5. Settings (`site_settings` key `companion`, admin-only)
`enabled` (false) · `cabinet.enabled` · `dispenseCheck: { enabled, credits, maxBoxesPerCall }` ·
`routine.enabled` · `reminders: { enabled (false), maxPerDay, dailyTotal, snoozeMinutes, quietHours }` ·
`runningOut: { enabled, daysBefore }` · `voiceBriefing.enabled`. Model route: task `rx_box` (vision).

## 6. Measures (tracked in the admin agent dashboard)
Dispense checks per week and the share flagged (⚠️/⛔) — the "saves" counter; cabinet opt-in rate after an
analysis; reminder opt-in and dose confirmation rate; 30-day retention of Companion users vs others; conversion
of Companion users to paid plans. Targets are set after four weeks of data (no invented numbers).

## 7. Tests
Dispense matrix (5 outcomes × barcode/text paths × tier of the rx line); routine anchoring table tests;
reminder scheduler against the window rule (no send at 24 h + 1 s; resume after inbound); dose reply parsing
(property tests on Arabic variants); running-out arithmetic with packs and fractional doses; consent gating
(no course or reminder without a consent row); scenario transcripts for the full journey (analysis → consent →
routine → reminder → ✓ → box photo → ⚠️).
