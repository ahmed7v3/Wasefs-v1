# Rx Engine v2 — prescription reading precision (spec, 2026-10-31)

> **Owner request (2026-10-31):** the highest reading precision possible, for the hardest handwriting and the
> rarest medicines, with a floor of 95 % that never drops, and a drug lookup that uses the database instead of
> guessing. This spec turns that request into an engine design, a measurable contract and a release process.
>
> Builds on what exists (do not rebuild): the pipeline read → match → verify → finalize
> (`apps/worker/src/rx/*`), the matcher and decision (`packages/db/src/drug-matcher.ts`,
> `packages/shared/src/drug-decision.ts`), the sanitizer (`rx-sanitize`), the learning votes
> (`drug-signals.ts`), the eval harness (`apps/worker/src/eval/*`, `packages/shared/src/evals.ts`), the image
> pipeline (`apps/worker/src/images/*`) and the T1 branch `feat/rx-likely-matches` (shape candidates, `likely`).
> Rules: `AGENT.md` §5.2 (zod on every model output), §5.5 (credits), §5.7 (no prescription content in logs),
> §5.9 (thresholds are settings), §5.11 (never fabricate a drug name). `MEDICATIONS.md` §1 principles stand.

---

## 1. The accuracy contract (what "95 % minimum" means, and how it is proven)

No reader, human or machine, reads every scribble. A pharmacist facing an unreadable line does not guess: they
say "I am not sure, it is X or Y" and check. Wasfa does the same, and the contract is built on that:

> **Everything the engine asserts is right at least 95 % of the time, in every difficulty stratum, including
> the hardest handwriting; what it cannot assert at that level it never presents as certain.**

### 1.1 Units and tiers
Every medication line ends in exactly one **tier** (`item.match`):

| Tier | Shown as | Meaning |
|---|---|---|
| `confirmed` | database name, no badge | the evidence identifies the product beyond reasonable doubt |
| `likely` | database name + «مرجّح» | the best-supported database entry; consistent with letters, length, strength, form and context |
| `uncertain` | «راجِع: نرجّح X أو Y» + the line's crop | candidates exist but none clears the `likely` bar; the top 2–3 are offered |
| `ai` | the raw reading + «قراءة آلية» | nothing in the database fits; the letters as read |
| `unreadable` | «غير مقروء» + crop | nothing can be read |

`confirmed` and `likely` are **asserted**. `uncertain`, `ai` and `unreadable` are **flagged**: the user sees
that they must check, with the evidence.

### 1.2 Metrics (computed per stratum on the gold set, §8)
| Metric | Definition | Target |
|---|---|---|
| **CP**: confirmed precision | correct `confirmed` names ÷ `confirmed` lines | ≥ 99 % every stratum |
| **AP**: asserted precision | correct (`confirmed` + `likely`) names ÷ asserted lines | **≥ 95 % every stratum** (hard and very hard included); ≥ 98 % printed |
| **AP-LB** | Wilson 95 % lower bound of AP on the holdout | ≥ 93 % every stratum (guards against a lucky small sample) |
| **SER**: silent error rate | lines shown as asserted with a wrong name ÷ all lines | ≤ 1 % every stratum |
| **Coverage** | asserted lines ÷ all lines | printed ≥ 98 %, clear ≥ 95 %, hard ≥ 85 %, very hard ≥ 65 % |
| **Numbers** | strength, dose, frequency, duration exact on asserted lines | ≥ 98 % |
| **Detection** | gold lines found as items | ≥ 99 % |
| **Top-3 recall** | correct drug among the candidates shown on `uncertain` lines | ≥ 90 % |
| **ECE** | expected calibration error of the final posterior | ≤ 0.03 |
| Latency / cost | p95 end to end; provider cost per analysis | p95 ≤ 60 s; ≤ the admin cap (`rxEngine.maxCostUsdMicros`) |

AP is the 95 % floor. Coverage is what gets better release after release. SER is what protects patients. A
release that improves coverage but breaks AP or SER in any stratum is refused (§9).

---

## 2. Pipeline v2 at a glance

