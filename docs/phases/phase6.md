# Phase 6 — WhatsApp agent v2 and Rx Engine v2 ("never silent, reads anything, stays with the patient")

> **Outcome:** the WhatsApp agent becomes dependable infrastructure: every message gets an answer, every paid
> result arrives, no effect happens twice, and nothing it says about a medicine is invented. Prescription
> reading reaches a **measured** precision contract — at least 95 % of everything asserted is right in every
> difficulty stratum, including the hardest handwriting, and nothing uncertain is presented as certain. After
> an analysis the customer gets a full PDF report, a phone calendar file and answers grounded in their own
> result; fresh sessions start with «جديد»; and **Wasfa Companion** checks what the pharmacy dispensed, keeps
> the treatment plan, and reminds the patient inside WhatsApp.
>
> **Specs (read the section a task points to, not everything):** `docs/WA-AGENT-RUNTIME.md` (agent runtime,
> reliability, sessions, commands, attachments, guards), `docs/RX-ENGINE.md` (reading engine, accuracy
> contract, evaluation), `docs/RX-REPORT.md` (PDF, calendar, WhatsApp result), `docs/WA-COMPANION.md` (the new
> feature). Product rules that stay: `docs/WA-AGENT.md`, `docs/MEDICATIONS.md`. Project rules: `docs/AGENT.md`
> (§5 golden rules, §7 testing, §8 definition of done). Orchestration: `docs/phases/phase6-orchestration.md`.
>
> **Shape:** 11 work packages (WP0–WP10) in 3 releases on two parallel tracks plus a final gate. Each package
> is independently reviewable and has its own acceptance list. Each release is deployable on its own behind
> its flags.
>
> **Order (Decision 73):** by owner priority this phase runs **now**, before the remaining Phase 4 packages
> (WP4–WP8) and Phase 5. Phase 4 Release A/B work already merged is unaffected.

---

## 0. Scope

### In scope
1. **Land the in-flight work** as the baseline: PR #72 (full WhatsApp rx reading + timetable PDF), branch
   `feat/rx-likely-matches` (NEXT-TASKS T1: `likely` tier, shape candidates), the uncommitted turn-timeout fix
   on `fix/free-plan-credits`; PR #73 (homepage) merged or parked by the owner, not part of this phase's work.
2. **Agent reliability core:** streams with retries and dead-letter, BullMQ turn queue with coalescing,
   heartbeat lock with fencing, turn store and state machine, failure policy (no busy line, no auto-pause, no
   silence), exactly-once tools, outbox delivery of paid results, media hardening (timeouts, re-upload, HEIC,
   PDF, typed failure reasons).
3. **Agent restructure:** folder refactor of `apps/api/src/wa-agent`, pure logic into
   `packages/shared/src/wa-agent/*`, sessions («جديد»), command layer (`/analyze`, help menu, balance, report,
   schedule, voice, language, human, privacy …), attachment registry with handles, tool memory, WhatsApp
   formatting with bidi safety.
4. **Measurement first:** gold set protocol, eval scorer v2 (tiers, AP/CP/SER/coverage/ECE by stratum),
   recorded-model replay in CI, baseline report of v1.
5. **Rx Engine v2:** quality gate, master image and enhanced zoom crops, retrieval expansion (shape, confusion,
   ingredient path), evidence fusion with a null hypothesis, zoom re-read with blind reading, conditional
   cross-model adjudication, isotonic calibration, five tiers, field checks, result schema v2, learning signals
   and priors, shadow mode, release gate.
6. **Drug intelligence in the agent:** `resolveDrugName` (same engine), `lookup_medication`,
   `get_prescription`, `view_attachment`, drug and price grounding guards, prompt v2.
7. **Report v2:** full PDF report (timetable, cards with the handwriting crop, course checklist, pharmacist
   table, QR), `.ics` calendar, deterministic WhatsApp result sequence, web download.
8. **Wasfa Companion:** dispense check (barcode/box → database comparison), medicine cabinet with consent,
   personal schedule, opt-in window-bound reminders with dose log, cross-prescription safety net, voice briefing.
9. **Admin and observability:** turn traces in the inbox, health tab with counters and alerts, DLQ screen,
   simulator, replay, `rxEngine` and `companion` settings screens, engine gate reports.

### Explicitly out of scope
| Item | Where | Reason |
|---|---|---|
| Meta Cloud API migration | later | owner decision stands (Baileys); the runtime keeps the transport behind one interface so a later swap touches `transport/` only |
| Drug–drug interaction checking | not planned | no licensed interaction database (Decision 70) |
| Caregiver/family sharing of the cabinet | Phase 7 candidate | consent and privacy design for a second person needs legal review first |
| Proactive marketing messages | never on Baileys | anti-ban rules; Companion reminders are opt-in, window-bound service messages only |
| Training our own handwriting model | later | the fusion + calibration layer gets the gains now; a fine-tuned reader is evaluated when the gold set exceeds ~3,000 labelled lines |
| English UI of the signed-in app | Phase 5 | unchanged |

### Systems that must keep working (regression guard for every package)
Phone verification codes and WhatsApp sign-in (bridge `wa:inbound`, LID handling), the agent's commerce flows
(catalog, discounts, bank-transfer orders, receipts into the 4-eyes review queue), voice (STT/TTS), documents
(`create_document`), owner takeover and admin inbox, the web rx flow (upload → analysis → result → corrections →
learning votes), credits ledger (reserve → settle → release), rx eval runs, medication search and admin, the AI
router/kill switch/spend caps. **The full unit, integration and Playwright suites stay green at the end of every
package.**

---

## 1. Success measures

