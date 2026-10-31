# WhatsApp agent v2 — runtime, reliability, sessions, commands (spec, 2026-10-31)

> Supersedes the runtime parts of `WA-AGENT.md` §1, §4 and §8a (the product rules — identity, persona, honesty,
> discounts, owner takeover, voice, anti-ban — stay as written there). Phase plan: `docs/phases/phase6.md`.
> Rules: `AGENT.md` §5 (zod at the boundary, scoped repos, ledger-only credits, typed errors with references,
> redacted logs, denial-of-wallet guards, admin-controlled values, i18n).

---

## 1. Invariants (every design choice below serves one of these; each has a test)

| # | Invariant | Meaning |
|---|---|---|
| I1 | **No silent drop** | every inbound customer message ends in a reply, a deliberate deferral the customer was told about, or a recorded, alerted terminal state. Never nothing. |
| I2 | **Exactly-once effects** | a retried turn never charges twice, never creates two orders, two coupons, two analyses or two documents. |
| I3 | **Paid work is delivered** | the result of anything the customer paid for reaches them, whatever happens to the turn that started it. |
| I4 | **No invented medicine** | a drug name, ingredient, strength or price in a reply comes from the database or a tool result of this conversation; code checks it. |
| I5 | **Deterministic first** | commands, status, result messages, failure messages are code + i18n, not model prose. The model handles conversation, not plumbing. |
| I6 | **Bounded** | every wait has a timeout, every loop a cap, every queue a dead-letter, every cost a cap. |
| I7 | **Observable** | every turn has a trace; every failure has a cause class, an error reference and a counter. |

## 2. Root causes found in v1 (2026-10-31 code audit) and where v2 fixes them

| # | Symptom | Cause (v1) | Fix |
|---|---|---|---|
| R1 | "I can't see your prescription" | `analyze_prescription` takes no args and picks the newest unused image ≤ 15 min old; tool results are not kept in history, so a second attempt gets `no_image` | attachment registry with handles (§7), tool memory in history (§8.3) |
| R2 | same | PDFs never read by the tool; HEIC/GIF/oversize/failed downloads become `other` and the model only sees «[مرفق غير مدعوم]» | media hardening (§4.2), PDF + HEIC accepted, explicit failure reasons to the model and the customer |
| R3 | same | only the current turn's newest 4 images are shown; older pictures are «[صورة]» text | registry lists every usable attachment; pages beyond 4 are grouped, not dropped |
| R4 | "server is busy" | one canned line for spend cap, AI off and **any** model/timeout error; also raises a handoff and pauses the chat | failure policy (§5.4): classify, retry, defer, never pause automatically |
| R5 | busy → result never arrives | the pause makes `wa-outbound` refuse the later `rx_done`; the PDF is deleted | paid results bypass the takeover pause (Decision 77), outbox delivery (§9) |
| R6 | silence after the first busy | per-day busy dedupe returns before replying and before the handoff | removed; failure messages are rate-limited per conversation, never skipped (§5.4) |
| R7 | silence | inbound rows are marked answered before the model runs; later exceptions are uncaught | turn store (§5.2): rows are linked to a turn only when its reply (or failure reply) is queued |
| R8 | slow replies for everyone | the inbound stream consumer runs turns inline, serially, per API replica | turns are BullMQ jobs with concurrency (§4.3) |
| R9 | double turns | the 180 s lock is set once while a holder may run 4 rounds | lock with heartbeat and fencing token (§4.4) |
| R10 | double charge, lost result | `rx.create` then a Redis/DB failure releases the media claim while the reading runs | idempotency keys per tool call (§5.3), claim + start in one transaction, outbox |
| R11 | timeouts become busy | only `AiProviderError` retried; step timeouts not | retry ladder for timeouts too, before any tool ran (§5.4) |
| R12 | "pipeline error" | `rx_failed` text sent for every worker failure (wrong refund claim, no reason); raw tool codes reach the model | typed failure reasons → deterministic texts (§9.2); tool results are typed outcomes with a model-facing explanation (§8.2) |
| R13 | ghost replies | an empty final answer sends nothing | empty answer → deterministic fallback from tool records (§5.4) |
| R14 | stuck messages | stream entries are XACKed even when processing throws; no dead-letter | ack after durable hand-off; retries with attempts; `wa:agent:dlq` (§4.1) |
| R15 | stalls | Baileys media download has no timeout | 30 s timeout, 2 retries, re-upload request for expired media (§4.2) |
| R16 | orphan files | imported files not removed on decline | cleanup on decline + nightly orphan sweep |