```
upload / WhatsApp media
  │
  ▼  S0 Intake & quality gate  (no model; decode HEIC/PDF, orientation, blur/exposure/size score)
  │     poor → ask for a better photo BEFORE any charge (WhatsApp) / warn + continue (web)
  ▼  S1 Images  read image (2048, as today) + master image (≤ 4096, kept like the rx files)
  ▼  S2 Read     rx_extract — ONE call, all pages (as today) + name boxes, script, prescription header signals
  ▼  S3 Retrieve SQL + TS — union of: trigram (today) · alternatives · shape (T1) · confusion expansion ·
  │              ingredient path · strength family filter  → ≤ 12 candidates per line
  ▼  S4 Fuse     pure TS — log-linear evidence model → posterior per candidate + P(none)
  ▼  S5 Zoom     rx_verify v2 — ONE batched call for every line not ready to confirm:
  │              enhanced high-res crops (name + line) → blind reading FIRST, then choice + confidence,
  │              numbers re-read
  ▼  S6 Fuse again (zoom evidence in) → still contested? (disagreement / thin margin / numbers differ)
  ▼  S7 Adjudicate rx_adjudicate — CONDITIONAL, ONE batched call, different model family, contested lines only
  ▼  S8 Calibrate & tier   isotonic map → tier thresholds per stratum class
  ▼  S9 Field checks       strength exists in family, dose unit ↔ form, frequency plausibility (flags, never fixes)
  ▼  S10 Finalize          result v2 (tier, evidence, crops) → details (text call, as today) → learning signals
```

Model calls per analysis: read 1 + zoom 0–1 + adjudicate 0–1 + details 0–1 → **typical 3, maximum 4**
(today: up to 3). All batched; never one call per line.

---

## 3. Stages in detail

### S0 — Intake and quality gate (`apps/worker/src/images/quality.ts`, new; pure + sharp)
- **Decode:** JPEG, PNG, WebP, PDF (existing rasterizer), and **HEIC/HEIF** (new: `heic-decode` WASM in the
  worker, pixel limit as today; WhatsApp documents from iPhones arrive as HEIC). Magic bytes as today.
- **Orientation:** EXIF (as today) + a 90°-step orientation check: the read call returns `rotation`
  (0/90/180/270) when text runs sideways; the master and crops are rotated by code before S5.
- **Quality score** (on a 1024 px grayscale copy, < 30 ms):
  - sharpness: variance of the Laplacian (3×3 kernel via `sharp.convolve`), normalised by image size;
  - exposure: share of clipped pixels (< 3 % or > 97 % luminance) and mean luminance;
  - resolution: long edge of the original; text height is checked after S2 from the boxes
    (median line box height in px on the master: < 18 px → `small_text`);
  - result: `good | fair | poor` + reasons (`blurry`, `dark`, `glare`, `low_resolution`, `small_text`).
- **Policy (settings `rxEngine.quality`):** `poor` on WhatsApp → the agent asks for a better photo with the
  concrete reason and 3 tips (flat surface, daylight, fill the frame), **before** credits are reserved; the user
  can answer «كمّل كده» to proceed. On the web: a warning with "retake" and "continue". `fair` proceeds and lowers
  the stratum class used for thresholds (§3 S8). Thresholds are settings, fitted on the gold set.

### S1 — Images
- `read` image: as today (long edge 2048, JPEG q88, metadata stripped) — the read call's cost is unchanged.
- **`master` image (new):** long edge ≤ 4096 (never upscaled), JPEG q95, stored next to the processed page
  (`rx_pages.master_key`), same bucket, same retention and deletion as the page (Decision 84). Used only by
  code for crops; never sent whole to a model.
- **Crop enhancement** (`crop.ts` v2): crop from the master with 15 % padding (as today), then
  grayscale → CLAHE (`sharp.clahe({ width: 8, height: 8, maxSlope: 3 })`) → mild unsharp mask → Lanczos
  upscale so the median text height reaches ≥ 40 px (cap 3×, cap 1600 px long edge). Two crops per line:
  **name crop** (`name_box`, padded 30 %) and **line crop** (`box_2d`). Both JPEG q92.

