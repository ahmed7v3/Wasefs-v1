## Context

The reading pipeline is v1 (`apps/worker/src/rx/*`: read → match → verify → finalize) plus Phase 6 runtime
work on WhatsApp. docs/RX-ENGINE.md v2 stages (S0 quality gate, fusion, adjudication, calibration, gold set,
replay, `rx:gate`) are not built. The only eval tooling is `apps/worker/src/eval/*` (template/import/run)
and the scorer in `packages/shared/src/evals.ts`. The AI package already has a fake adapter
(`packages/ai/src/adapters/fake.ts`), which is the natural seam for replay.

Three code paths can turn a good photo into «الصورة مش واضحة» (proposal, Evidence 1–3). None is proven
against real samples yet, so the design puts measurement first and keeps every fix small and separately
revertible.

## Goals / Non-Goals

**Goals:** reproduce the owner's failing cases; fix the three known paths; make regressions in reading
impossible to merge unnoticed; keep cost flat (no extra model calls).

**Non-Goals:** v2 engine stages; model/provider/prompt changes (only if the diagnosis proves one, in a
follow-up change); UI redesign of results.

## Decisions

### D1 Corpus layout and privacy (protects AGENT §5.7, spec rx/reading-regression-gate)
- Committed: `apps/worker/test/rx-regression/corpus.json`: per case `id`, `sha256`, `surface`
  (web|whatsapp), `declaredMime`, `stratum`, expected lines (`name` + `acceptable[]` brand keys/raw
  spellings, `strength`, `dose`, `frequency`, `duration`, `form`), `notes` (no personal data).
- Committed: `recordings/<caseId>/<task>-<n>.json`, the raw model responses (drug text only,
  de-identified), with the prompt hash and model route they were recorded against.
- **Not committed:** images. They are stored in the existing private bucket under `rx-corpus/<sha256>` and
  fetched into gitignored `.rx-corpus/` by `pnpm --filter @wasfa/worker rx:corpus:pull`. CI uses a read-only
  key; when the key is absent (fork PRs) the job **fails with "corpus unavailable"**, never passes silently.
- Images are de-identified by the owner before upload (masking names/phones), as in RX-ENGINE §8.

### D2 Replay at the model-adapter boundary
- Replay mode swaps the provider adapter for a recording adapter built on `fake.ts`: responses are keyed by
  `(caseId, task, callIndex)` and checked against the stored prompt hash. A prompt-hash mismatch fails the
  run with "prompt changed: re-record" (spec: prompt and model changes re-record).
- Everything else runs for real: image decode, MIME handling, crops, matcher against a seeded test DB,
  verification application, finalize, failure mapping, and the WhatsApp decline/failure text selection.
- Live mode (`rx:corpus:record`, admin/owner-run, paid) runs the real routes and writes new recordings.

### D3 Scoring and the gate
- Reuse `packages/shared/src/evals.ts` scoring and `isEvalRegression`. Per case: `refused` (bool), per
  expected line `nameOk` (result name or raw reading ∈ acceptable), `numbersOk`, `formOk`.
- `apps/worker/test/rx-regression/baseline.json` is committed. The gate fails if any case passing in the
  baseline now fails or the share of correct lines drops. The baseline only changes through
  `rx:corpus:baseline` inside a change that explains why.
- Wired as `pnpm --filter @wasfa/worker test:rx-regression` and a CI job.

### D4 Partial results (spec rx/prescription-reading)
- The delivered-vs-refunded decision (`job.ts:152`) depends only on **extracted text**: a line counts as
  read when its extracted name or raw text is non-empty, whatever the verify verdict.
- `applyVerification` keeps `verified = "unreadable"` as the verdict but never clears the extracted text;
  an unoffered id is handled the same way. No schema change.
- The renderers (web result, WhatsApp summary, PDF) must show an `unreadable`-verdict line that has text as
  the raw reading plus the unsure flag. A scout task confirms what each renderer does today. Any renderer
  that hides such lines is fixed in this change.
- Billing: a delivered partial result is charged as a delivered result (owner rule; AGENT §5.5 unchanged:
  ledger only).

### D5 Truthful rejection reasons (specs rx/failure-reasons, wa-agent/media-intake)
- The file-processing wait in `agent-rx.service.ts` must return the stored reject reason, not just
  `rejected`. Map: `unsupported_type`/`type_mismatch` → decline `file_unsupported`; `corrupt_image` →
  `file_corrupt`; `pdf_multi_page_unsupported` → `pdf_multi_page`; `pdf_unreadable` → `file_corrupt`;
  size limits → `file_too_large`. `unreadable_image` is no longer produced on this path.
- Each new decline gets ar/en i18n texts (Egyptian dialect, with a concrete next step) in
  `packages/shared/src/i18n/*messaging.ts`, and a model-facing explanation in the tool outcome.
- `wa-outbox.repo.ts` SQL keeps its mapping: with D4, `refunded` now really means nothing was read.

### D6 Content decides the type (spec wa-agent/media-intake)
- `process-image.ts`: when the detected (magic-byte) type is decodable and allowed for the purpose but
  differs from the declared MIME, process it as the detected type, store the detected MIME, and log the
  code `type_relabelled` (no content). Undetected or non-allowed content is still rejected.