## 3. Shape v2

```
customer ──WhatsApp──▶ wa-bridge (worker, Baileys)                         ── transport only ──
                         │ download (timeout, retry, re-upload) → R2 wa_media, typed failure reasons
                         ▼
                   wa:agent:in (stream) ──▶ api InboundIngestor ── persist row (idempotent on waMessageId)
                                                   │            ── command? → CommandRouter (no model)
                                                   ▼
                                    BullMQ queue `wa-agent-turns` (debounced per conversation = coalescing)
                                                   │  Worker in the api process, concurrency N
                                                   ▼
                                     TurnRunner (lock + heartbeat + fencing)
                                       ├ TurnStore  (wa_turns: state machine, trace, idempotency)
                                       ├ Context    (session history, attachments registry, tool memory, profile)
                                       ├ Agent loop (packages/ai tool loop, step budgets, retry ladder)
                                       ├ Guards     (drug grounding, price grounding, length, PII)
                                       └ Composer   (WhatsApp formatting, splitting, voice) ──▶ wa:agent:out
worker events (rx, documents, payments, companion) ──▶ wa_outbox ──▶ Deliverer ──▶ wa:agent:out
```

### Folder layout (`apps/api/src/wa-agent/`, refactor of the current flat set)
```
transport/     stream-consumer.ts (retry + DLQ) · inbound-ingestor.ts · sent.consumer.ts · outbound.service.ts · dlq.service.ts
conversation/  conversation.repo.ts · session.service.ts · history.ts · attachments.service.ts · profile.service.ts · state.service.ts
commands/      normalize.ts · registry.ts · command-router.ts · handlers/*.ts (new, analyze, help, balance, report, …)
turn/          turn.queue.ts · turn-runner.ts · turn.store.ts · lock.ts · failure-policy.ts · retry-ladder.ts · fallback-replies.ts
agent/         prompt/*.ts · tools/*.ts · tool-memory.ts · guards/{drug-grounding,price-grounding}.ts
compose/       whatsapp-format.ts · bidi.ts · splitter.ts · templates.ts
rx/            agent-rx.service.ts · rx-delivery.ts · rx-messages.ts · quality-prompt.ts
companion/     (WA-COMPANION.md)
commerce/  documents/  voice/   (kept; imports updated)
outbox/        wa-outbox.repo.ts · deliverer.ts
```
`wa-agent-turn.service.ts` (700 lines today) disappears into `turn/*` and `agent/*`; no file above 300 lines.
Pure logic (normalisation, command matching, formatting, failure classification, grounding extraction) lives in
`packages/shared/src/wa-agent/*` with unit tests, so it is reusable and fast to test.

## 4. Transport

### 4.1 Streams with retry and dead-letter
- `StreamConsumer` v2: an entry is XACKed **only after** its durable hand-off (row written + job queued). A
  handler error leaves it pending; `XAUTOCLAIM` (idle 60 s) redelivers; the delivery count comes from
  `XPENDING`; after 5 deliveries the entry is copied to `wa:agent:dlq` (with stream, id, error class) and acked.
- Handlers are idempotent: inbound by `waMessageId` (unique), sent receipts by `(waMessageId, status)`, events
  by `eventId`.