### S2 — Read (`rx_extract`, one call — schema additions only)
Unchanged contract (transcribe, never normalise; `alternatives`, `legibility`, `confidence`, boxes). Additions
to `rxExtractItemSchema` (all optional, so old outputs still parse):
- `name_box`: box of the drug-name word(s) only (0–1000), for the name crop;
- `script`: `latin | arabic | mixed` of the name;
- `letterCountEstimate`: integer 2–30 when the name is partly unreadable (shape evidence);
- page-level `rotation` and `headerSignals`: `{ specialty: string | null, printedLetterhead: boolean }` —
  the clinic specialty from the header («باطنة», «أطفال», «أسنان») is a prior for categories; no names, phones or
  ids are copied (skill rule 9 stands).
The skill (`skills/prescription-analysis/SKILL.md`) gains a short section for these fields and a **handwriting
reading protocol**: read letter by letter; mark each doubtful letter in `alternatives` instead of resolving it
with a brand you know; estimate length when letters are missing.

### S3 — Retrieval (candidate generation, `packages/db/src/rx-retrieval.ts`, new; SQL only)
Union per line, deduplicated by drug, each hit tagged with its source (`via`):
1. **Trigram / word similarity** — `matchDrug` as today on the primary reading, each alternative, the raw line.
2. **Alias exact** — learned/admin aliases (as today, score 1.0).
3. **Shape** — T1 `shapeCandidates`: first 2 letters + consonant skeleton + length window ±2 on `brand_key`,
   filtered by strength/form when written.
4. **Confusion expansion** (new): generate up to 24 spelling variants of the reading by a bounded beam over the
   handwriting confusion model (§4) — substitutions, one missing or extra letter, `rn↔m`, `cl↔d`, doubled
   letters — each variant looked up **exactly** on `brand_key` (btree, cheap) and by trigram when
   `legibility != clear`. Catches «Ripan → Riopan», «Bebra → Bepra», «Motdyl → Motilium/Motidyl».
5. **Ingredient path** — a reading that matches `active_ingredients.normalized` (trigram ≥ 0.6) brings the
   brands of that ingredient (top 5 by popularity prior), so «Omeprazole 20» resolves to its products.
6. **Strength family filter** — when a strength is written, candidates whose brand family has that strength get
   `strengthInFamily = true` (a feature, not a filter: the doctor may have written it wrong).
Cap: 12 candidates per line, kept by the best raw score per brand family (strength variants of one family
collapse into the family + its matching variant). Latency budget: ≤ 150 ms per line, all lines in parallel.

### S4 — Evidence fusion (`packages/shared/src/rx-engine/fusion.ts`, new; pure, no I/O)
For each line *l* and candidate *c*, a feature vector *f(l, c)*:

| # | Feature | Source |
|---|---|---|
| f1 | handwriting-weighted edit similarity: 1 − WDL(reading, brand) / max length, where WDL is Damerau-Levenshtein with costs from the confusion model (§4) | reading vs `brand_key` |
| f2 | best f1 over `alternatives`, the zoom blind reading (after S5) and the adjudicator reading (after S7) | all readings |
| f3 | trigram score from the database | S3 |
| f4 | skeleton equality (consonants), f5 first-two-letters equality, f6 \|length − estimate\| | shape |
| f7 | strength: written and in family (+), written and absent (conflict), not written (0) | DB strengths |
| f8 | form compatibility: written form, and dose unit → form (ملعقة → syrup/susp, نقطة → drops, حقنة → amp/vial, لبوس → supp, بخة → spray/inhaler, قرص → tab, كبسولة → caps, دهان → cream/oint) | dictionary in `rx-normalize` |
| f9 | log popularity prior: smoothed count of confirmed lines of this brand family (`drug_usage_stats`) | own data |
| f10 | co-prescription coherence: mean PMI of the candidate's category with the categories of the other confidently matched lines (`drug_cooccurrence`) | own data |
| f11 | header coherence: category prior given `headerSignals.specialty` | own data |
| f12 | duplicate pressure: same active ingredient already asserted on another line (negative) | result so far |
| f13 | provenance: alias exact (+), transliterated or ingredient-only (−) | S3 `via` |
| f14 | model reading confidence and legibility | S2 |
| f15 | zoom choice indicator × zoom confidence, adjudicator choice indicator × its confidence | S5, S7 |