| Area | Target | How it is measured |
|---|---|---|
| No silent drop (I1) | 0 inbound customer messages without a reply/deferral/recorded policy state after 10 min | nightly SQL audit job → admin alert; chaos suite |
| Paid results (I3) | 100 % of analyses started on WhatsApp delivered to the chat (or waiting for the window, then delivered) | outbox audit query; chaos suite |
| Duplicate effects (I2) | 0 double charges/orders/coupons/analyses under retries, crashes, 2 replicas | chaos suite; ledger reconciliation query |
| Turn failures | < 1 % of turns end `failed_replied`; 0 "busy" lines for model errors | turn counters (WP9) |
| Latency | p95 inbound → first reply queued ≤ reply delay + 20 s (non-analysis turns); rx result p95 ≤ 90 s after the last page | turn traces; rx events |
| Grounding (I4) | 0 ungrounded drug names/prices in the scenario suite; production repairs < 2 % of turns, unrepaired 0 | guard counters |
| Commands | 0 false positives on the 2,000-sentence corpus; 100 % alias recall on the test table | property tests |
| Rx precision | AP ≥ 95 % and AP-LB ≥ 93 % in **every** stratum; CP ≥ 99 %; SER ≤ 1 %; numbers ≥ 98 %; detection ≥ 99 % (holdout) | `rx:gate` (RX-ENGINE §9) |
| Rx coverage | printed ≥ 98 %, clear ≥ 95 %, hard ≥ 85 %, very hard ≥ 65 % asserted | `rx:gate` |
| Calibration | ECE ≤ 0.03 | `rx:gate` |
| Rx cost | ≤ 4 model calls per analysis; mean cost ≤ `rxEngine.maxCostUsdMicros` | eval + `ai_usage` |
| Report | PDF render < 5 s p95; ≤ 6 pages for 10 medicines; delivered with the result in ≥ 99 % | worker metrics |
| Companion (tracked, not gated) | dispense checks/week, flagged share, cabinet opt-in, dose confirmation rate, 30-day retention | admin dashboard |

---

## 2. Owner prerequisites

| # | Item | Needed by |
|---|---|---|
| O1 | Decide the in-flight work: merge #72 and the T1 branch as the baseline (recommended); #73 is independent | WP0 (day 1) |
| O2 | Production evidence of the reported failures: agent log lines and dates/conversations of "can't see the image", "busy", "pipeline error" (EC2 access as in the production-access note) | WP0 |
| O3 | **Gold set:** ≥ 400 real prescriptions with consent, de-identified (patient/doctor names, phones masked), stratum quotas in RX-ENGINE §8; first 150 by the start of WP4, the rest by WP5 | WP3 → WP5 |
| O4 | **Two pharmacists** to label (and a third to adjudicate) using the eval sheet + database picker; estimated 6–8 hours per 100 prescriptions each | WP3 → WP5 |
| O5 | AI routes: a second vision model family available for `rx_adjudicate` (e.g. the Pro model on a different provider than `rx_verify`), and the budget for two recording runs of the gold set (the admin sees the estimate before running) | WP4 / WP5 |
| O6 | Decision on Companion reminders (opt-in, window-bound outbound service messages; Decision 86) — default off | WP8 |
| O7 | Legal review of the consent texts (cabinet, reminders), the `privacy` command wording, the dispense-check disclaimer | WP8 (production enablement, not build) |
| O8 | Credit price of a dispense check (default 1 light credit) and whether barcode-only checks stay free | WP8 |

---

## 3. Decisions (recorded in `docs/ARCHITECTURE.md` decision log, rows 73–88)

73. **Phase 6 runs before the rest of Phase 4 and Phase 5** (owner priority: the agent and prescription quality
    are the product).
74. **Agent turns are BullMQ jobs** (queue `wa-agent-turns`) processed by a Worker hosted in the api process;
    Redis streams are transport only; stream entries are acked after a durable hand-off; dead-letter
    `wa:agent:dlq`.
75. **No silent drop; failure becomes delay, not "busy".** The busy line is retired for model errors; failures
    are classified (transient, after-tools, empty, spend cap, AI off, permanent, policy); the agent never pauses
    a chat automatically.
76. **Exactly-once side effects** through idempotency keys bound to the turn (`wa_tool_effects`) and single
    transactions for claim + start + outbox route.
77. **Results of paid work are delivered through `wa_outbox`, also during an owner takeover pause** (not when
    blocked or disabled); window-closed results wait for the next inbound.
78. **Deterministic command layer before the model**, whole-message matching after Arabic normalisation;
    commands cost nothing and never reach the model.
79. **Sessions:** the model's memory is the current session; «جديد» or 12 h idle starts a new one; transcripts
    stay under retention; long-term memory is limited to preferences, routine and the consented cabinet.
80. **Attachment handles replace time windows;** HEIC and PDF are accepted on WhatsApp; failures carry typed
    reasons to the customer and the model.
81. **Drug and price grounding guards in code:** every drug name/price in a reply must be grounded in tool
    results, the session's analyses or an exact database key; one repair step, then neutralise.
82. **Rx accuracy contract = asserted precision per stratum** (AP ≥ 95 %, AP-LB ≥ 93 %, CP ≥ 99 %, SER ≤ 1 %)
    on a frozen, double-labelled holdout; coverage is the improving metric; a release that breaks any stratum is
    refused.
83. **Rx Engine v2 = evidence fusion + calibrated tiers:** retrieval union (trigram, alternatives, shape,
    confusion, ingredient), a log-linear model with a null hypothesis, zoom blind re-read, conditional
    cross-model adjudication, isotonic calibration; ≤ 4 model calls per analysis.
84. **Master image** (≤ 4096 px, q95) kept beside the processed page with the same retention and deletion, used
    only for code-made crops.
85. **Recorded-model replay evaluation in CI** for code-only engine changes; paid recordings only for prompt or
    model changes, admin-triggered.
86. **Companion reminders are opt-in, window-bound service messages** (sent only while the customer's last
    message is < 24 h old, reply-to-continue, capped, kill switch); the `.ics` calendar is the zero-risk path for
    everyone.
87. **Dispense check compares database facts** (ingredient set, strength, brand family), never image similarity;
    an unresolved box is "not sure", never "match".
88. **Engine code location:** pure algorithms in `@wasfa/shared/rx-engine/*` and `@wasfa/shared/wa-agent/*`;
    retrieval SQL in `@wasfa/db`; no new workspace package.

---

## 4. Releases, tracks and dependency graph

