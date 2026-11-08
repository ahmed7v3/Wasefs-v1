# Tasks

## 1. Reproduce (red)

- [x] 1.1 [builder] Unit tests that fail now: a fuzzy match becomes `chosen` (D1); "Averocoxib 200" with a
      30/60/90/120 family is shown without a flag (D2); a once-daily «قبل الأكل» line gets a bedtime slot,
      and «شهر» or a missing duration yields 30 days without a written duration (D4/D5).
- [x] 1.2 Verify — [runner] the red tests fail for the stated reasons; paste the output.

## 2. Matching and suggestions (D1)

- [x] 2.1 [builder] Candidate generation runs whenever medications are enabled; `drug-decision.ts` answers
      only on an exact normalized brand or alias match; other candidates become suggestions (max 3).
- [x] 2.2 Verify — [runner] `pnpm --filter @wasfa/shared test`, `pnpm --filter @wasfa/worker exec vitest run test/rx-pipeline.units.test.ts`.

## 3. Strength validation (D2)

- [x] 3.1 [builder] `rx-strength.ts` `strengthCheck` + ingredient-family strengths query + `flags.strength`
      in the result schema (optional) + renderer texts (web table, WhatsApp summary, PDF; i18n ar/en).
- [x] 3.2 Verify — [runner] shared/worker/api unit tests + typecheck.

## 4. Verify re-read of strength and directions (D2, D3)

- [x] 4.1 [main] Final wording of the verify prompt addition and the answer schema fields.
- [x] 4.2 [builder] `pickForVerification` scope, `verifyMessages` reread requests, answer schema, apply logic,
      `flags.directions` rendering.
- [x] 4.3 Verify — [runner] worker unit tests + typecheck.

## 5. Duration and times (D4, D5)

- [x] 5.1 [builder] `quantity` on the extract schema + skill line; `rx-schedule.ts` calculated days and the
      «محسوبة» label; meal-driven slot test; no other source of days.
- [x] 5.2 Verify — [runner] `pnpm --filter @wasfa/shared test` + worker document tests.

## 6. Corpus and rollout

- [ ] 6.1 [main] Re-record the corpus on production data (prompt changed) in `hybrid` mode with the new rules,
      `--extract-model` = the live route; compare against the baseline; set a new baseline with a reason.
- [ ] 6.2 [main] Owner switches `medications.mode` to `hybrid` after reviewing the corpus report; owner re-tests
      rx-001 on web and WhatsApp.
- [ ] 6.3 Verify — [runner] `openspec validate rx-database-grounding --strict`, full typecheck, `pnpm test`,
      `test:rx-regression`.

## 7. Second readings, form-fit suggestions, multi-sample corpus (owner 2026-11-06)

- [x] 7.1 [builder] Verify `kind: "other"` keeps the first name; `flags.name = { first, reread }` rendered as
      «قراءة ثانية: …» (web, WhatsApp, PDF); an exact-brand re-read is also offered as a suggestion.
- [x] 7.2 [builder] Suggestions filtered by form class (oral solid / oral liquid / topical / injection /
      eye-ear / inhaled / rectal-vaginal); unknown line form → no filter.
- [x] 7.3 [builder] `rx:corpus:record --samples N` (default 3); recordings hold samples; replay runs every
      sample; report and gate use per-case means; baseline schema updated.
- [x] 7.4 Verify — [runner] worker/shared/api/ui tests + typecheck; `test:rx-regression` units.
- [ ] 7.5 [main] Re-record ai_only and hybrid, 3 samples each, on production data; compare; owner decides the
      `medications.mode` switch (replaces 6.1/6.2 evidence).
- [x] 7.6 [main] Found during 7.5: a failing `rx_verify` call failed the whole analysis, and the live
      `rx_extract` route had `search: true`. Verify failure now degrades to first readings (rx.trace counts
      it); the router forces search off for `rx_extract` and `rx_verify`.