- Admin: DLQ count on the agent page, list with replay/discard (`wa_agent.write`, audited). Alert when > 0.

### 4.2 Media (bridge, `apps/worker/src/wa-bridge/agent-media.ts`)
- Download with `AbortSignal.timeout(30 s)`, 2 retries (1 s, 4 s); on `410/404` media URL expiry call Baileys'
  re-upload request once.
- Accepted: images `jpeg | png | webp | heic | heif` (image or document message), `application/pdf`
  (document), voice `ogg/opus` (as today). Limits from `packages/shared/src/schemas/files.ts`.
- Failure reasons (enum on the row, `media_status`): `ok | too_large | unsupported_type | download_failed |
  storage_unavailable | expired`. The customer gets a deterministic line per reason (e.g. «الصورة موصلتش كاملة،
  ابعتها تاني لو سمحت») and the model sees `[مرفق #3: لم يصل — download_failed]`.
- HEIC is converted to JPEG by the file pipeline (RX-ENGINE §3 S0), not by the bridge.

### 4.3 Turn queue (Decision 74)
- Queue `wa-agent-turns`, Worker hosted in the **api** process (business services live there), concurrency
  `waAgent.runtime.concurrency` (default 8 per replica).
- Enqueue on every non-command inbound with **debounce deduplication**: id `wa-turn:<conversationId>`,
  delay = reply delay (with jitter), `extend + replace` while delayed → a burst becomes one turn (coalescing,
  as v1, now native).
- A job that starts holds the conversation lock and **drains**: it loads every unanswered inbound row of the
  conversation, runs a turn, re-reads, repeats (≤ 4 rounds). After releasing the lock it re-checks once and
  enqueues again if anything arrived in between (closes the add-while-active gap).
- Job retries: 3 attempts, exponential backoff 20 s / 60 s / 180 s, only for `deferred` failures (§5.4).
  Stalled jobs (crash) are re-run by BullMQ; the turn store makes the re-run safe (I2).

### 4.4 Conversation lock
Redis `SET NX PX 60000` with a random token; a heartbeat renews it every 15 s while the job runs (Lua
compare-and-extend); every write that ends a turn (link rows, enqueue reply) checks the **fencing token**
(monotonic counter stored with the lock) against `wa_turns.fence` — a holder that lost its lock cannot send.

## 5. Turn engine

### 5.1 Turn state machine (`wa_turns`)
`queued → running → (replied | deferred | failed_replied | dropped_policy)`
- `replied`: reply parts queued; inbound rows linked (`turn_id`).
- `deferred`: model unavailable; customer told once «هرد عليك خلال دقايق»; job retried later (§5.4).
- `failed_replied`: terminal failure; customer got the deterministic failure text with an error reference.
- `dropped_policy`: paused by the owner, blocked, agent disabled, caps reached — recorded with the reason (this
  is the only no-reply state, and each reason is a deliberate policy the admin set).

### 5.2 Turn store (`wa_turns`, migration)
`id`, `conversation_id`, `session_id`, `state`, `fence`, `attempt`, `inbound_ids uuid[]`, `cause_class`,
`error_ref`, `trace jsonb` (steps: model, route version, latency, tokens, cost, tool outcomes — **no message
text**), `cost_usd_micros`, `started_at`, `ended_at`. Index `(conversation_id, started_at desc)`. Retention =
`waAgent.retentionDays`.

### 5.3 Exactly-once tools (Decision 76)
Every side-effecting tool call carries an idempotency key `sha256(turnId | toolName | canonical(args))`,
stored in `wa_tool_effects (key pk, turn_id, tool, result jsonb, created_at)`. Before acting the tool checks the
key; a hit returns the stored result. Effects run in one DB transaction with the key insert where the effect is
in Postgres (orders, coupons, claims); for the rx start the claim, the `rx_analyses` row and the outbox route
entry (`rx_done → conversation`) are written in **one transaction**, so a later Redis failure cannot orphan
the result (fixes R10). Redis keys become caches, never the only record.