```
                    ┌──────────── Track W (agent: apps/api/src/wa-agent, bridge) ────────────┐
Release A           │ WP0 ─► WP1 ─► WP2 ───────────────────────────────┐                      │
"Never silent"      │   │                                               │                      │
                    │   │     ┌── Track R (engine: worker rx, shared rx-engine, db) ──┐        │
Release B           │   └───► WP3 ─► WP4 ─► WP5 ──────────────────────────► WP6 ◄────┘        │
"Reads anything"    │                                                        │                 │
Release C           │                                       WP7 ◄────────────┤ (needs WP5, WP2)
"Stays with the     │                                       WP8 ◄──── WP7, WP6, WP1           │
 patient"           │ WP9 grows with every package (observability, admin)                     │
Final gate          └───────────────────────────────────────────────────────► WP10 (needs all)
```
- WP0 first (baseline + reproducing tests). Then **Track W (WP1 → WP2)** and **Track R (WP3 → WP4 → WP5)** run
  in parallel: they touch different directories (see the file lists).
- WP6 needs WP2 (tools/guards structure) and WP5 (`resolveDrugName` on the fused engine).
- WP7 needs WP5 (result v2) and WP2 (composer). WP8 needs WP7 (schedule/ics), WP6 (resolver), WP1 (outbox).
- Migrations are numbered from `0032` in package order; a package that adds one owns the next free number when
  it starts and records it in Notes.
- Feature flags: `waAgent.runtime.v2` (WP1–WP2), `rxEngine.version` + `shadowPercent` (WP4–WP5),
  `waAgent.guards.*` (WP6), `rx.reportV2` (WP7), `companion.enabled` (WP8).

---

## 5. How the work is run (model orchestration — details in `phase6-orchestration.md`)

The main session (Opus) owns every decision listed in §3 and the specs, writes each brief, reviews each diff,
and personally implements the few parts where a subtle mistake is expensive: the failure-policy table, the
idempotency/transaction boundaries, the fusion/calibration math review, the grounding-guard repair contract.
`builder` (Sonnet) implements modules from briefs; `runner` (Haiku) does mechanical edits, moves and all
command runs; `scout` (Haiku) answers "where/how" questions. **Waves:** at most 3–4 builders at once, each in
its own worktree (`isolation: "worktree"`), one track per builder group, never `git stash` while builders edit.
Each WP below lists its **Agents** plan: step → tier → wave.

---

## WP0 — Baseline, forensics and red tests

**Specs:** WA-AGENT-RUNTIME §2 (root causes R1–R16).
**Main files:** none new except tests; merges.

### Steps
1. Commit the uncommitted turn-timeout fix (`wa-agent-turn.service.ts`, `tool-loop.ts`, its tests) on its own
   branch and PR (it is superseded by WP1, but it stops the bleeding today).
2. Merge the baseline per O1: #72, then `feat/rx-likely-matches` (rebase on `main`, regenerate the skill
   registry, resolve `agent-event-messages.ts` / `documents/data.ts` overlaps as NEXT-TASKS T0 describes).
3. Forensics (O2): read production logs for the three reported symptoms; map each occurrence to R1–R16 in Notes;
   anything unmapped becomes R17+ with a fix owner package.
4. **Red tests:** one failing scenario test per root cause R1–R16 (scenario harness skeleton from
   WA-AGENT-RUNTIME §15, fake provider), marked `todo-fix(WPn)`; they turn green in the package that fixes them.
5. Baseline numbers: count of busy lines, `rx_failed` events, media `other` rows, unanswered inbound rows over
   the last 30 days (SQL on production, aggregates only) → Notes.

### Agents
| Step | Tier | Wave |
|---|---|---|
| 1 commit/PR | runner (exact message) | 1 |
| 2 merges + conflict resolution | builder (conflicts need judgment), main reviews | 1 |
| 3 log forensics | scout (with the access note), main classifies | 1 |
| 4 harness skeleton | builder; 16 red tests: builder ×2 in parallel (R1–R8, R9–R16) | 2 |
| 5 SQL aggregates | runner (main writes the queries) | 2 |

### Acceptance
- [ ] Baseline merged; `main` green; T1 behaviour live (`likely` badge) behind its existing settings.
- [ ] Every reported production symptom is mapped to a root cause in Notes.
- [ ] 16 red scenario tests exist and fail for the documented reason.
**Done when:** the team can see every bug as a failing test.

---

## WP1 — Reliability core (Release A)

**Specs:** WA-AGENT-RUNTIME §4, §5, §9, §14.
**Main files:** `apps/api/src/wa-agent/{transport,turn,outbox}/*` (new), `apps/worker/src/wa-bridge/{agent-media,
agent-inbound,baileys-socket}.ts`, `apps/worker/src/rx/{events,job}.ts` (failure reasons, outbox route),
`packages/db/src/schema/wa-agent.ts` + migration (`wa_turns`, `wa_tool_effects`, `wa_outbox`, media status
columns), `packages/shared/src/wa-agent/failure.ts`, `packages/shared/src/schemas/wa-agent.ts`, i18n messaging
files, settings `waAgent.runtime/failures/delivery`.

### Steps
1. Migration and schema: `wa_turns`, `wa_tool_effects`, `wa_outbox`, `wa_messages.media_status`,
   `wa_messages.turn_id`; DATABASE.md rows.
2. `StreamConsumer` v2: ack after hand-off, delivery counts, DLQ, idempotent handlers.
3. Turn queue (BullMQ in api), debounce coalescing, drain loop, re-check after release.
4. Lock with heartbeat + fencing; fence checks on every turn-ending write.
5. Turn store + state machine; inbound rows linked only when a reply/failure reply is queued (fixes R7).
6. **Failure policy** (pure table in `packages/shared/src/wa-agent/failure.ts`) + retry ladder (timeouts
   included, R11) + tool-record fallback replies (R4, R13) + per-conversation failure-text rate limit (R6);
   remove the busy dedupe and the automatic pause (Decision 75).
7. Exactly-once tools: idempotency wrapper for every side-effecting tool; rx start = one transaction (claim +
   analysis row + outbox route) (R10).
