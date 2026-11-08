## Context

`parseStrength` (packages/shared/src/normalize.ts:127) → `findStrengths(prepare(text))` treats "." as a
decimal point. The importer (apps/worker/src/jobs/drug-import.plan.ts:104) stores
`strengthMicro(parsed.strength.value)`. The same parser serves the matcher, the reading pipeline
(rx-strength) and search, so a fix in one place applies everywhere.

## Decisions

### D1 Unit-dependent thousands rule (in `findStrengths`)
- After a number and its unit are found: if unit ∈ {iu, mcg} and the number text matches
  `^[1-9]\d{0,2}\.\d{3}$`, the value is the number with the dot removed.
- A space thousands form `^[1-9]\d{0,2} \d{3}$` directly followed by a unit is joined first, for every
  unit (no decimal reading of a space exists).
- Everything else is unchanged. Rationale: the production evidence (20 IU and 4 mcg rows, all thousands;
  7 mg, 1 %, 1 g rows, all genuine decimals such as carvedilol 3.125 mg).

### D2 Repair of existing rows
- A worker job `drugs.repairStrengths` (admin-triggered, dry-run by default) recomputes the value from
  `strength_text` for rows matching the `N.DDD` / `N DDD` pattern and updates rows whose value changes.
  It runs in one transaction and logs counts only (AGENT §5.7). Idempotent by construction (recomputing
  from text).
- Review list: rows with a non-IU/mcg unit whose value × 1000 also exists in the same `brand_key` family
  are written to the admin review output (ids only), not changed.
- Admin trigger and audit follow the existing admin drug-tools pattern (find it in
  apps/api/src/admin/drugs/*).

### D3 Downstream
- Snapshot data in apps/worker/rx-regression/snapshot.json comes from production. It is re-taken at the
  next corpus recording after the repair (no manual edit).

## Risks / Trade-offs

- A real "1.000 IU" decimal does not exist in practice (IU are not written with three decimals). If one
  ever appears, it lands on the review path when its family has 1000 IU.
- The pattern misses thousands written with a comma in mg (already handled: "1,000 mg" parses to 1000).

## Migration Plan

Ship the parser fix, then run the repair as a dry run in production, review the counts, then run it for
real. Rollback: the dry-run output lists every changed id with old and new micro values (ids and numbers
only), so a reverse update is possible.