### 5.4 Failure policy (`turn/failure-policy.ts`, pure, table-tested)
| Class | Examples | Action |
|---|---|---|
| `transient` (before any tool ran) | provider 429/5xx/overloaded, step timeout, network | retry ladder: same step 2× (1.5 s, 4 s) with route fallback allowed; then job retry (`deferred`, customer told once) up to 3 attempts; then `failed_replied` |
| `after_tools` | any failure after a tool ran | **never** the busy line: compose the reply from tool records (`fallback-replies.ts`: e.g. analysis started → «بقرأ الروشتة دلوقتي، النتيجة هتوصلك خلال دقيقة»; order created → amount + instructions from the stored result) |
| `empty_answer` | model returned no text | one re-ask with `toolChoice: none`; then the tool-record fallback; then a short deterministic «تمام، محتاج مني إيه كمان؟» |
| `spend_cap` | agent daily cap | deterministic «الخدمة الذكية واقفة مؤقتًا…» once per conversation per day + commands keep working + owner alert once per day |
| `ai_off` | kill switch, global cap | same as spend cap, different owner reason |
| `permanent` | schema bug, unknown error | `error_events` row, reference `WSF-…`, customer text with the reference, owner alert (rate-limited) |
| `policy` | paused, blocked, disabled, caps | `dropped_policy`, no reply (as configured), counted |
- Customer failure texts are rate-limited (one per conversation per 10 minutes); within the limit a further
  failure is `deferred` again, never silent.
- **No automatic pause.** Only the `handoff_to_owner` tool, the owner typing, or the admin pause the agent
  (Decision 75). Owner alerts for failures are separate and rate-limited.
- Budgets: step 45 s, turn 150 s (both settings), job lock heartbeat keeps the lock alive.

### 5.5 Turn pipeline (one round)
1. Load context (§6, §7, §8.3) → 2. build prompt → 3. tool loop (≤ 5 steps, ≤ 3 calls/step) →
4. guards (§10) with at most one repair step → 5. compose (§11) → 6. voice (optional) → 7. enqueue parts with
fence check → 8. link inbound rows, close the turn, write the trace.

## 6. Sessions and memory (Decision 79)
- `wa_conversations.session_id` + `session_started_at`; `wa_messages.session_id`. The model's context is the
  **current session only**: its verbatim tail (20 rows) + its rolling summary (`wa_sessions.summary`).
- **New session** when: the customer sends the `new` command (§7); or after `waAgent.sessions.idleHours`
  (default 12) of silence (the new session starts with a one-line "returning customer" note, no transcript).
- What survives a new session: identity (linked account), language and voice preferences, the customer
  **profile** (non-medical facts the customer chose: preferred name, wake/sleep times for Companion), the
  medicine cabinet (Companion, explicit), in-flight work (an analysis still running is delivered, labelled with
  its time). What does not: chat history, summary, attachment handles, pending menus/confirmations.
- Transcripts are not deleted by `new` (retention rules stay); the privacy command deletes (§7).

## 7. Command layer (Decision 78, `commands/*`, deterministic, free)

### 7.1 Matching
- Runs on every inbound text **before** any model. Normalisation (`packages/shared/src/wa-agent/normalize.ts`):
  NFKC, strip tashkeel and tatweel, unify أ/إ/آ→ا, ى→ي, ة→ه, Arabic-Indic digits → Western, lowercase, strip
  emoji and punctuation except `/`, collapse spaces.
- A command fires only when the **whole message** is a command alias (≤ 4 words), optionally prefixed with `/`,
  or a caption on an image/PDF equal to an rx alias. Damerau distance ≤ 1 for aliases of ≥ 5 letters. A sentence
  that merely contains a word («عايز دوا جديد») is not a command.