8. Outbox + deliverer; `rx_done`/`rx_failed`/document/payment events routed through it; paid work bypasses the
   takeover pause (R5); typed rx failure reasons and truthful credit texts (R12).
9. Bridge media hardening: timeout, retries, re-upload, HEIC/HEIF and PDF documents accepted, typed reasons
   (R2, R15); orphan file cleanup on decline (R16).
10. Feature flag `waAgent.runtime.v2`; v1 path kept until WP10 removes it.

### Agents
| Step | Tier | Wave |
|---|---|---|
| failure-policy table, idempotency/transaction boundaries, fence rules | **main** (design + the pure table) | 1 |
| 1 migration + schema | builder | 1 |
| 2 stream consumer + DLQ | builder | 2 |
| 3–5 queue, lock, turn store | builder (one brief, sequential steps) | 2 |
| 9 bridge media | builder | 2 |
| 6 wiring of policy/ladder/fallbacks | builder | 3 |
| 7 idempotency wrapper + rx transaction | builder, main reviews line by line | 3 |
| 8 outbox + deliverer + worker reasons | builder | 3 |
| typecheck/lint/test runs, i18n key additions | runner | every wave |

### Acceptance
- [ ] Red tests R4–R16 green; chaos suite: provider timeouts at each step, 429 storm, Redis drop, crash after a
      tool ran, lock expiry, duplicate stream delivery, 2 replicas → 0 silent drops, 0 duplicate effects.
- [ ] A paid analysis whose turn failed after the tool ran is delivered (result + PDF) — also during an owner
      pause.
- [ ] HEIC photo, PDF prescription, image-as-document and a broken download each produce the right outcome.
- [ ] DLQ receives a poison entry after 5 deliveries; admin can replay it (API; screen in WP9).
**Tests:** failure-policy table tests, lock/fencing unit + int (Testcontainers Redis), stream consumer int,
outbox int, idempotency int (repeat each tool 3× → one effect), bridge media units with fake downloads.
**Security:** fencing prevents a stale holder from sending; DLQ payloads contain ids only; no message text in
traces; tool keys hashed.
**Done when:** Release A part 1 deployable behind `waAgent.runtime.v2`.

---

## WP2 — Agent restructure, sessions, commands, attachments, formatting (Release A)

**Specs:** WA-AGENT-RUNTIME §3 (layout), §6, §7, §8, §11, §12.
**Main files:** `apps/api/src/wa-agent/**` (moves), `packages/shared/src/wa-agent/{normalize,commands,
drug-tokens,format,bidi,split}.ts`, `packages/shared/src/i18n/*messaging*` (command aliases and texts),
migration (`session_id`, `session_started_at`, `wa_sessions`, attachment handle/set columns), settings
`waAgent.sessions/commands/media`.

### Steps
1. **Refactor without behaviour change** (first commit of the WP): move files into `transport/ conversation/
   commands/ turn/ agent/ compose/ rx/ outbox/`; split `wa-agent-turn.service.ts`; update imports and the
   module; full suite green before anything else changes.
2. Sessions: schema, `session.service.ts`, history and summary per session, idle rollover, what survives (§6).
3. Command layer: normaliser + matcher (pure, property-tested), registry from i18n aliases, router before the
   queue, handlers: `new`, `analyze` (+ `awaiting_rx` state, caption trigger), `help` + numbered menu,
   `balance`, `report`, `voice`, `lang`, `human`, `privacy` (confirmation + deletion + audit); `schedule`,
   `meds`, `remind` registered but answering «قريبًا» until WP8.
4. Attachment registry: handles, sets (burst ≤ 120 s), statuses, prompt block, `view_attachment` tool,
   `analyze_prescription({ set | handles })` with server validation (R1, R3).
5. Tool memory: `meta.toolNotes` + history rendering (R1); typed tool results with `explain` texts (R12).
6. Composer: WhatsApp formatter, bidi isolation, splitter, templates; all deterministic messages moved to it.
7. Rx flow on WhatsApp: start line, progress, result sequence hook (full report in WP7).

### Agents
| Step | Tier | Wave |
|---|---|---|
| target layout + module boundaries | **main** (writes the move map) | 1 |
| 1 file moves + import fixes | runner (exact move map), builder only if the module wiring breaks | 1 |
| 3 normaliser/matcher (pure) + property tests | builder | 2 |
| 2 sessions | builder | 2 |
| 4–5 attachments + tool memory | builder | 2 |
| 6 composer (pure) | builder | 3 |
| 3 handlers + router wiring | builder | 3 |
| alias tables (AR/EN) in i18n | runner (main supplies the list) | 3 |

### Acceptance
- [ ] No file in `apps/api/src/wa-agent` above 300 lines; the old flat files are gone; suite green after step 1
      alone.
- [ ] «جديد» starts a clean session: the next answer does not reference earlier context (scenario test), an
      in-flight analysis still arrives; `/analyze` with a photo starts an analysis with **no model call**.
- [ ] Red tests R1–R3 green; the model never says it cannot see an image that is `ready` (scenarios with 1, 3
      and 6 images, a PDF, an old image, a second request).
- [ ] Command corpus: 0 false positives; numbered menu works; `privacy` deletes with confirmation and audits.
- [ ] Mixed Arabic/Latin lines render correctly in WhatsApp (manual check on Android + iOS, screenshots in
      Notes).
**Tests:** normaliser/matcher properties, session rollover, attachment validation (wrong session/handle →
refusal), composer snapshots, scenario transcripts for every command.
**Security:** handles scoped to the session; `privacy` rate-limited and confirmed; commands audited where they
change data; no user id ever accepted from the model.
**Done when:** Release A deployable (WP0 + WP1 + WP2 + WP9 part A).

---

## WP3 — Measurement: gold set, scorer v2, replay, baseline (Release B, Track R — starts after WP0)

**Specs:** RX-ENGINE §1, §8, §9.
**Main files:** `packages/shared/src/evals.ts` (scorer v2), `apps/worker/src/eval/*` (strata, recordings,
replay, gate), `packages/db/src/schema/evals.ts` + migration (`stratum`, `split`, `ai_eval_recordings`),
`apps/worker/scripts/{rx-fit,rx-gate}.ts`, admin evals screens (strata, tiers, curves), CI job `rx-replay`.