Score *s(l, c) = w · f(l, c)*; a **null hypothesis** "none of these" gets *s(l, ∅) = w∅ · g(l)* (g: best f1,
legibility, candidate count). Posterior *p(c | l) = softmax over {candidates, ∅}*. Weights *w* are a versioned
setting (`rxEngine.fusion = { version, weights, nullWeights }`), fitted offline by L2-regularised multinomial
logistic regression on the dev split (§8) by `pnpm --filter @wasfa/worker rx:fit` (writes a JSON file the
admin imports; never auto-applied). Shipped defaults are hand-set so v2 works before the first fit.

Why this design: each signal alone is weak on hard handwriting; together they separate the right product
from its look-alikes, and the null hypothesis keeps the engine honest when nothing fits — "none" competes with
every candidate instead of being a fallback.

### S5 — Zoom re-read (`rx_verify` v2, one batched call)
Which lines: every line whose top posterior < `rxEngine.confirmAt`, or legibility ≠ `clear`, or a number was
marked doubtful, or a strength conflict — capped by `rx.verifyMaxItems` (raise default to 12), highest risk
first (as today).
Per line the model receives: name crop, line crop, the top ≤ 8 candidates (brand, strengths available, form,
ingredient, category), and the **context block**: the other medicines on the prescription (as currently
resolved), the line's directions, the header specialty.
The answer schema enforces **observe before choose** (fields are generated in this order):
1. `blindReading` — the letters of the name as seen in the crop, before considering the candidates;
2. `letters` — per-letter certainty string (`B e ? r a` style, `?` for a doubtful letter), optional;
3. `numbers` — strength digits and frequency as re-read (`null` when not visible);
4. `choice` — a candidate id | `none` | `unreadable`;
5. `confidence` — 0–1 for the choice.
The blind reading is a second independent observation (fed to f2); the choice is a vote (f15); the numbers are
checked against S2 (a disagreement sends the line to S7). The verify prompt follows NEXT-TASKS T1 §4: "a one
letter or one word difference from what you see is acceptable for handwriting; answer `none` only when no
candidate is consistent with what is written; never answer outside the candidates".

### S6 / S7 — Contest detection and adjudication (`rx_adjudicate`, new task, conditional)
A line is **contested** when any of: the zoom choice ≠ fusion top; top-2 posterior margin < `rxEngine.margin`
(default 0.15); S2 and S5 numbers disagree; the top candidate has a strength conflict. Contested lines (cap 6)
go to one batched call on a **different model family** than `rx_verify` (admin route; default: the strongest
available "pro" vision model with high thinking), with: the crops, the two leading hypotheses with their
evidence summary, and the instruction to choose between them, `none`, or `unreadable`, with a confidence. Its
vote enters f15 and the line is re-fused. Uncontested lines never pay for this call.

### S8 — Calibration and tiers (`packages/shared/src/rx-engine/calibration.ts`)
- The fused top posterior *p* is mapped through an **isotonic calibration table** (fitted on the dev split,
  stored in `rxEngine.calibration`, piecewise-linear, monotone) to *p̂*, an honest probability.
- Thresholds per **stratum class** (`printed`, `clear`, `hard`) — the class is predicted at run time from the
  quality score, legibility mix and `printedLetterhead` (no gold label at run time):
  - `confirmed` if *p̂ ≥ τc* and no field conflict; `likely` if *p̂ ≥ τl*; `uncertain` if a candidate has
    *p̂ ≥ τu*; else `ai` when a reading exists; `unreadable` when nothing was read.
- **Threshold selection** (`rx:fit`): for each class, sweep τ on the dev split and pick the lowest τ whose
  precision Wilson lower bound ≥ target (CP 99 % for τc, AP 95 % for τl); confirm on the holdout; refuse to
  export when the holdout misses (§9).

