# Prescription accuracy evaluation (`evals/rx`)

This folder is how the owner turns real prescriptions into a **labelled set**, so the platform can
measure how well each AI model reads them. Nothing here is code you have to understand: you fill a
spreadsheet, upload it with the pictures, and read the numbers.

> Never commit the pictures or the filled spreadsheet. They are real prescriptions. They go to the
> admin page only, which stores them in the private bucket under `evals/rx/`.

## 1. Collect the pictures

- 50 to 200 prescriptions is a good first set. Mix **printed** and **handwritten** ones (the numbers
  are reported separately, and the targets differ: 95% printed, 85% handwritten).
- Use the real photos as users would send them (phone pictures, some blurry, some crooked).
- Remove nothing from the picture. Names of patients are not a problem for the evaluation: they are
  never copied into the labels, and the pictures are never shown to anyone but admins.
- One file per page. A prescription with two pages is two files (see `image_file` below).
- JPEG, PNG, WebP or PDF (one page), up to 10 MB each, at most 300 pictures per upload.

## 2. Label them

Open `template.xlsx`. The first sheet, **Labels**, is the one that is imported (the second sheet only
explains the columns). Write **one row per drug on the paper**.

| Column | What to write |
|---|---|
| `image_file` | The picture's file name, exactly (`rx-001.jpg`). For a prescription with several pages write them in one cell separated by `;` (`rx-002-p1.jpg;rx-002-p2.jpg`). Every row of the same prescription repeats the same cell. |
| `kind` | `printed` or `handwritten`. The same for every row of one prescription. |
| `item_no` | Optional. The order of the drug on the paper (1, 2, 3). If empty, the order of the rows is used. |
| `drug` | The drug **as written on the paper** (brand or generic). If the picture has no drug at all, write the row with this cell empty. |
| `strength` | As written (`500 mg`). Leave empty if the paper does not say: empty cells are not scored. |
| `form` | `tablet`, `syrup`, ... Recorded, not scored. |
| `frequency` | As written: `1x3`, `bid`, `3 times daily`, `ق.أ`. The comparison understands the meaning, not the spelling. |
| `duration` | As written: `5 days`, `x 7`, `لمدة 5 أيام`. |
| `route` | `oral`, `topical`, ... Recorded, not scored. |

Example (three rows, two prescriptions):

| image_file | kind | item_no | drug | strength | form | frequency | duration | route |
|---|---|---|---|---|---|---|---|---|
| rx-001.jpg | printed | 1 | Augmentin | 1 g | tablet | 1x2 | 7 days | oral |
| rx-001.jpg | printed | 2 | Panadol | 500 mg | tablet | tid | 3 days | oral |
| rx-002-p1.jpg;rx-002-p2.jpg | handwritten | 1 | Cataflam | 50 mg | tablet | bid | 5 days | |

Tips: label what the paper says, not what you think the doctor meant. If a word is unreadable even to
you, leave that prescription out of the set rather than guessing: a wrong label punishes a model for
being right.

## 3. Import

Admin > AI > **تقييم الدقة** (Accuracy evaluation) > **Sets and import**. Give the set a key (lower-case
letters, digits, dashes) and a name, choose the spreadsheet and select all the pictures at once, then
upload. The page shows the result of the import: how many prescriptions were added and a list of notes
by row or file name (a picture named in the sheet but not uploaded, a picture that is not used, an
unknown `kind`, ...). Rows with a problem are skipped; the rest are imported. Importing the same
pictures again adds nothing twice, so you can fix the sheet and upload again.

What happens to a picture: it is re-encoded like any user upload (rotated upright, EXIF and GPS
removed, 2048 px, JPEG) and stored in the private bucket under `evals/rx/<id>/processed`. The worker
does this; the original upload is deleted from the staging area when it is done.

## 4. Run and read the numbers

**Runs > New run.** Choose the set and one or more models. Each model gets its own run, with that model
alone on the prescription-reading route (no fallbacks, so the comparison is fair). The run uses the
real pipeline: read, drug-database match, re-read of the doubtful lines, finalize. It uses **no user
credits**, but it spends real provider money (the daily spend cap and the kill switch apply). A run
shows its progress and can be stopped.

What the numbers mean (the exact rules are written at the top of `packages/shared/src/evals.ts`):

- **Drug-name accuracy** — labelled drugs whose name was read correctly after matching the drug
  database, over all labelled drugs. A drug the model missed counts as wrong.
- **Recall** — labelled drugs the model found at all (even with a slightly wrong name).
- **Strength / frequency / duration accuracy** — correct over the labelled ones, compared by meaning
  (`tid` equals `3 مرات يوميًا`, `0.5 g` equals `500 mg`).
- **Fabricated drugs** — lines shown with **high confidence** that are not a correct reading of any
  labelled drug (invented, or the wrong drug). The target is **zero**.
- **Calibration** — for each confidence band, how often the lines in it were right. If the 85-95% band
  is right only 70% of the time, the confidence thresholds are too generous.
- **Cost and latency** — provider cost and the median / 95th-percentile time per prescription.

Select two runs and press **Compare** for a side-by-side table with the difference in points.

## 5. Choose a route

Run the same set on the candidate models (`3.1 Flash-Lite`, `3.5 Flash-Lite`, `3.6 Flash`,
`3.8 Flash`, ...), keep the cheapest one that meets the Targets table of `docs/phases/phase2.md`, and
record the numbers in the Notes of Task 2.10. The route editor shows each primary model's **last
score**. Promoting a model whose last score is more than one point lower than the current one asks for
a written reason, which goes to the audit log; a drop is also logged as `eval.regression`.

## 6. Improve the set from real use

Users can tick "use this correction to improve accuracy" when they fix a line. Those corrections wait
in **Correction review**: only the line text and the before/after are shown, nothing about the patient.
**Approve** adds the whole corrected reading to a set (and copies the picture into the private
evaluation area if it still exists); **Reject** withdraws the consent. Review the other lines of the
reading before approving: the whole reading becomes the label.

## Notes for developers

- The template is generated: `pnpm --filter @wasfa/worker eval:template` rewrites `template.xlsx`
  from `EVAL_SHEET_COLUMNS` in `packages/shared/src/evals.ts`.
- Pipeline code shared with production: `apps/worker/src/rx/analyze.ts`. Runner:
  `apps/worker/src/eval/run.ts` (queue `evals`, job `evals.run`, 2 prescriptions at a time). Import:
  `apps/worker/src/eval/import.ts` (job `evals.import`). API: `apps/api/src/admin/evals/`.
- **TODO (Batch API):** providers with a Batch API (about 50% cheaper, results within 24 h) are not used
  yet. Runs call the models live, 2 at a time. Adding batch needs a per-provider submit/poll adapter in
  `@wasfa/ai`; until then the cost of a run is the normal price.
- Permission: `evals.run` (view and run). Starting a run and importing ask for a recent password check.