### Steps
1. Eval sheet v2: `stratum`, `drugId` (database picker in the admin import preview), `split`; import validates
   quotas.
2. Scorer v2: tiers, CP/AP/AP-LB (Wilson)/SER/coverage/numbers/detection/top-3/ECE per stratum; precision-
   coverage curves; v1 results scored through the tier adapter.
3. Recordings: save every model response of a run (`ai_eval_recordings`), replay mode in `analyzeImages`
   (provider stub returning recorded responses, keyed by image hash + prompt hash + route).
4. `rx:gate` (holdout, RX-ENGINE §9 rules, markdown + JSON report) and `rx:fit` skeleton (fits come in WP5).
5. CI job: replay eval on the dev split for PRs touching `rx-engine`, `drug-matcher`, `rx-retrieval`,
   `apps/worker/src/rx` (fails on AP/SER regression); recordings stored as a CI artifact pulled from R2
   (de-identified images never leave the private bucket; CI uses recordings + hashes, not images).
6. **Baseline:** label the first 150 (O3/O4), record v1 on them, publish the baseline per stratum in Notes.

### Agents
| Step | Tier | Wave |
|---|---|---|
| metric definitions + gate rules review | **main** | 1 |
| 2 scorer v2 (pure) + tests | builder | 1 |
| 1 sheet v2 + import | builder | 1 |
| 3 recordings + replay | builder | 2 |
| 4–5 gate script + CI job | builder (script), runner (CI yaml from the brief) | 2 |
| 6 recording run + baseline report | runner (commands), main reads the numbers | 3 |

### Acceptance
- [ ] A replay run of the dev split reproduces the recorded run's scores exactly (determinism test).
- [ ] CI replay job runs in < 5 min with no provider call (network blocked in the job).
- [ ] Baseline v1 numbers per stratum recorded in Notes (honest, whatever they are).
**Done when:** every later engine change is measured, not guessed.

---

## WP4 — Rx Engine v2, evidence (Release B, Track R)

**Specs:** RX-ENGINE §3 (S0–S3, S5), §4, §5, §6.
**Main files:** `apps/worker/src/images/{quality,heic,process-image}.ts`, `apps/worker/src/rx/{crop,analyze,
prompts}.ts`, `packages/db/src/{rx-retrieval,drug-matcher}.ts`, `packages/shared/src/rx-engine/{confusion,
distance,expand}.ts`, `packages/shared/src/schemas/rx.ts` (extraction and verify v2), `skills/prescription-
analysis/SKILL.md` (+ `build:skills`), migration (`rx_pages.master_key`, `rx_confusion_counts`,
`drug_usage_stats`, `drug_cooccurrence`).

### Steps
1. S0: HEIC decode, quality score (Laplacian variance, exposure, resolution), reasons; `rxEngine.quality`
   settings; quality result on the analysis row and in events (the agent uses it in WP2/WP7 flows).
2. S1: master image stored and deleted with the page; crop v2 (name + line crops, CLAHE, unsharp, Lanczos
   upscale to ≥ 40 px text).
3. S2: extraction schema additions + skill update (name box, script, letter estimate, rotation, header
   signals, handwriting protocol); rotation correction before crops.
4. S3: retrieval union (`rx-retrieval.ts`): T1 shape, confusion expansion (beam ≤ 24, exact `brand_key` +
   trigram), ingredient path, strength-in-family; per-line latency ≤ 150 ms (benchmark test on the full DWA
   import).
5. Confusion model: seed table, weighted Damerau-Levenshtein (pure, fast), learning counts table and nightly
   rebuild job; priors tables and nightly jobs (aggregates only).
6. S5: verify v2 schema (blind reading → letters → numbers → choice → confidence), prompt with context block;
   v1 answer adapter.
7. Everything behind `rxEngine.version = v2`; v1 path untouched.

### Agents
| Step | Tier | Wave |
|---|---|---|
| prompt/skill wording for S2 and S5 (accuracy-critical) | **main** writes; builder wires | 1 |
| 1 quality + HEIC | builder | 1 |
| 5 confusion + distance (pure) + property tests | builder | 1 |
| 2 master image + crops | builder | 2 |
| 4 retrieval SQL + benchmark | builder | 2 |
| 3, 6 schemas + adapters + pipeline wiring | builder | 3 |
| priors/confusion nightly jobs | builder (copies the retention-job pattern) | 3 |
| migrations, skill registry rebuild, test runs | runner | every wave |

### Acceptance
- [ ] On the dev split (replay where possible): top-12 candidate recall of the correct drug ≥ 97 % for lines
      whose drug is in the database (all strata) — the ceiling the fusion step can reach.
- [ ] Quality gate flags ≥ 90 % of the "photographed badly" gold items as `fair/poor`, and < 5 % of good ones.
- [ ] Retrieval p95 ≤ 150 ms/line on the full import; ≤ 4 model calls per analysis in all runs.
- [ ] The NEXT-TASKS T1 real cases (Ripan, Bebra 20, Glbimet 5, Motdyl) reach the right family in the top 3.
**Security:** HEIC decoder under the pixel limit and a time cap; master image never leaves the private bucket;
nothing new in logs.
**Done when:** the evidence is there; deciding with it is WP5.

---

## WP5 — Rx Engine v2, decision (Release B, Track R)

**Specs:** RX-ENGINE §3 (S4, S6–S10), §6, §8–§10.
**Main files:** `packages/shared/src/rx-engine/{fusion,calibration,tiers,fields}.ts`, `apps/worker/src/rx/
{pipeline,analyze}.ts`, `apps/worker/scripts/rx-fit.ts`, `packages/shared/src/schemas/rx.ts` (result v2),
`packages/ui/src/RxTable.tsx`, `apps/web/src/components/rx/*` (tier badges, `uncertain` choice UI, crops),
`apps/api/src/wa-agent/rx/rx-messages.ts`, `apps/worker/src/documents/data.ts`, settings `rxEngine`, new AI
task `rx_adjudicate` (router + seed + admin routes list).

