# Phase 6 — orchestration playbook (who does what, in which wave)

> Companion to `phase6.md`. Follows `CLAUDE.md` (model ladder, routing rules, brief format) and the lessons in
> the project memory: at most 3–4 builders at once, each in its own worktree; never `git stash` while builders
> edit; Docker is often down locally, so integration tests may need CI; the main session commits after review.

---

## 1. Roles in this phase

| Tier | Owns in Phase 6 | Never does |
|---|---|---|
| **Main (Opus)** | decisions 73–88 and any amendment; the failure-policy table; idempotency and transaction boundaries; fence rules; the fusion feature set, null hypothesis, contest rules and threshold policy; the S2/S5 prompt and skill wording; guard repair contract; report "never show" rules; dispense matrix and reminder window rule; every brief; every review; promotion decisions at `rx:gate`; commits | mechanical edits, broad searches, long command runs |
| **builder (Sonnet)** | modules from briefs: transport, queue, lock, outbox, sessions, commands, attachments, composer, retrieval, confusion, fusion code, calibration code, schema v2 adapters, Typst template, Companion modules, admin screens, real-logic tests, scenario and chaos tests | choosing names/signatures/schemas not in the brief; touching files outside the brief |
| **runner (Haiku)** | file moves from a move map, i18n rows from a given list, migrations from given SQL, RBAC rows, CI yaml from a given spec, `typecheck/lint/test/build`, eval and replay runs, git status/diff summaries, commits with exact messages | anything needing a design choice |
| **scout (Haiku)** | "where is X / who calls Y / what does Z return", production log forensics with the access note, doc lookups (Baileys media re-upload, BullMQ deduplication, sharp CLAHE, Typst QR), dependency checks | editing |

Escalation (CLAUDE.md rule 5): runner fails or reports ambiguity → fix the brief once or move to builder;
builder fails twice → main does it. A builder that finds the spec wrong stops and reports; it does not invent.

## 2. Waves (each wave = one message with parallel calls; worktree per builder)

| Wave | Track W (agent) | Track R (engine) | Shared |
|---|---|---|---|
| 0 | runner: commit turn-timeout fix (WP0.1) · builder: baseline merges (WP0.2) | — | scout: forensics (WP0.3) |
| 1 | builder: scenario harness + red tests R1–R8 · builder: red tests R9–R16 | builder: scorer v2 (WP3.2) | runner: baseline SQL (WP0.5) |
| 2 | builder: migration + schema (WP1.1) · builder: bridge media (WP1.9) | builder: eval sheet v2 + recordings/replay (WP3.1, 3.3) | — |
| 3 | builder: stream consumer + DLQ (WP1.2) · builder: queue + lock + turn store (WP1.3–5) | builder: gate script + CI replay (WP3.4–5) | — |
| 4 | builder: policy wiring + fallbacks (WP1.6) · builder: idempotency + rx transaction (WP1.7) | builder: quality + HEIC (WP4.1) | — |
| 5 | builder: outbox + deliverer (WP1.8) · runner: WP2 move map (WP2.1) | builder: confusion + distance (WP4.5) · builder: master image + crops (WP4.2) | — |
| 6 | builder: normaliser/matcher (WP2.3) · builder: sessions (WP2.2) | builder: retrieval + benchmark (WP4.4) | — |
| 7 | builder: attachments + tool memory (WP2.4–5) · builder: composer (WP2.6) | builder: schemas + verify v2 wiring (WP4.3, 4.6) | — |
| 8 | builder: command handlers (WP2.3b) · builder: admin part A (WP9A) | builder: fusion (WP5.1) · builder: calibration + tiers + fields (WP5.3) | — |
| 9 | builder: resolver + guards (WP6.1, 6.3) | builder: rx:fit (WP5.5) · builder: adjudication (WP5.2) | builder: schema v2 adapters (WP5.4) |
| 10 | builder: tools + web reuse (WP6.2, 6.5) | builder: tier display (WP5.6) · builder: learning (WP5.7) | runner: recordings + fit + gate runs (WP5.8–9) |
| 11 | builder: report template (WP7.2) · builder: report data + ics (WP7.1, 7.3) | builder: admin part B (WP9B) | — |
| 12 | builder: delivery + web download (WP7.4–5) · builder: Companion schema + dispense comparison (WP8.1–2) | — | builder: routine + dose parsing (WP8.4) |
| 13 | builder: box read + cabinet (WP8.2b, 8.3) · builder: scheduler + replies (WP8.5) | — | builder: safety net + voice (WP8.6–7) |
| 14 | builder: admin part C (WP9C) | — | runner: full suites, chaos, load · main: `/security-review`, docs, gate |

Never more than 4 builders in one wave. The main session reviews and commits each builder's worktree before the
next wave touches the same files; waves that touch disjoint directories may overlap by one.

