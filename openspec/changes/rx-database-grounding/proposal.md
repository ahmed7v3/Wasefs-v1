## Why

The route fix (restore-rx-reading-reliability) brought readings back. On the owner's 2026-11-06 production
check of rx-001, the remaining errors are clinical:
- an impossible strength printed as fact (Averocoxib **200**; only 30/60/90/120 mg exist);
- an invented brand (**Mnteplia plus** for Metapsin plus, a product in the database);
- wrong directions (**before bedtime** for «قبل الأكل», which voids a proteolytic enzyme);
- a default **30-day** duration although the paper says one pack of 20 tablets (5 a week → 4 weeks).

The causes are known. Production runs `medications.mode = ai_only`, so no read name or strength is ever
checked against the database. The verify step never re-reads numbers or directions. A free-text
duration such as «شهر» becomes 30 days, while a written pack count is ignored.

## Owner decisions (2026-11-06)

1. **Names: suggestion only.** The reading as written stays the line's name. A close database brand is
   shown as «تقصد X؟», never as the answer, unless the reading equals the brand exactly.
2. **Strength: re-read, then flag.** An impossible strength triggers a zoom re-read. If it is still
   impossible, the line shows «راجع التركيز — المتاح: …» and the impossible number is never shown as
   certain. A dose is never replaced.
3. **Timing: what is written.** Suggested times follow the prescription's own timing words. Without
   any, the existing default convention applies (or no time). No per-drug timing table.
4. **Duration from the pack** (from the owner's feedback): when the paper gives a quantity and the
   frequency is read, the duration is calculated and labelled as calculated.

## What Changes

- Database grounding runs again on every reading (candidates, suggestions, strength families), without
  ever replacing what was read (decision 1).
- Strength validation against the strengths that exist for the suggested brand family or its active
  ingredient, with a re-read inside the existing batched verify call (decision 2).
- The verify call also re-reads directions (meal relation, bedtime) on lines whose legibility is not
  `clear`. A disagreement flags the line and keeps both readings visible; nothing is silently overwritten.
- Duration: a «شهر»-type default is shown only when written. A written pack quantity plus frequency gives
  a calculated duration, labelled as such. The PDF and WhatsApp timetable show only what was written or
  calculated.
- The corpus grows with rx-001's production misreads as expected lines (already updated).

## Capabilities

### New Capabilities
- (none)

### Modified Capabilities
- `rx/drug-name-resolution`: the database name is the answer only on an exact match; close brands are
  suggestions; strength validation with flagging.
- `rx/prescription-reading`: directions re-read and conflict flag; duration only when written or
  calculated from the written pack; schedule times follow written timing.

## Out of scope

- Per-drug or per-category timing rules (owner declined).
- Auto-correcting names or strengths.
- Turning database names into answers on fuzzy matches.
- RX-ENGINE v2 fusion, adjudication and calibration.

## Impact

- `packages/shared/src/drug-decision.ts`, `packages/db/src/drug-matcher.ts` (strength families),
  `apps/worker/src/rx/{analyze,pipeline,prompts}.ts` (verify re-read scope),
  `packages/shared/src/rx-schedule.ts` + `rx-normalize.ts` (duration), renderers' flag texts (i18n).
- The verify prompt changes, so the corpus must be re-recorded (spec rx/reading-regression-gate).
  Cost: no extra model call (the same batched verify call); verify now runs on more analyses.
- Settings: production `medications.mode` moves from `ai_only` to `hybrid` under the new
  suggestion-only semantics, an admin change made after the corpus shows no regression.
