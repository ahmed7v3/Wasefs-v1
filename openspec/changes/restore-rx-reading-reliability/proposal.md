## Why

Prescription reading has regressed on both surfaces, and worst on WhatsApp: sharp photos that used to read are
now answered with «الصورة مش واضحة» (unreadable image) or come back with poor lines. It keeps recurring
because nothing stops it: the gold set, replay recordings and `rx:gate` release gate described in
docs/RX-ENGINE.md §8–9 were never built, so any change to the media pipeline, prompts or WhatsApp runtime can
silently break reading. This change restores reading and adds the regression net so it stays fixed.

## Evidence (2026-11-06 code read; hypotheses, not yet proven)

1. **Any rejected upload becomes "unclear image".** `apps/api/src/wa-agent/commerce/agent-rx.service.ts:126`
   and `:243` map every file-pipeline `rejected` status to `unreadable_image`, whatever the real reason.
2. **Strict MIME equality rejects valid photos.** `apps/worker/src/images/process-image.ts:49` rejects a file
   when the declared MIME differs from the detected one (`type_mismatch`). WhatsApp often labels media
   inaccurately, so a perfectly sharp photo can be rejected and reported as unclear (via item 1). Multi-page
   PDFs (`pdf.ts:58`) and HEIC decode failures (`heic.ts`) reach the same text.
3. **The verify step can erase a successful reading.** In `apps/worker/src/rx/pipeline.ts:246-306`
   (`applyVerification`), an `unreadable` verdict, or a candidate id the model was not offered, marks the
   line `unreadable`, and `isReadable` (`:318`) then ignores the raw text the read step already extracted. If
   every line goes that way, `job.ts:152` refunds the analysis and the customer is told the image was
   unclear, breaking the owner rule "deliver every line that was read".
4. **Timing.** The symptom appeared after the Phase 6 runtime work (commits `f2b2536`…`22e79e1`, including
   `680e99c` typed failure reasons). `0dc3016`/`9054116` are the last commits the owner reports as
   reading well. Unverified: needs a bisect with the owner's real samples.

Unproven: how much of the accuracy drop on *readable* results comes from prompt or model-route changes
rather than items 1–3. The diagnosis tasks settle this before any prompt or model is touched.

## What Changes

- **Regression corpus and gate (new):** a de-identified set of the owner's real prescriptions (including the
  ones that now fail) with expected lines, recorded model responses, and a deterministic replay test that runs
  in CI at zero provider cost, plus an on-demand live run. A reading that passed must keep passing.
- **Diagnosis first:** reproduce each symptom as a red test or corpus case; bisect between the last known-good
  commit and HEAD with the corpus; record per-stage outcome counts (no content) to localize the loss.
- **Partial results always delivered:** a verify verdict can lower a line's certainty, never delete what the
  read step extracted. The "unreadable image" outcome is only for analyses where nothing at all was read.
- **Truthful intake failures:** a file rejected for type, size, decode or page-count reasons reaches the
  customer with that reason (e.g. "send it again as a photo"), never as "image unclear".
- **Tolerant MIME handling:** content detected as a supported image type is processed, even if the declared
  MIME label differs. Magic-byte checks still block unsupported content.

## Capabilities

### New Capabilities
- `rx/reading-regression-gate`: the owner-verified prescription corpus, replay of recorded model responses,
  and the rule that rx changes may not reduce corpus results.

### Modified Capabilities
- `rx/prescription-reading`: adds "partial results are always delivered" and "unreadable only when nothing
  was read".
- `rx/failure-reasons`: the unreadable-image reason is reserved for images that were decoded and read.
- `wa-agent/media-intake`: a supported image is not rejected for a wrong MIME label; rejection reasons reach
  the customer truthfully.

## Out of scope

- Building the RX-ENGINE v2 stages (quality gate, fusion, zoom v2, adjudication, calibration).
- Changing model providers, routes or prompts, unless the diagnosis proves a prompt/model regression. That
  would be a follow-up change with its own corpus evidence.
- WhatsApp commands, sessions, commerce and voice.
- Re-labelling a 400-image gold set; the corpus starts with the owner's real cases and grows.

## Impact

- Code: `apps/worker/src/rx/pipeline.ts`, `rx/job.ts`, `rx/failure.ts`, `apps/worker/src/images/process-image.ts`,
  `apps/api/src/wa-agent/commerce/agent-rx.service.ts`, `apps/api/src/wa-agent/outbox/wa-outbox.repo.ts`,
  `packages/shared/src/i18n/*messaging.ts`, new `apps/worker/test/rx-regression/*`.
- Data: corpus images stay out of git if they contain any personal data (stored de-identified; see design).
- Surfaces: web and WhatsApp (shared engine). No schema migration expected.
- Docs: docs/RX-ENGINE.md §8–9 gets a status note pointing to the regression-gate spec.
