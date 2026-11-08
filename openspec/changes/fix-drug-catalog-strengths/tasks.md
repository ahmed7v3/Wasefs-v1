# Tasks

## 1. Reproduce (red)

- [ ] 1.1 [builder] Unit tests in packages/shared: "10.000 i.u." → 10,000 IU, "10.000 mcg" → 10,000 mcg,
      "10 000 iu" → 10,000 IU fail today; "3.125 mg", "2.275 mg/ml", "96.805 %", "0.5 mg" stay decimals.
- [ ] 1.2 Verify — [runner] the new tests fail for the stated reason; paste output.

## 2. Parser fix (D1)

- [ ] 2.1 [builder] Unit-dependent thousands rule in `findStrengths`; importer picks it up unchanged.
- [ ] 2.2 Verify — [runner] `pnpm --filter @wasfa/shared test`, worker drug-import tests, db drug-matcher tests.

## 3. Repair job (D2)

- [ ] 3.1 [builder] `drugs.repairStrengths` worker job (dry run default, counts-only logs, review list),
      admin trigger + audit following the existing admin drug tools; int test on Postgres.
- [ ] 3.2 Verify — [runner] worker + api tests for the job and trigger.

## 4. Production

- [ ] 4.1 [main] Dry run in production, review counts with the owner, real run, verify the 24 rows
      (e.g. DIXVIT 10.000 → 10,000 IU) and Vedocard 3.125 mg unchanged.
- [ ] 4.2 Verify — [runner] `openspec validate fix-drug-catalog-strengths --strict`, full typecheck and tests.