### Steps
1. Fusion (pure): features f1–f15, softmax with null hypothesis, default weights; exhaustive unit tests with
   hand-computed cases.
2. Contest detection + `rx_adjudicate` (one batched call, different model family, ≤ 6 lines).
3. Calibration (isotonic, pure) + tiers per stratum class + field checks (S9).
4. Result schema v2 + v1 adapter in every reader (web, WhatsApp, PDF, admin, history).
5. `rx:fit`: weights (L2 multinomial logistic regression, implemented in TS with a small fixed-iteration
   optimiser, no new heavy dependency), calibration table, thresholds; output file + admin import screen with
   the gate report attached.
6. UI: tier badges, `uncertain` "X or Y" picker (existing correction flow, candidates first), the line crop on
   tap; WhatsApp text and PDF use tiers.
7. Learning: corrections/confirmations → votes, confusion counts, usage stats, co-occurrence.
8. Shadow mode on production (`shadowPercent` 20 for a week), compare tiers v1 vs v2 in the admin.
9. Full gold set recorded (O3 complete), fit on dev, **gate on holdout**; switch `rxEngine.version = v2` only
   when the gate passes; otherwise iterate (prompt, features) with replay and record what changed in Notes.

### Agents
| Step | Tier | Wave |
|---|---|---|
| feature set, null hypothesis, contest rules, threshold policy | **main** (spec is fixed; main reviews the math line by line) | 1 |
| 1 fusion (pure) | builder | 1 |
| 3 calibration + tiers + fields (pure) | builder | 1 |
| 5 rx:fit optimiser + exports | builder | 2 |
| 2 adjudication task + router + seed | builder | 2 |
| 4 schema v2 + adapters across readers | builder ×2 (worker/shared; web/ui) | 2 |
| 6 web/WhatsApp/PDF tier display | builder | 3 |
| 7 learning signals | builder | 3 |
| 8–9 shadow, recordings, fit, gate runs | runner (commands), **main** decides promotion | 4 |

### Acceptance
- [ ] `rx:gate` passes on the holdout: AP ≥ 95 % and AP-LB ≥ 93 % in every stratum, CP ≥ 99 %, SER ≤ 1 %,
      numbers ≥ 98 %, detection ≥ 99 %, ECE ≤ 0.03, p95 ≤ 60 s, cost within cap. Gate report in Notes.
- [ ] Coverage targets met, or the gap per stratum is recorded with the next lever (the AP floor is never
      traded for coverage).
- [ ] Shadow week: no stratum class where v2 asserts more wrong names than v1 on adjudicated samples (50 lines
      reviewed by a pharmacist).
- [ ] Old (v1) results render everywhere unchanged.
**Security:** adjudication sees crops only; model outputs zod-validated with repair; weights/calibration
imports audited and versioned; settings changes need fresh auth.
**Done when:** Release B core deployable (WP3 + WP4 + WP5).

---

## WP6 — Drug intelligence in the agent (Release B)

**Specs:** WA-AGENT-RUNTIME §8.2, §10; RX-ENGINE §7.
**Main files:** `packages/db/src/rx-retrieval.ts` (`resolveDrugName`), `packages/shared/src/wa-agent/
drug-tokens.ts`, `apps/api/src/wa-agent/agent/{tools/*,guards/*,prompt/*}`, website assistant cards
(`medicationCardsFor` → resolver), `/medications` search "did you mean".

### Steps
1. `resolveDrugName(db, text, ctx)`: S3 + S4 without image features; returns tiered entries + "did you mean".
2. Tools: `lookup_medication`, `get_prescription`; `search_medications`/`medication_alternatives` on the
   resolver.
3. Grounding guards (drug, price, dose) with the one-repair contract and counters.
4. Prompt v2: rules for tools first, «لما تشك اسأل قاعدة البيانات», handles, tool notes, tier vocabulary;
   persona untouched.
5. Assistant (web) cards and medication search use the resolver (one engine everywhere).

### Agents
| Step | Tier | Wave |
|---|---|---|
| guard repair contract + prompt v2 text | **main** | 1 |
| 1 resolver | builder | 1 |
| 3 token extraction (pure) + guards | builder | 1 |
| 2 tools | builder | 2 |
| 5 web/search reuse | builder | 2 |

### Acceptance
- [ ] Scenario suite: misspelt Latin, Arabic-script, ingredient-only and look-alike names resolve to database
      names; an invented name in a scripted model draft is repaired or neutralised (0 reach the customer).
- [ ] Follow-up questions about the last analysis are answered from `get_prescription` (doses as written).
- [ ] Price in a reply always equals a tool result (property test over scripted drafts).
**Done when:** Release B deployable (WP3–WP6 + WP9 part B).

---

## WP7 — Report v2, calendar and the WhatsApp result (Release C)

**Specs:** RX-REPORT (all).
**Main files:** `apps/worker/src/documents/{rx-report-data.ts,templates/rx_report.typ}`, `packages/shared/
src/rx-ics.ts`, `apps/api/src/wa-agent/rx/{rx-delivery,rx-messages}.ts`, web result page download, `rx_reports`
table (migration), settings `rx.reportV2`.

### Steps
1. Data builder (zod `rxReportDocSchema`) from result v2 + DB; crops from the master image into the render dir.
2. Typst template: header + QR, summary, timetable grid, cards with crop, course checklist, pharmacist table,
   notes, footer; Arabic shaping and bidi checks.
3. `.ics` generator (pure) + validation.
4. WhatsApp result sequence (summary → PDF → ics → optional voice → next steps) with the render-failure path.
5. Web: «تحميل التقرير PDF» (same job, cached per result version, regenerated after corrections).

### Agents
| Step | Tier | Wave |
|---|---|---|
| report layout decisions (sections, what is never shown) | **main** (spec fixed; reviews the first render) | 1 |
| 2 Typst template | builder (frontend-design sensibility; golden renders) | 1 |
| 1 data builder | builder | 1 |
| 3 ics (pure) | builder | 1 |
| 4–5 delivery + web download | builder | 2 |