### S9 — Field checks (pure, `rx-engine/fields.ts`)
Flags, never silent corrections (MEDICATIONS §1): strength absent from the chosen family (existing
`strength_unknown`); dose unit incompatible with form (e.g. «ملعقة» with tablets); frequency above 6/day or a
duration above 365 days; two lines with the same ingredient (existing finding); a pediatric form with an adult
strength is **not** inferred (no age data). Each flag lowers *p̂* by a fixed factor and appears as a finding.

### S10 — Finalize, details, learning
- Result schema v2 (§6). Details step as today, but only for asserted lines (an `uncertain` line gets details
  for its top candidate labelled "if it is X").
- Learning signals (best effort, aggregates only): confirmations and corrections → existing votes; aligned
  (reading → confirmed brand) pairs → confusion counts; confirmed lines → `drug_usage_stats`; category pairs of
  asserted lines → `drug_cooccurrence`. Nightly job rebuilds priors (§5).

---

## 4. Handwriting confusion model (`packages/shared/src/rx-engine/confusion.ts`)
- **Seed table** (Latin cursive, Egyptian prescriptions; cost 0 = identical, 1 = unrelated):
  `a↔o 0.3`, `a↔u 0.35`, `n↔u 0.3`, `n↔r 0.45`, `m↔rn 0.25`, `m↔nn 0.3`, `u↔v 0.3`, `i↔l 0.35`, `l↔t 0.4`,
  `e↔c 0.35`, `e↔i 0.4`, `b↔p 0.35`, `b↔h 0.45`, `d↔cl 0.3`, `g↔q 0.35`, `g↔y 0.4`, `k↔h 0.45`, `f↔t 0.45`,
  `r↔v 0.45`, `s↔r 0.5`, `x↔n 0.55`, `0↔o 0.2`, `1↔l 0.25`, `5↔s 0.4`; insertion/deletion of a vowel 0.4, of a
  consonant 0.6; doubling 0.2; adjacent transposition 0.5.
- **Learning:** every confirmed or user-corrected line yields an alignment (reading → brand); substitution counts
  accumulate in `rx_confusion_counts` (pair, count); the nightly job turns them into costs
  (−log of a smoothed conditional probability, blended with the seed by a prior strength of 50 observations).
- The same model powers S3 expansion, f1/f2, and the agent's name resolver (`WA-AGENT-RUNTIME.md` §10), so the
  WhatsApp agent understands «بنادول/banadol/panadol» and «augmantin» the way the reader does.

## 5. Priors (own data only, aggregates, no user ids)
| Table | Content | Built by |
|---|---|---|
| `drug_usage_stats` | `brand_key`, `confirmed_count`, `last_seen_at` | nightly job from finalized analyses (asserted lines) and approved aliases |
| `drug_cooccurrence` | `category_a`, `category_b` (ordered), `count` | nightly, asserted lines of the same analysis |
| `rx_confusion_counts` | `from`, `to`, `count` | nightly, alignments |
Cold start: popularity = 0 for all (feature weight small by default); categories from the DWA import. All three
are rebuildable from scratch and contain no personal data (aggregates only; DATABASE.md rows added in WP4).

## 6. Data and schema changes
- `rxExtractItemSchema`: optional `name_box`, `script`, `letterCountEstimate`; extraction-level optional
  `rotation`, `headerSignals`.
- `rxVerifyAnswerSchema` v2: `{ index, blindReading, letters?, numbers?, choice: id | "none" | "unreadable",
  confidence }`; v1 answers still parse (adapter) during rollout.
- `rxAdjudicateAnswerSchema` (new).
- `rxResultItemSchema` → **schema version 2**: `match: confirmed | likely | uncertain | ai | unreadable`;
  `evidence: { posterior, candidates: [{ drugId, brand, strength, p }] (≤ 3), readings: { first, blind?,
  adjudicated? }, flags: string[] }`; `crop: { page, box }` for the UI and the PDF. Readers accept v1 and map
  `source`/`badge` to a tier (`database`+high → confirmed, `database` → likely, `ai` → ai).
- `rx_pages.master_key` (nullable), migration. New tables of §5. Settings key `rxEngine` (§10).

## 7. One engine, three consumers
- **Prescriptions** (web, WhatsApp, any bot): the worker pipeline above.
- **Name resolution without an image** (`resolveDrugName(db, text, ctx)` in `packages/db`): S3 + S4 without
  image features — used by the WhatsApp agent's `lookup_medication`, the website assistant cards and
  `/medications` search "did you mean".