- Numbered menu: after `help`, a reply «1»…«9» maps to the menu entry for 10 minutes.
- Rate limit 20 commands / 10 min per conversation; `new` 10 / hour.

### 7.2 Registry (aliases are i18n data; admins can add aliases, not new commands)
| Command | Aliases (examples) | Who | Effect |
|---|---|---|---|
| `new` | جديد · ابدأ من جديد · محادثة جديدة · new · /new · reset | all | new session (§6); reply: «بدأنا صفحة جديدة 👋» + 3-line menu |
| `analyze` | /analyze · حلل · حلل الروشته · تحليل · اقرا الروشته · analyze | linked | if the current burst (or the newest unanalysed set) has pages → quality check → start analysis **without the model**; else set state `awaiting_rx` (10 min): the next images are analysed automatically. Guests get the sign-up path. |
| `help` | مساعده · القائمه · help · menu · ؟ | all | numbered menu of what the agent can do |
| `balance` | رصيدي · باقتي · balance | linked | deterministic account status |
| `report` | التقرير · pdf · الملف | linked | resend the last analysis report PDF |
| `schedule` | مواعيدي · الجدول | linked | today's dose timetable (Companion) or the last analysis schedule |
| `meds` | ادويتي · خزانتي | linked | medicine cabinet (Companion) |
| `remind` | فعل التذكير · وقف التذكير | linked | Companion reminders on/off |
| `voice` | صوت · بدون صوت | all | per-chat voice reply preference |
| `lang` | english · عربي | all | reply language |
| `human` | كلم موظف · خدمه العملاء · human | all | handoff (as the tool) |
| `privacy` | امسح بياناتي · delete my data | all | asks «اكتب تأكيد خلال ٥ دقايق»; then deletes this chat's transcripts and wa media (not the account, not rx results of the account), audited |
STOP/START and alert opt-in keywords stay in the bridge (unchanged).

## 8. Attachments, tools and tool memory

### 8.1 Attachment registry (Decision 80)
- Every inbound media row in the session gets a **handle** `#1, #2, …` (per session). Status: `ready |
  failed(reason) | analysed(rxRef) | in_progress | expired` (expired = media deleted by retention).
- **Bursts:** images/PDF pages arriving within 120 s of each other form a **set** (one prescription, ≤ `rx`
  max pages). The model sees sets: `مجموعة A: #3 #4 (صفحتين، جاهزة)`.
- Prompt block (always present when the session has media): the last 8 attachments with handle, kind, age,
  status, set. Pixels are attached only for the current burst's images (≤ 4) and when the model asks
  (`view_attachment(handle)` tool, ≤ 2 per turn) — e.g. the customer asks about a box photo.
- No time window: an attachment is usable for the whole session while its media exists.

### 8.2 Tools v2 (bound to the conversation; the model never passes user ids, only handles)
| Tool | Change |
|---|---|
| `analyze_prescription({ set?: "A" \| handles?: ["#3","#4"] })` | defaults to the newest unanalysed set; server validates handles belong to this session and are `ready`; quality gate first; idempotent; returns `{ started, rxRef, eta }` or a typed refusal with `explain` text for the model |
| `get_prescription({ rxRef? = "last" })` **new** | the structured result (tiers, names, strengths, doses, schedule, findings) so follow-up questions are answered from the result, not from memory |
| `lookup_medication({ text, strength?, form? })` **new** | `resolveDrugName` (RX-ENGINE §7): resolved entries with tier + "did you mean" options; replaces guessing |
| `search_medications`, `medication_alternatives` | kept, now on the shared engine |
| `view_attachment({ handle })` **new** | returns the image to the model (vision), ≤ 2 per turn |
| Companion tools | `add_to_cabinet`, `my_medications`, `set_reminders`, `dispense_check` (WA-COMPANION.md) |
| existing commerce/support tools | unchanged contracts; idempotency keys added |
Every tool returns `{ ok: true, data } | { ok: false, code, explain }`; `explain` is a fixed i18n sentence the
model may paraphrase («الصورة دي اتحللت قبل كده، النتيجة في الرسالة اللي فوق»), so it never improvises on raw codes.

