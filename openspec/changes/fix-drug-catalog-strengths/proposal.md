## Why

The catalog importer reads a dot followed by three digits as a decimal point, so European-style thousands
are stored 1000× too small: "DIXVIT 10.000 I.U." is stored as **10 IU** and "Vee biotin 10.000 mcg" as
**10 mcg**. Every consumer reads these values: strength matching, the new strength check (a correct
"10,000" reading could be flagged as impossible), the WhatsApp `lookup_medication` tool and search cards.

Production evidence (2026-11-06, read-only): 33 of 32,751 products have an `N.DDD` strength:
- **IU 20, mcg 4**: all thousands separators (vitamin D3 10.000 IU, biotin 10.000 mcg), stored wrong.
- **mg 7, % 1, g 1**: genuine decimals, stored right (Vedocard **3.125 mg** carvedilol, Finjuve 2.275 mg/ml,
  Barilux 96.805 %).

A blanket "dot = thousands" rule would break carvedilol 3.125 mg, so the fix must depend on the unit.

## What Changes

- Strength parsing (`packages/shared/src/normalize.ts`, `parseStrength`): for **IU and mcg**, `N.DDD` with
  N in 1..999 is a thousands separator (10.000 IU = 10,000 IU). For every other unit, it stays a decimal.
  Also accepted: a space thousands separator ("10 000 IU"), as in "D life 10 000 i.u.".
- A one-off, idempotent data repair recomputes `strength_value_micro` for affected rows from their
  `strength_text` and logs a before/after count (no names in logs), plus the same fix in future imports.
- Ambiguous rows (any unit other than IU/mcg with `N.DDD` whose value × 1000 also exists in the same brand
  family) go to an admin review list instead of being changed.

## Capabilities

### New Capabilities
- `drugs/catalog-strengths`: how catalog strength texts become comparable values, including thousands
  separators, and how corrections to existing rows are made.

### Modified Capabilities
- (none)

## Out of scope

- Other catalog data-quality issues (forms, duplicates, prices).
- The prescription reading pipeline (handled in rx-database-grounding).

## Impact

- `packages/shared/src/normalize.ts` (shared by import, matcher and the reading pipeline: one rule
  everywhere), `apps/worker/src/jobs/drug-import.plan.ts`, a migration or admin-run repair job for
  existing rows, tests. Production rows: about 24 corrected; reviewable list for the rest.