- **Box identification** (Companion dispense check, `WA-COMPANION.md` §4): barcode exact → else S2-style read
  of the box text → S3/S4 with packaging features (strength and form are printed, so they weigh more).

## 8. The gold set and evaluation (`apps/worker/src/eval/*` grows; nothing new to learn)
- **Gold set (owner prerequisite):** ≥ 400 real prescriptions, de-identified (patient and doctor names, phones
  masked before upload), with consent. Quotas: printed 80, clear handwriting 100, hard 140, very hard 80;
  ≥ 60 multi-page; ≥ 40 with Arabic-script drug names; ≥ 40 photographed badly (angle, low light). Each labelled
  by **two pharmacists** independently (existing sheet template + a `stratum` column + `drugId` from the
  database picker), disagreements adjudicated by a third.
- **Splits:** dev 60 % (fitting weights, calibration, thresholds, prompt work) / holdout 40 % (frozen; used
  only at release gates; never viewed when tuning). Stratified by stratum.
- **Scorer v2** (`packages/shared/src/evals.ts`): per stratum and overall — CP, AP, AP-LB (Wilson), SER,
  coverage, numbers accuracy, detection, top-3 recall, ECE, cost, latency; precision-coverage curves; a
  per-stage ablation (engine flags: `noShape`, `noConfusion`, `noFusion`, `noZoom`, `noAdjudicate`).
- **Recorded-model replay** (new, the CI multiplier): an eval run can save every model response
  (`ai_eval_recordings`, keyed by image hash + prompt hash + route) and later **replay** them. Code-only changes
  (retrieval, fusion, calibration, thresholds) are evaluated on the full dev split **in CI, deterministically,
  at zero provider cost**. A prompt or model change makes a new recording (paid, admin-triggered).
- **Shadow mode:** `rxEngine.shadowPercent` runs v2 next to v1 on a share of real analyses (results stored,
  never shown, no extra charge to the user; cost counted against the AI budget), to compare tiers on live
  traffic before the switch.

## 9. Release gates (enforced by `rx:gate`, run on the holdout)
A new engine version, weight set, calibration table or prompt is promoted only if, on the holdout:
1. AP ≥ 95 % and AP-LB ≥ 93 % in **every** stratum; CP ≥ 99 %; SER ≤ 1 %;
2. no stratum's AP drops by more than 1 point vs the current version (existing `isEvalRegression` rule);
3. numbers ≥ 98 %, detection ≥ 99 %;
4. p95 latency ≤ 60 s and mean cost ≤ cap.
The gate report (markdown + JSON) is attached to the PR and stored with the eval run.

## 10. Settings (`site_settings` key `rxEngine`, admin-only; defaults are safe)
`version` (`v1 | v2`, default `v1` until the gate passes) · `shadowPercent` (0) · `quality` (thresholds,
`askRetakeOnWhatsApp` true, `blockOnWeb` false) · `masterImage` (true) · `confusion.enabled` (true) ·
`fusion` (versioned weights) · `calibration` (versioned table) · `thresholds` per class (`confirmAt`,
`likelyAt`, `uncertainAt`) · `margin` (0.15) · `zoomMaxItems` (12) · `adjudicate` (`enabled` true,
`maxItems` 6) · `maxCostUsdMicros` (per analysis) · `learnConfusions` (true).
Model routes: `rx_extract`, `rx_verify`, **`rx_adjudicate` (new task)** in AI → Routes; seed: adjudicate on the
pro model, verify on a different family than adjudicate when two families are configured.

## 11. Safety (unchanged principles, now enforced by the tiers)
- A database name is shown only for asserted tiers; `uncertain` lines show options, never a single name.
- Dose, frequency and duration always come from the prescription (S9 flags, never replaces).
- Strength from the database only when the product is resolved and the doctor's strength agrees (as today).
- Model outputs are zod-validated with one repair attempt (`model-call.ts`), else a typed failure.
- Logs carry codes, timings and counts only; never readings, crops or names (AGENT §5.7).