### 8.3 Tool memory
After each turn, a compact **tool note** per tool call is stored on the reply row (`meta.toolNotes`: tool,
outcome code, rxRef/handles, no free text) and rendered into history as
`[أداة: analyze_prescription → started rx#12 (#3 #4)]`. The model therefore knows what already happened (fixes
R1) without seeing raw results again.

## 9. Delivery of results (outbox, Decision 77)
- `wa_outbox` (`id`, `conversation_id`, `kind`, `payload jsonb`, `idempotency_key unique`, `state`, `attempts`,
  `next_attempt_at`, `paid_work boolean`). Written in the same transaction as the effect that creates the
  obligation (rx start registers `rx_done` routing; payment approval registers the follow-up).
- The deliverer turns events into parts with the conversation lock (≤ 20 s wait, as v1), retries with backoff,
  and records delivery. `paid_work` items are delivered even during an **owner takeover pause** (not when the
  chat is blocked or the agent is disabled; then they wait and the web result stays available).
- Window rule: if the 24 h window closed before the result is ready (rare: results take ~1 min), the item waits
  for the customer's next message and is delivered first.

### 9.2 Typed rx failures → texts
`unreadable_image` («الصورة مش واضحة كفاية…» + tips, credits returned) · `not_a_prescription` («دي مش شكل
روشتة…») · `too_many_pages` · `insufficient_credits` (balance + plans) · `model_unavailable` (deferred; retried
by the worker; credits held) · `internal` (reference code, credits returned). Each text says truthfully
whether credits were returned (from the ledger outcome, not assumed).

## 10. Grounding guards (Decision 81, `agent/guards/*`)
- **Drug grounding:** after the model's draft, extract drug-like tokens (Latin words ≥ 4 letters not in a
  common-words list; Arabic tokens that transliterate to a brand key; ingredient names) with
  `packages/shared/src/wa-agent/drug-tokens.ts`. Each token must be **grounded**: present in this turn's tool
  results, in the session's analysis results, or an exact `brand_key`/ingredient in the database. An ungrounded
  token goes through `resolveDrugName`: resolved with high confidence → one repair step («you wrote X; the
  database entry is Y; correct the reply»); unresolved → one repair step to remove or qualify it. Never more
  than one repair; if still ungrounded, the token is replaced with a neutral phrase and the event is counted.
- **Price grounding:** any amount with a currency must equal a value in this turn's catalog/medication tool
  results; otherwise the same repair.
- **Medical safety:** dose instructions in a reply must match the stored analysis or come from `ask_medical`
  (which is delivered verbatim, as today).

## 11. Composition and formatting (`compose/*`)
- WhatsApp formatting only: `*bold*`, `_italic_`, `~strike~`, `` `mono` ``, bullets «• », numbered lists. No
  Markdown headings or tables (WhatsApp shows them raw).
- **Bidi safety:** Latin drug names inside Arabic lines are wrapped with U+2068/U+2069 (FSI/PDI) and lines start
  with U+200F when Arabic, so «Bepra 20 قبل العشاء» never renders scrambled.
- Splitting at paragraph, then sentence boundaries, ≤ `caps.maxReplyChars`, ≤ `caps.maxMessagesPerTurn`.
- Deterministic templates (i18n) for: command replies, menus, rx progress, rx result, failures, Companion.