- Safety: output is always re-encoded by sharp to JPEG under our own key, pixel limits stay, and the
  declared MIME is never trusted for serving, so this does not widen the attack surface. SECURITY.md is
  checked for any rule depending on `type_mismatch`.

### D7 Diagnosis instrumentation (AGENT §5.7)
- Per analysis, one structured log/trace record with counts only: pages, lines extracted, lines with text,
  verify verdicts by kind, unoffered-id count, final status and reason, reject reason. These counts let a
  live failure be localized to a stage without reading content.
- Bisect: with the corpus pulled, run the live corpus on `0dc3016` (last reported good) and HEAD in
  separate worktrees. If the live results differ beyond D4–D6, bisect the commits in between. Cost: about
  (cases × steps) analyses, approved by the owner before running.

## Risks / Trade-offs

- **Corpus too small to show accuracy drift** → it starts with the owner's failing cases plus ~20 that read
  well, and grows with every reported misreading (spec requirement). Coverage claims stay modest until it grows.
- **The real cause is a prompt/model change** → D7 bisect detects it. The fix is then a follow-up change with
  re-recorded corpus evidence, not a blind prompt edit here.
- **Showing raw text for lines verify judged unreadable can surface garbage** → the line is always flagged
  unsure and never gets a database name (spec rx/drug-name-resolution). The owner prefers an honest uncertain
  reading over a refusal.
- **Relabelling MIME hides upstream bugs** → the `type_relabelled` counter keeps them visible.

## Migration Plan

No schema migration. Deploy fixes behind no flag (they restore intended behavior). Rollback = revert the
commit for the specific fix (D4, D5 and D6 land as separate commits).

## Open Questions

- Which exact prescriptions did the owner test (web + WhatsApp) and which commit or date read them well?
  Needed for the first corpus cases.
- Does the CI environment have (or may it get) a read-only key to the private bucket for corpus images?

## Implementation notes (apply, 2026-11-06)

- 2.3 renderers: web `RxTable`, WhatsApp `rx_done` parts and the PDF already show an unreadable-verdict line
  with its raw text and the "uncertain" flag. The only loss point is the refund gate `job.ts:152`
  (`isReadable`). Task 3.2 needs no renderer change.
- 5.1 security: SECURITY.md:60 requires the magic-byte check, which D6 keeps. Processed files are always
  stored as `image/jpeg`, so D6 stores no MIME. `files.service.status()` already exposes `rejectReason`.
- 4.1 decline reasons: `file_unsupported | file_corrupt | pdf_multi_page | file_too_large`, each with a
  deterministic `say` text (i18n `whatsapp.agent.rxDecline.*`). Before this, the raw `unreadable_image` code
  went to the model, which improvised «الصورة مش واضحة» (breaks WA-AGENT-RUNTIME I5).
- Found, out of scope: `analyze_prescription` still takes no arguments and only sees images from the last
  15 minutes (WA-AGENT-RUNTIME R1/R3, attachment registry never built). Candidate follow-up change.

## Diagnosis results (2026-11-06, production data, counts only)

**Primary cause of the outage: route configuration, not code.**
- 2026-11-01 19:19–19:21 UTC: the `rx_extract` route (fast/balanced/deep, all plans) was switched to a
  single model, `google/gemini-4-argon` on the new `vercel` provider, with no fallback.
- Every call since then fails with provider `auth` 403. `ai_usage`: 46 errors, 0 ok. `rx_analyses`:
  2026-11-02..06 → 20 failed, 0 done; before → mostly done. On WhatsApp every reading ended in a failure
  text, the "it can't read anything" symptom.
- The same corpus recorded on the previous model, `gemini-4-argon` on `ometap` (kimi-k3.1-pro on `ometap`
  as fallback), reads normally: rx-002 3/3, rx-003 4/5, cost ≈ USD 0.03.
- Fix (owner action; a direct DB write from the session was not permitted): set the `rx_extract` route
  to `ometap/gemini-4-argon` → `ometap/kimi-k3.1-pro` in Admin → AI → Routes for fast, balanced and deep.

**Secondary: accuracy limits under the current settings.**
- Production runs `medications.mode = "ai_only"` and `rx.drugMatching = false`, so no database matching
  or verify step runs. One-letter misreads stay (rx-001: "Avirocoxib/Motirolin/Dixivit" for
  Averocoxib/Metapsin/Dixvit; rx-003: "Gabimash" for Gabimedra), although every one of these brands is
  in the database. Turning matching back on is an owner decision (owner rule: never substitute); measure
  it on the corpus first (record with `medications.mode = hybrid`).

**Code defects fixed in this change:** D4 verify veto → refund, D5 raw `unreadable_image` to the model,
D6 MIME label rejection. None of them caused the 2026-11-02 outage. They are why some readings were
refused or answered "unclear" before and around it.

**Bisect vs `0dc3016`:** not needed. The outage starts at a configuration change, with no deploy at that
time, and the old route reads the corpus correctly.
