# Tasks

## 1. Corpus and replay harness (the regression net comes first)

- [x] 1.1 [main] Collect the owner's failing and known-good prescriptions (web + WhatsApp, including the
      original WhatsApp media bytes and declared MIME); confirm de-identification; write expected lines.
- [x] 1.2 [builder] Corpus manifest schema + `rx:corpus:pull` (private bucket `rx-corpus/` → gitignored
      `.rx-corpus/`) per design D1; add `.rx-corpus/` to `.gitignore`.
- [x] 1.3 [builder] Recording adapter on `packages/ai/src/adapters/fake.ts` + `rx:corpus:record` (live, paid)
      and replay mode with prompt-hash check (D2).
- [ ] 1.4 [builder] Scorer + `baseline.json` + `test:rx-regression` reusing `packages/shared/src/evals.ts`
      (D3); CI job that fails on "corpus unavailable".
- [x] 1.5 [main] Owner-approved live recording of the corpus on HEAD; commit recordings and the (failing)
      baseline report.
- [x] 1.6 Verify — [runner] `pnpm --filter @wasfa/worker typecheck && pnpm --filter @wasfa/worker test:rx-regression`
      replays deterministically twice with identical results and makes zero provider calls.

## 2. Reproduce (red) and diagnose

- [x] 2.1 [builder] Red unit tests: rejected `type_mismatch` WebP-as-JPEG → customer sees unclear-image
      (`process-image.ts:49` + `agent-rx.service.ts:126/243`); verify `unreadable` on every read line → refund
      (`pipeline.ts` + `job.ts:152`); multi-page PDF → unclear-image text.
- [x] 2.2 [builder] Count-only per-analysis trace record (D7); no content in logs.
- [x] 2.3 [scout] Report how the web result, WhatsApp summary and PDF render a line with
      `verified = "unreadable"` that has raw text (file:line per renderer).
- [x] 2.4 [main] Owner-approved live bisect `0dc3016` vs HEAD on the corpus (D7); record findings in this
      change's design.md under a "Diagnosis results" section; open a follow-up change if a prompt/model
      regression is found.
- [x] 2.5 Verify — [runner] the red tests fail for the documented reason; paste the output in the report.

## 3. Fix: partial results always delivered (D4)

- [x] 3.1 [builder] Delivered-vs-refunded depends on extracted text only; `applyVerification` never discards
      extracted text (verdict `unreadable` and unoffered id).
- [x] 3.2 [builder] Fix every renderer from 2.3 that hides an unreadable-verdict line with text (raw reading +
      unsure flag, never a database name).
- [x] 3.3 Verify — [runner] `pnpm --filter @wasfa/worker test -- rx-pipeline rx.units rx-failure` and
      `test:rx-regression`: red tests from 2.1 for this path are green and there is no corpus regression.

## 4. Fix: truthful rejection reasons (D5)

- [x] 4.1 [main] Final decline reason names and the ar/en texts (Egyptian dialect, concrete next step).
- [x] 4.2 [builder] File-processing wait returns the reject reason; map it per D5 in `agent-rx.service.ts` (both
      call sites); i18n keys; model-facing explanations.
- [x] 4.3 Verify — [runner] `pnpm --filter @wasfa/api typecheck && pnpm --filter @wasfa/api test -- wa-agent`
      plus the 2.1 PDF/corrupt tests are green.

## 5. Fix: content decides the image type (D6)

- [x] 5.1 [scout] Check docs/SECURITY.md and tests for any rule relying on `type_mismatch`.
- [x] 5.2 [builder] `process-image.ts`: process allowed detected types under the detected MIME, store it, log
      `type_relabelled`; non-allowed content still rejected.
- [x] 5.3 Verify — [runner] `pnpm --filter @wasfa/worker test -- images` + `test:rx-regression` green;
      WebP-as-JPEG corpus case now reads.

## 6. Close-out

- [ ] 6.1 [main] Review the full diff against the specs and docs/AGENT.md §8; re-record the corpus live
      only if a prompt changed (none expected).
- [x] 6.2 [runner] Add a status note to docs/RX-ENGINE.md §8–9 pointing to `openspec/specs/rx/reading-regression-gate`.
- [ ] 6.3 [main] Owner re-tests the original prescriptions on web and WhatsApp in production; record outcome.
- [ ] 6.4 Verify — [runner] `openspec validate restore-rx-reading-reliability --strict`, full `pnpm typecheck`,
      `pnpm test`, `test:rx-regression`.