## 12. Prescription flow on WhatsApp (end to end)
1. Customer sends photo(s) [+ «حلل» caption, or the `analyze` command, or asks in words].
2. Quality gate (RX-ENGINE S0): poor → «الصورة مهزوزة شوية…» + tips + «ابعت تاني أو اكتب كمّل» (no charge yet).
3. Start: one short line «⏳ بقرأ الروشتة (صفحتين)… هتوصلك النتيجة في أقل من دقيقة». Typing indicator kept.
4. Result (deterministic, `RX-REPORT.md` §2): summary message + PDF report + optional voice summary + quick
   replies («اسأل عن أي دوا · /مواعيدي · فعّل التذكير»).
5. Follow-up questions use `get_prescription` and `lookup_medication`; an `uncertain` line invites «تقصد X ولا
   Y؟» — the customer's answer is recorded as a correction (learning vote) and the PDF is re-issued on request.

## 13. Observability and admin
- Trace per turn (§5.2) visible in the inbox next to the transcript (steps, models, latencies, tools, cause).
- Counters (Redis, daily): turns, replied, deferred, failed, dropped by reason, p50/p95 latency, cost, guard
  repairs, command uses, media failures by reason, DLQ size. Admin "Health" tab with the last 24 h and 7 days.
- Alerts (existing admin alert kinds): failure rate > 5 % over 15 min; p95 > 45 s; DLQ > 0; media failure spike;
  spend cap reached.
- **Simulator** (admin, `wa_agent.write`): a chat panel that runs the full engine (commands, tools in a sandbox
  account, real model) with a fake transport — test persona/commands/settings without a phone.
- **Replay** a failed turn from its trace with the same inputs in dry-run (no send, no effects).

## 14. Security
| Threat | Control |
|---|---|
| Prompt injection via text, image text, voice, PDF | `<user_data>` wrapping (as today); tools bound to the conversation; handles not ids; server policy; guards |
| Command abuse (`new`/`privacy` spam, enumeration) | whole-message matching, rate limits, confirmations, audit |
| Malicious media (decompression bombs, PDF exploits, polyglots) | existing pixel limits, magic bytes, PDF rasterised with page/time caps in the worker, re-encode |
| Double spending via retries/races | idempotency keys, transactions, fencing |
| Cost abuse | per-chat caps, agent spend cap, quality gate before charging, guest limits (as v1) |
| Data exposure in logs/traces | traces hold codes/timings/counts only; pino redaction (AGENT §5.7) |
| Privacy deletion | `privacy` command deletes chat data with confirmation; audit row without content |

## 15. Testing (definition of "bulletproof" for this module)
- **Scenario transcripts** (`apps/api/test/wa-agent/scenarios/*.yaml`): inbound script + scripted model
  responses + expected outbound/DB state; ≥ 40 scenarios incl. every R1–R16 symptom reproduced first (red) and
  fixed (green).
- **Chaos suite:** provider timeout at each step; 429 storms; Redis drop mid-turn; process crash after a tool
  ran (job re-run must not double-charge, I2); lock expiry; media download failures; duplicate stream delivery;
  2 api replicas on one conversation.
- **Property tests** (fast-check): command normaliser/matcher (no false positives on a 2,000-sentence Egyptian
  Arabic corpus fixture), bidi wrapper, splitter, failure classifier.
- **Load:** 200 concurrent conversations with the fake provider: p95 inbound→reply-queued ≤ delay + 5 s, zero
  lost messages, zero duplicate effects.
- **Live smoke** (owner, T8 extended): photo, PDF, HEIC, burst of 3, `جديد`, `/analyze`, broken image, result +
  PDF arrives during an owner pause.

## 16. Settings additions (`waAgent`)
`runtime: { concurrency, stepTimeoutMs, turnTimeoutMs, maxRounds, jobAttempts }` · `sessions: { idleHours }` ·
`commands: { enabled, extraAliases }` · `failures: { customerTextEveryMinutes, ownerAlertEveryMinutes }` ·
`media: { burstSeconds, maxAttachmentsInPrompt }` · `guards: { drugGrounding, priceGrounding }` ·
`delivery: { paidWorkBypassesTakeover }` (default true). Defaults safe; all admin-editable.