## 3. Review checklist (main session, per diff)
1. Against the brief: names, signatures, schemas, file locations exactly as decided.
2. Invariants I1–I7 (WA-AGENT-RUNTIME §1): which one could this diff break? Is there a test for it?
3. AGENT §5: zod at boundaries, scoped repos (no queries outside `*.repo.ts`), ledger-only credits, typed errors
   with references, redacted logs (no prescription text, no phone), admin settings not constants, i18n, RTL.
4. Engine changes: replay eval run attached (AP/SER per stratum vs main); no stratum regression.
5. Scenario/chaos tests added for the behaviour, not only units.
6. `git diff --stat` matches the brief's file list; nothing "improved" outside it.

## 4. Brief skeletons for the riskiest items (fill paths/line ranges at dispatch time)

### B-WP1.6 — failure policy wiring (builder)
- **Goal:** every turn ends in `replied | deferred | failed_replied | dropped_policy` per the policy table; the
  busy line is never sent for model errors; no automatic pause.
- **Context:** `packages/shared/src/wa-agent/failure.ts` (written by main: `classify(error, { toolsRan })` and
  `actionFor(class)`), `apps/api/src/wa-agent/turn/turn-runner.ts`, `turn.store.ts`, `fallback-replies.ts`
  (texts in i18n), red tests R4, R6, R11, R13.
- **Decisions made:** class names, retry delays (1.5 s, 4 s), job attempts 3 with 20/60/180 s, failure-text rate
  limit 10 min, owner alert rate limit, deferral text key `whatsapp.agent.deferred`.
- **Do not:** change tool contracts, the queue, the lock, or the prompt.
- **Verify:** `pnpm --filter @wasfa/api test -- wa-agent/turn wa-agent/scenarios`, typecheck, lint.
- **Return:** files changed, tests added, any case the table does not cover (stop and report, do not invent).

### B-WP1.7 — exactly-once tools and the rx start transaction (builder; main reviews line by line)
- **Goal:** repeating any side-effecting tool call within a turn retry has one effect; rx start cannot orphan.
- **Decisions made:** key = `sha256(turnId|tool|canonicalJson(args))`; table `wa_tool_effects`; wrapper
  `withToolEffect(key, fn)` in `agent/tools/tool.ts`; rx start transaction order: claim media rows → insert
  analysis (via `RxService.createInTx`) → insert `wa_outbox` route → commit → enqueue job after commit.
- **Do not:** move credit logic out of `RxService`; add Redis as a source of truth.
- **Verify:** idempotency int tests (each tool ×3 → one effect), crash-after-commit and crash-before-enqueue
  scenarios.

### B-WP2.1 — move map (runner)
- **Goal:** files moved exactly per the map, imports fixed, no behaviour change.
- **Context:** the map table (old path → new path) written by main; `wa-agent.module.ts`.
- **Verify:** `pnpm --filter @wasfa/api typecheck && pnpm --filter @wasfa/api test`. If the module wiring fails
  for a reason not in the map → stop and report (goes to builder).

### B-WP4.4 — retrieval union (builder)
- **Goal:** `retrieveCandidates(db, line, opts)` in `packages/db/src/rx-retrieval.ts` returns ≤ 12 tagged
  candidates per RX-ENGINE §3 S3, p95 ≤ 150 ms per line on the full DWA import.
- **Decisions made:** signature, `via` enum (`primary | alternative | raw | alias_exact | shape | confusion |
  ingredient`), family collapse rule, beam size 24 from `expandReadings` (pure, `rx-engine/expand.ts`).
- **Constraints:** SQL only in `packages/db`; parameterised queries; existing trigram indexes; no new extension.
- **Verify:** unit (expansion), int (Testcontainers: T1 real cases), benchmark script output in the report.

### B-WP5.1 — fusion (builder; main reviews the math)
- **Goal:** `fuseLine(features[], weights) → { posterior[], pNone }` and `featuresFor(line, candidate, ctx)`,
  pure, in `packages/shared/src/rx-engine/fusion.ts`.
- **Decisions made:** f1–f15 definitions and ranges from RX-ENGINE §3 S4; log-sum-exp softmax; default weights
  file `fusion.defaults.ts`; null features `g(l)`.
- **Verify:** hand-computed fixtures (3 lines × 4 candidates), monotonicity properties (raising f1 never lowers
  that candidate's posterior), numeric stability tests (large scores).

### B-WP7.2 — report template (builder)
- **Goal:** `rx_report.typ` renders RX-REPORT §1 from `rxReportDocSchema` data; golden fixtures pass.
- **Constraints:** data as text only; no network; IBM Plex Sans Arabic only; ≤ 6 pages for 10 lines; grayscale
  printable; badges carry text.
- **Verify:** `pnpm --filter @wasfa/worker test -- documents`, the CI Typst compile job, render-time assertion.

## 5. Definition of done per package (adds to AGENT §8)
- Red tests for the root causes it owns are green; its scenario and chaos tests are in the suite.
- Engine packages: replay eval attached; gate report for WP5.
- Phase file Notes updated by the main session: migrations, numbers, deviations, carry-overs.