### Acceptance
- [ ] Golden PDFs for the 5 fixtures pass text/shaping/bidi/page-budget checks; render < 5 s.
- [ ] The `.ics` imports into Google Calendar and iOS Calendar with the right local times (manual check,
      screenshots in Notes); re-import does not duplicate.
- [ ] On WhatsApp the summary, PDF and calendar arrive in order for 1-, 6- and 12-line prescriptions.
**Done when:** the result on WhatsApp is at least as complete as the website's.

---

## WP8 — Wasfa Companion (Release C)

**Specs:** WA-COMPANION (all).
**Main files:** `apps/api/src/wa-agent/companion/*`, `apps/api/src/companion/*` (web endpoints),
`apps/worker/src/companion/*` (scheduler, running-out job), `packages/db/src/schema/companion.ts` + migration,
`packages/shared/src/companion/*` (routine anchoring, dose reply parsing, dispense comparison — pure),
`apps/web/src/app/(app)/medications/cabinet/*`, settings `companion`, task `rx_box`.

### Steps
1. Schema + consent model; scoped repos; DATABASE.md.
2. Dispense check: barcode path, box read (`rx_box`), comparison matrix (pure), messages, optional report page.
3. Cabinet: consent prompt after analysis, add/stop/finish, web page.
4. Routine + anchored schedule; `schedule` and `meds` commands go live.
5. Reminders (behind O6): window-bound scheduler through the outbox, dose replies, snooze, caps, kill switch.
6. Safety net: duplicate ingredient/category across the cabinet, course end, running out + alternatives.
7. Voice briefing.

### Agents
| Step | Tier | Wave |
|---|---|---|
| dispense matrix + window rule + consent gating review | **main** | 1 |
| 1 schema | builder | 1 |
| 2 comparison (pure) + barcode path | builder | 1 |
| 4 routine anchoring + dose parsing (pure) | builder | 1 |
| 2 box read task + messages | builder | 2 |
| 3 cabinet API + web page | builder | 2 |
| 5 scheduler + replies | builder | 3 |
| 6–7 safety net + voice | builder | 3 |

### Acceptance
- [ ] Dispense matrix: every outcome × path covered by tests; an unresolved box never yields ✅.
- [ ] No course, reminder or routine is stored without a consent row (test); revocation stops everything.
- [ ] Reminders: none sent at window + 1 s; resume after the next inbound; caps and kill switch hold (tests);
      off in production until O6.
- [ ] Full journey scenario (analysis → consent → routine → reminder → ✓ → box photo → ⚠️) green.
**Security:** owner scoping on every table; health data never in analytics; reminder sends audited by count,
not content.
**Done when:** Release C deployable (WP7 + WP8 + WP9 part C).

---

## WP9 — Admin and observability (grows with A, B, C)

**Main files:** `apps/web/src/app/admin/whatsapp/agent/*` (Health, DLQ, Simulator tabs; trace panel in the
inbox), `apps/web/src/app/admin/ai/evals/*` (strata, tiers, curves, gate reports), admin settings screens for
`rxEngine` and `companion`, `apps/api/src/admin/*` endpoints, alert kinds (migration), RBAC rows.

- **Part A (with WP1–WP2):** turn trace panel, Health tab (counters, 24 h/7 d), DLQ list + replay/discard,
  alerts (failure rate, p95, DLQ, media failures, spend cap), the nightly no-silent-drop audit, simulator,
  replay dry-run, sessions/commands settings.
- **Part B (with WP3–WP6):** eval strata/tier views, precision-coverage curves, gate reports, weights and
  calibration import with diff and fresh auth, `rxEngine` settings, shadow comparison, guard counters.
- **Part C (with WP7–WP8):** report settings, Companion settings and dashboard (§6 measures).
**Agents:** builder per part (UI follows `DESIGN-SYSTEM.md`, existing admin patterns), runner for RBAC/i18n
rows; main reviews screens at 360 px and desktop.
**Acceptance:** each part's screens work with permissions (`wa_agent.read/write/inbox`, `ai.evals`,
`settings.write`), axe clean, audited writes.

---

## WP10 — Final gate

### Steps
1. Full suites + chaos + load (200 concurrent conversations) on the release candidate.
2. `rx:gate` on the holdout with the production configuration; report attached.
3. `/security-review` of the phase diff; SECURITY.md endpoint register and threat rows (commands, privacy
   deletion, outbox, DLQ replay, simulator, weights import, Companion tables, reminders); `pnpm audit --prod`.
4. Docs: DATABASE.md, ARCHITECTURE.md (decisions 73–88 confirmed or amended), REUSE-INDEX.md (every new shared
   helper), WA-AGENT.md (points to the runtime spec), MEDICATIONS.md (engine v2 pointer), DOCKER-GUIDE.md (new
   queues, HEIC decoder, envs), ROADMAP.md status, an operator runbook section in `WA-AGENT-RUNTIME.md` (DLQ,
   replay, failure alerts, gate).
5. Rollout: A → B → C, each behind its flags; shadow week before `rxEngine.version = v2`; 24 h and 7-day checks
   after each release; remove the v1 agent path one release after A is stable.

### Phase 6 final checklist
- [ ] All WP acceptance lists ticked or carried over with a written reason.
- [ ] §1 success measures met (rx precision by the gate; reliability by chaos + 7 days of production counters).
- [ ] Every root cause R1–R16 (+ any R17+) closed with its test.
- [ ] Docs updated; decision log complete; carry-overs listed.

---

## 6. Security checklist for new surfaces (summary; rows go into SECURITY.md)
| Surface | Main threats | Controls |
|---|---|---|
| Command layer | false triggers, spam, destructive commands | whole-message match, rate limits, confirmations, audit |
| Turn queue / lock / outbox | double effects, stale holders, lost results | idempotency keys, fencing, transactions, DLQ |
| Media (HEIC, PDF, documents) | bombs, parser exploits, polyglots | pixel/page/time caps, magic bytes, re-encode in the worker |
| Grounding guards | model invents drugs/prices | code checks + repair + neutralise, counters |
| Eval recordings, weights import | tampering with the engine | admin-only, fresh auth, versioned, gate report required |
| Companion | health data exposure, unwanted messages | consent rows, owner scoping, window-bound caps, kill switch |
| Simulator / replay | effects in production | sandbox account, dry-run, no send |

