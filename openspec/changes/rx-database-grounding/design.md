## Context

Pipeline today (apps/worker/src/rx/analyze.ts): read (`rx_extract`) → match only when
`medications.enabled && mode === "hybrid"` (production is `ai_only`, so never) → verify (`rx_verify`,
names only, database mode only) → finalize. `packages/shared/src/rx-schedule.ts` turns frequency and
duration text into slots: «شهر» → 30 days, once a day → 08:00. The rx-001 production misreads are corpus
expected lines (apps/worker/rx-regression/corpus.json).

## Goals / Non-Goals

**Goals:** catch impossible strengths, out-of-vocabulary names and direction misreads using the database
and one re-read, without ever substituting (owner decisions 1–4 in proposal.md). No extra model call.

**Non-Goals:** fuzzy-match answers, per-drug timing, v2 fusion/calibration.

## Decisions

### D1 Matching always runs; answers only on exact match (rx/drug-name-resolution)
- Remove the `mode === "hybrid"` gate on *candidate generation*: `matchItems` runs whenever
  `medications.enabled`. The *answer* rule moves into `drug-decision.ts`. `chosen` is set only when the
  normalized reading equals the brand key (or a learned or admin alias). Every other candidate becomes a
  suggestion (max 3) and the line's name stays the reading.
- `medications.mode` keeps its meaning for the admin, with `ai_only` = no suggestions shown, but the
  strength and directions checks (D2, D3) run in both modes. Protects AGENT §5.11 and the owner rule
  "never substitute".

### D2 Strength validation (owner decision 2)
- New pure `strengthCheck(line, family)` in `packages/shared/src/rx-strength.ts`. `family` = the strengths
  of the top-3 candidates' brand keys, plus the strengths of products sharing their active ingredient.
  `drug-matcher.ts` returns `strengthText` + `strengthValueMicro` per candidate already; a small query adds
  the ingredient-family strengths.
- Outcome `ok | impossible | unknown`. `impossible` → the line goes to verify with a `reread: ["strength"]`
  request. After verify: still impossible → `item.flags.strength = { read, available[] }`; the renderers
  show «راجع التركيز — المتاح: …» and never show the read strength without the flag.

### D3 Directions re-read (rx/prescription-reading)
- `pickForVerification` also selects lines with legibility `partial | unclear` (capped by
  `verifyMaxItems`). The verify request per line gains `reread: ("strength" | "directions")[]`. The answer
  schema gains optional `strength` and `directions { meal, bedtime }` per line. This is a prompt change to
  `verifyMessages` plus a schema addition, so it needs a corpus re-record.
- Disagreement → `item.flags.directions = { first, reread }`. Both are shown and none is chosen. Agreement
  → no flag.

### D4 Duration (rx/prescription-reading)
- The read step already returns `duration` text. Add optional `quantity` (`{ count, unit }`) to the
  extract item schema and a skill line telling the model to transcribe a written pack or tablet count.
- `rx-schedule.ts`: `days` from written duration as today. If none is written, `quantity` and a
  doses-per-week figure from the frequency give `calculatedDays` (`ceil(count / perWeek) * 7` for weekly
  patterns, `ceil(count / perDay)` for daily), labelled «محسوبة من ٢٠ قرص». No other source of days.
  A «شهر» that the model invented without it being written cannot be told apart from a written one; the
  corpus (rx-001) measures it.

### D5 Times (owner decision 3)
- `rx-schedule.ts` already places slots from meal and bedtime words. The change makes sure `meal` drives
  the slot ("before" → 30 minutes before the convention's meal times), which a test pins. No new table.

## Risks / Trade-offs

- **Suggestion-only leaves non-existent names visible** (owner's choice). Mitigated by the unsure flag and
  «تقصد X؟».
- **More verify calls (cost)** → still one batched call per analysis. `verifyMaxItems` caps it. The
  corpus run reports the cost.
- **Strength families for combination products** (e.g. 10,000 IU vitamin D) → units are compared
  normalized (mg, IU, mcg). Unknown units give `unknown`, never `impossible`.

## Migration Plan

Code first (flags render only when present), re-record the corpus, compare against the baseline, then the
owner switches `medications.mode` to `hybrid` in the admin. Rollback = mode back to `ai_only`.

## Open Questions

- None blocking; the owner decisions are recorded in proposal.md.

## Implementation notes (apply, 2026-11-06)

- Verify `kind: "candidate"` (found during apply): it made the picked product the line's answer, which
  would still be a substitution under decision 1. Now an exact-match pick may become the answer. Any
  other pick becomes the first suggestion, and the line keeps its read name.
- 4.1 verify wording: items may carry `Re-read: strength, directions`. Instruction: "For strength, write
  the number and unit exactly as written on the paper, or null if you cannot read it; never take a
  strength from a candidate. For directions, give meal: before | after | with | empty_stomach | none and
  bedtime: true | false, exactly as written." Answer variants gain optional `strength` and `directions`.
