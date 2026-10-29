# Medications: database, recognition, search (spec, 2026-10-28)

One medication database and one recognition engine shared by the prescription tool, the website
assistant and the WhatsApp agent. Admin-controlled. Accuracy first, then cost.

Builds on what exists: `drugs`, `active_ingredients`, `drug_ingredients`, `drug_aliases`,
`drug_import_batches` (packages/db/src/schema/drugs.ts), the trigram matcher
(packages/db/src/drug-matcher.ts), the rx pipeline read → match → verify(crops + candidates) → finalize
(apps/worker/src/rx/*), the import wizard (XLSX/JSON, dry-run, commit, rollback).

## 1. Principles

1. **The model reads, the database confirms, nothing is forced.** A database entry is used only when the
   evidence says it is exactly what was written. Otherwise the model's own reading stands, labelled
   "AI reading, not confirmed in the database".
2. **No database in prompts.** Retrieval is SQL (pg_trgm + exact keys). A model sees at most the few
   candidates of an uncertain line. 34k rows cost nothing per request.
3. **One engine.** Matching, decision and card building live in packages (db/shared) and are called by the
   worker (rx) and the api (chat, WhatsApp, search, admin).
4. **The admin decides.** Thresholds, modes and switches are settings, not constants.

## 2. Data

Source file: `docs/datat/egyptian_medicines.json` (34,000 rows, dwaprices.com format). Profile: 27% no
active ingredient, 23% no category, `trade_name_ar` is not Arabic (English + "price in Egypt": ignored),
every barcode is the 13-digit code written twice (keep one half when the halves are equal), prices in EGP
(stored as integer piastres, AGENT §5.5), ~1/3 cosmetics/supplements.

New `drugs` columns (migration): `category text`, `price_minor integer` (>= 0), `old_price_minor integer`,
`currency text` (default `EGP`, ISO 4217 pattern), `pack_text text` ("20 f.c.tabs"), `units_count integer`,
`barcode text`, `source text`, `source_ref text`, `brand_key text not null default ''` (the brand family:
normalized name without strength, form and pack, e.g. `flumox`), `price_updated_at timestamptz`,
`admin_edited_at timestamptz`. Indexes: btree `brand_key`, btree `barcode`, btree `category`, unique
`(source, source_ref)` where `source_ref is not null`. `active_ingredients.normalized` is already unique.

New tables:
- `drug_unmatched_names` — `normalized` PK, `sample` (a reading, never a user id or image), `hits`,
  `first_seen`, `last_seen`, `status` (`open` | `mapped` | `ignored`), `mapped_drug_id` (set null).
- `drug_learning_votes` — `(normalized, drug_id, user_id)` PK, `created_at`. A user who corrects a line to
  a database drug votes "this reading means this drug". Rows of a deleted user cascade.
- `drug_learned` — `(normalized, drug_id)` PK, `votes`, `status` (`pending` | `approved` | `rejected`),
  `decided_by`, `decided_at`. Approved rows become `drug_aliases` with `source = 'learned'`.

Import preset `DWA` (dwaprices JSON): brand/strength/form/pack parsed from `trade_name_en`; ingredients
split on `+`; `concentration` as strength when present; category, company → manufacturer, prices,
units, barcode; `source = 'dwaprices'`, `source_ref = id`. Re-import is an upsert on `(source, source_ref)`
that **never overwrites a row with `admin_edited_at` set** (prices included: the admin owns it). Any admin
edit sets `admin_edited_at`.

## 3. Settings (`site_settings` key `medications`, admin-only)

| key | default | meaning |
|---|---|---|
| `enabled` | true | Use the database anywhere. Off: recognition is AI-only, search and cards are hidden. |
| `mode` | `hybrid` | `hybrid` (database + AI) or `ai_only` (recognition ignores the database; search still works). |
| `similarityFloor` | 0.30 | trigram floor for a candidate |
| `acceptScore` | 0.85 | auto-accept at or above |
| `reviewScore` | 0.50 | below: not a candidate worth verifying |
| `minMargin` | 0.06 | top must beat the best *other brand family* by this much to auto-accept |
| `strengthBonus` / `strengthConflictPenalty` / `formBonus` | 0.10 / 0.15 / 0.05 | score adjustments |
| `maxCandidates` | 5 | candidates per line (and per verify item) |
| `useAlternatives` | true | match the model's alternative readings too |
| `learnAutoApproveAt` | 3 | distinct users agreeing promote a learned alias; 0 = admin only |
| `logUnmatched` | true | keep the unmatched-names queue |
| `chatCards` | `{ enabled: true, max: 3 }` | reference cards in the website assistant |
| `waTools` | true | `search_medications` for the WhatsApp agent |
| `search` | `{ enabled: true, showPrices: true }` | the user search page |

`rx.drugMatching` is retired: recognition uses the database iff `enabled && mode === 'hybrid'`.
`rx.verifyMaxItems` stays. Matcher constants in packages/shared/src/drugs.ts become the defaults.

## 4. Recognition (prescription tool; same engine for any "what drug is this text")

1. **Read** (one vision call, unchanged cost). Per line the model adds `alternatives` (0-3 other plausible
   readings of the name, as written, never "corrected" to a known brand) and `legibility`
   (`clear` | `partial` | `unclear`). The prompt says: transcribe; do not normalize to brands you know.
2. **Retrieve** (SQL, no AI). In order: exact learned/admin alias on the normalized reading (score 1.0,
   `matchedOn = 'alias_exact'`); trigram on the primary reading; trigram on each alternative and the raw
   line (if `useAlternatives`). Merge by drug, keep the best score; a hit that came only from an
   alternative is tagged `via = 'alternative'`. Every reading is first cleaned (`cleanDrugQuery`:
   bullets, "x -", Rx, numbering, Arabic directions and doses out) and scored against `brand_key` (the
   family) and by word similarity to the product name, not by whole-string similarity. An Arabic-script
   name is also tried through its likely Latin spellings (`arabicToLatinCandidates`); a hit found only
   that way is `transliterated` and is treated like `via = 'alternative'`: never auto-accepted.
3. **Decide** (pure function, one place, `decideMatch(candidates, line, settings)`):
   - `accept` only if: top score >= `acceptScore`; no strength conflict; not ingredient-only; not
     `via = 'alternative'`; `legibility !== 'unclear'`; and top beats the best candidate of a *different*
     `brand_key` by >= `minMargin`. Pack/strength variants of the same family are not competitors: among
     them the strength/form written picks the product; if nothing written separates them, the family is
     accepted but strength and pack are **not** taken from the database.
   - `verify` if top >= `reviewScore` and not accepted.
   - `unmatched` otherwise.
4. **Verify** (existing `rx_verify`, crops + candidates, at most `verifyMaxItems` lines in one call). The
   model must answer a candidate **or none**. "None" means the AI reading stands; it is never mapped to the
   closest name.
5. **Finalize.** Accepted/verified lines take brand, ingredients, form from the database (authoritative);
   dose/frequency/duration always from the prescription. Unmatched lines keep the AI reading, are
   labelled, and (if `logUnmatched`) their normalized reading is upserted into `drug_unmatched_names`.
6. **Details** (existing optional call) receives the database ingredient/category for matched lines so the
   explanation is anchored to the real active ingredient.
7. **Learn.** A user correction that picks a database drug records a vote; at `learnAutoApproveAt`
   distinct users the pair becomes an approved alias (admin can approve/reject earlier or revert).

Costs: no new model calls. Retrieval is a few indexed queries per line; verification stays one batched call
for flagged lines only, exactly as today.

## 5. Website assistant and WhatsApp agent

- **Reference cards** (website assistant, no tools, no extra call): the user message is tokenized into
  1-3-word n-grams, normalized, and looked up **exactly** against `brand_key` and
  `active_ingredients.normalized` (btree). Up to `chatCards.max` cards are injected into the system context:
  brand, active ingredients, available strengths and forms, category, price range (if `showPrices`),
  "from the platform's Egyptian drug database, may be incomplete". ~60 tokens each. No match, no card.
- **WhatsApp agent tools:** `search_medications({ query })` → up to 5 entries (brand, ingredients, strength,
  form, price) and `medication_alternatives({ drugId })` → same active-ingredient set, cheapest first. Guests
  may use both (sales value). `ask_medical` gets the cards through the chat path.
- Medical guardrails unchanged: facts from the database or the chat engine, standard disclaimer, no dosing
  advice beyond what was prescribed.

## 6. Medication search (users)

Replaces the "Coming soon" sidebar item (`nav.drugs`). Signed-in users. No AI.
- `GET /medications/search?q=&category=&cursor=` → digits only = barcode lookup; otherwise exact
  `brand_key` / ingredient first, then trigram; 20 per page; rate limit 60/min/user.
- `GET /medications/:id` → the entry plus alternatives (same active-ingredient set), cheapest first.
- Pages: `/medications` (search, filters) and `/medications/[id]` (details, alternatives, "analyze a
  prescription" link). Prices shown as "approximate, updated <date>".

## 7. Admin

`/admin/drugs` grows into a section:
- **Entries:** list with search and filters (category, manufacturer, missing ingredient, missing price,
  withdrawn, edited), create, edit every field (names, aliases, ingredients with strengths, form, strength,
  pack, price, category, barcode, status), withdraw/restore, delete (hard; rx results keep their snapshot).
- **Imports:** existing wizard + the `DWA` preset; re-import respects admin edits.
- **Review queues:** unmatched names (map to a drug → alias `source = 'admin'`, create a new drug, ignore)
  and learned aliases (approve, reject).
- **Recognition settings:** every key of section 3, with the two switches at the top.
- **Sandbox:** type a name (+ optional strength/form) → candidates, scores, explanation and the decision the
  engine would take with the current settings.

## 8. Work packages

1. Data: migration, schema, settings key, `DWA` preset + parser, brand_key backfill, import of the file.
2. Engine: alternatives/legibility in extraction, retrieval merge, `decideMatch`, verify "none",
   finalize rules, unmatched log, learning votes.
3. API: `/medications` search/detail, admin CRUD/queues/sandbox/settings endpoints, chat cards, WhatsApp
   tools.
4. Web: search pages, sidebar, admin section.
5. Later (optional, admin button): AI-generated Arabic aliases for brands (one-time batch).

Data note: the file was collected from dwaprices.com; the owner is responsible for the right to use it.