## 7. Open questions (owner)
1. Merge #72 and the T1 branch as the baseline now (recommended)?
2. Can we get the gold set (≥ 400 de-identified prescriptions with consent) and two pharmacists' time? Without
   it the 95 % contract cannot be proven, only claimed.
3. Which second model family for `rx_adjudicate` (needs a provider key)?
4. Companion reminders: allow opt-in, window-bound reminders on the Baileys number (Decision 86), or ship the
   calendar file only?
5. Dispense check price: 1 light credit, free for barcode-only?
6. Auto new session after 12 h idle — keep, or only on «جديد»?
7. Should paid results be delivered during an owner takeover pause (recommended yes, Decision 77)?

---

## Notes
*(Filled during execution: forensics mapping, baseline numbers, migration numbers, gate reports, deviations with
reasons.)*

### Owner decisions (2026-10-31, before Release A)
- **O1 / Q1:** merge PR #72 (`feat/wa-rx-detail`) and `feat/rx-likely-matches` as the baseline.
- **Q6:** auto new session after 12 h idle stays on (`waAgent.sessions.idleHours = 12`).
- **Q7:** paid results are delivered during an owner takeover pause (`waAgent.delivery.paidWorkBypassesTakeover =
  true`).
- **Scope addition:** HEIC/HEIF must work in Release A. The HEIC *decode* part of RX-ENGINE §3 S0 moves into WP1
  step 9 (decode only, under the pixel limit and a time cap); the quality score/gate stays in WP4.
- Everything new runs behind `waAgent.runtime.v2` (default `false`); enabling it in production is the owner's call
  after the live smoke test.
- Release A scope: WP0, WP1, WP2, WP9 part A only. Track R (WP3–WP5), WP6, WP7, WP8 are not started in this release.
- Delivery: stacked PRs `phase6/wp0-baseline` → `phase6/wp1-reliability` → `phase6/wp2-restructure` →
  `phase6/wp9a-admin`; each merged only after the owner says so (merging to `main` deploys production).

### WP0 — forensics (2026-10-31, read-only, aggregates only)
Log window: production containers were recreated 2026-10-29 14:11 UTC (json-file, 5 × 10 MB), so logs cover
2026-10-29 14:11 → 2026-10-31 05:40 UTC only; older symptoms are visible only in the database (baseline below).
v1 does not log the busy line itself or reply texts, so customer-facing texts are inferred from the DB.
| Evidence | Count | Root cause |
|---|---|---|
| `Agent turn failed` reason `AiProviderError`, tools `[]` (2026-10-30 18:38); same hour 2 images, 0 readings | 1 | R11 (no retry before tools) → R4 (busy line + pause); consistent with R1 for the image symptom |
| worker `rx analysis failed` step `read` `AiProviderError` → api `rx_failed` follow-up (2026-10-29 17:39) | 1 | R11 (worker read step) + R12 (generic `rx_failed` text) |
| DB: busy lines 2026-10-28/29/30, 3 different chats | 3 | R4; each was followed by the auto-pause |
| DB: 4 inbound rows unanswered > 10 min, all while the chat was paused | 4 | R4 → R5/R6 (pause after busy) |
| DB: inbound media `kind=other`, no stored file | 4 | R2 (unsupported type or failed download; v1 stores no reason) |
| worker `Job failed` `alerts.sweep_pending` "Custom Id cannot contain :" (every run, ×3 attempts) | 7,107 | **R17 (new):** the repeatable alert sweep never runs, so admin alerts are not swept/escalated. Owner: WP9A (alerts) |
| bridge `WhatsApp alert dropped` reason `disabled` | 24 | R18 candidate: probably the configured alert opt-out; verify in WP9A |
| Baileys `stream:error` 503 + reconnect | 3 / 7 | R19 candidate (transport noise, no customer impact found); watch in the Health tab |
No log evidence either way for R1/R2/R15 download paths (v1 logs no media download lines), R7–R10, R14, R16;
they are covered by the red tests. Production images were built from `99d6782`; the turn-timeout stop-gap is
not deployed yet (it ships with the WP0 PR).

### WP0 — baseline (production DB, last 30 days, run 2026-10-31)
| Measure | Value |
|---|---|
| Inbound / outbound / owner rows | 85 / 149 / 13 (6 chats) |
| Busy lines | 3 (3 chats; one per day on 10-28, 10-29, 10-30) |
| rx analyses (all / from WhatsApp) | done 82 / 10 · failed 2 / 1 · refunded 5 / 0 |
| Inbound media | image/jpeg 20 · audio/ogg 3 · `other` 4 (all without a stored file) |
| Inbound rows by status | all 85 `received` (v1 never sets another status on inbound) |
| Unanswered inbound (> 10 min, no agent/owner row) | 4 (3 chats), all while paused |

### WP1 — design decisions (main session)
- Failure policy: `packages/shared/src/wa-agent/failure.ts` (+ 43 table/property tests). `effectsRan` counts
  only side-effecting tools; a failure after read-only tools is retried as transient (amends §5.4 "any tool").
- Idempotency, rx-start transaction, fencing and linking rules: `WA-AGENT-RUNTIME.md` §17. Deviations: fence
  counter lives in Postgres (`wa_conversations.turn_fence`), not Redis, so the check is atomic with the writes;
  the analysis id is derived from the idempotency key so the existing reservation key makes retries free of
  double charges without touching credit code; enqueue failure no longer fails the analysis (reconciler).
- `waAgent.runtime.jobAttempts` counts retries after the first run (20/60/180 s).
- Scenario tests are typed TypeScript, not YAML (§15): no new dependency, refactor-safe.
- WP2 note: the table name `wa_sessions` is taken (Baileys auth state); agent sessions use `wa_agent_sessions`.
- Migration numbers: `0032_wa_agent_runtime` (WP1).
