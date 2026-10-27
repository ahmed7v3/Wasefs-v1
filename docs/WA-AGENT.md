# WhatsApp AI agent (sales, support, paid usage, voice)

> **Owner request (2026-10-26):** turn the WhatsApp number that today only receives verification codes into an
> AI agent that sells and supports in the owner's voice, takes subscriptions by bank transfer, reads
> prescriptions and answers questions on WhatsApp against the linked account's balance, and can answer by voice
> (ElevenLabs). Everything is controlled from the admin panel; the agent and code verification switch on and off
> independently.
>
> **Owner decisions:** stay on the existing Baileys linked-device bridge (no Meta Cloud API); the agent **never
> starts a conversation**; every reply waits ~10 s with "typing…". ROADMAP §"outbound WhatsApp waits for Meta"
> and ARCHITECTURE §wa-bridge ("replies at most once per verification") are superseded for **replies inside a
> conversation the customer started**; the bridge still never sends first.

Rules that apply everywhere: `AGENT.md` §5 (zod at the boundary, scoped repos, integer minor units, admin-controlled
not hard-coded, cost protection, medical safety, i18n). Existing pieces are reused, not rebuilt (`REUSE-INDEX.md`).

---

## 1. Shape

```
customer phone ──WhatsApp──▶ wa-bridge (worker, Baileys)
                               │  1:1 inbound only, fromMe = owner typing
                               ├─ 6-digit code & verification on ─▶ wa:inbound      (unchanged OTP path)
                               └─ everything else & agent on ─────▶ wa:agent:in    (text | image | audio | document)
                                                                       │ media → private R2 (files, purpose wa_media)
api: WaAgentConsumer (xreadgroup, one lock per conversation)
   ├─ identify: sender phone == users.phone with phone_verified → linked user, else guest
   ├─ voice note → ElevenLabs STT (if enabled) → text
   ├─ agent loop: persona + safety rules + history + tools (task `wa_agent`, admin route)
   └─ reply ──▶ wa:agent:out ──▶ wa-bridge: guard (24 h window, caps, pause) → typing → delay → send
                                              text | image | document | voice (ElevenLabs TTS, ogg/opus)
worker events (rx done, payment approved/rejected) ──▶ wa:agent:events ──▶ api agent posts the follow-up
```

- The **API** runs the agent (all business services live there: credits, rx, chat, catalog, orders, coupons,
  manual payments). The **bridge** stays a dumb transport plus the anti-ban guard.
- Messages that arrive while a reply is pending are **coalesced**: the consumer waits for the reply delay; new
  messages in that window join the same turn (one answer to a burst, like a person).

## 2. Identity and trust

| Sender | What the agent may do |
|---|---|
| **Linked**: E.164 from the JID equals a user's `phone` with `phone_verified` (unique index guarantees one) | everything: account status, balance, rx reading, medical Q&A, orders, receipts, personal coupons |
| **Guest**: no verified match, or LID that does not resolve | sales and support only: plans, prices, how it works, how to sign up and verify this number. No account data, no paid actions, no coupons |
| Suspended / deleted account, blocked conversation | one polite line (rate-limited), nothing else |

- Tools **never take a user id or phone as an argument**: the server binds them to the conversation's linked user.
  A prompt-injected "act on account X" has nothing to call.
- The model decides *when* to use a tool; the **server decides whether it is allowed** (policy checks in code, not
  in the prompt).
- Payments are **never approved by the agent**: a receipt is attached to the order and goes to the existing human
  review queue (`payments.review`, 4-eyes, SLA).

## 3. Persona and honesty (hard rules in code, persona in admin)

Admin-editable (setting `waAgent.persona`): name to sign as, tone, dialect, emoji level, selling points, FAQ
notes. Fixed in code and appended after the persona (cannot be removed from admin):
1. Speaks for Wasfa as the owner's assistant. If someone **sincerely asks whether they are talking to a human or
   a bot, it says it is an AI assistant** (and can offer the owner).
2. Urgency only from **real** data: a coupon's real expiry, a promotion's real end date, the user's real usage.
   No invented scarcity, fake countdowns or made-up numbers. Prices only from the catalog tool, never from memory.
3. Medical: the agent does not diagnose; medical questions go through the paid tools, which use the existing
   chat/rx pipelines and their safety prompts and disclaimers (§5.11).
4. Never asks for passwords, card numbers or OTPs. Never claims a payment is confirmed before the review approves it.
5. Stays on Wasfa topics (product, plans, account, prescriptions, medicines). Politely declines the rest.

## 4. Tools (v1)

| Tool | Who | Effect | Cost |
|---|---|---|---|
| `get_catalog` | all | plans, prices, active promotions for the sender's market (`CatalogService`) | free |
| `account_status` | linked | plan, renewal date, credit balance, pending orders | free |
| `offer_discount(planKey, months)` | linked | mints a **single-use coupon for that user** under the admin policy (§6); returns code + real expiry | free |
| `start_subscription(planKey, months, couponCode?)` | linked | creates the order with the manual **bank** method (`OrdersService`); returns amount + transfer instructions | free |
| `attach_receipt(fileId?)` | linked | attaches the last received image/PDF as proof (`ManualPaymentsService.submitProof`) → review queue; replies with the admin SLA | free |
| `analyze_prescription(fileIds)` | linked | starts the normal rx pipeline (`RxService.create`, origin `whatsapp`); credits reserved/settled as on the web; result arrives as an event | rx credits |
| `ask_medical(question)` | linked | one answer from the existing chat engine (chat task, its prompts, its credit hold/settle) in a per-user WhatsApp chat | chat credits |
| `send_media(key)` | all | sends an image/PDF the admin put in the agent media list (screenshots, bank details card) | free |
| `handoff_to_owner(reason)` | all | pauses the agent for this chat, alerts the owner (existing admin WhatsApp alerts) | free |

Sales/support turns are **not charged** to the user; they are a business cost bounded by the agent's own daily
spend cap and per-chat caps. Only `analyze_prescription` and `ask_medical` charge the account, through the
existing pipelines (insufficient balance → the agent says so and offers a plan or a pack).

**Results:** rx → short text summary in the chat + link to the result page on the site (signed in) ; PDF and
image renditions are phase C (§8). Quick answers stay in the chat.

## 5. Owner takeover

The bridge already sees the owner's own messages (`fromMe`). When the owner types into a customer chat from the
phone, the agent **pauses for that chat** for `waAgent.takeoverPauseMinutes` (default 120). Admin can also
pause/resume a chat, or block a number. The admin inbox shows every conversation and transcript.

## 6. Discount policy (admin, enforced in code)

`waAgent.discounts`: `enabled` (default off) · `percentOff` (default 10, max 50) · `plans` (keys; empty = all
individual plans) · `validHours` (default 24) · `perUserLifetime` (default 1) · `dailyCap` (default 20) ·
`newCustomersOnly` (default true) · `minUserMessages` before an offer (default 4, so it is not offered to
everyone straight away). The model is told the policy exists and *may* offer when the customer hesitates on
price; the tool refuses (with a reason the model sees) when any rule fails. Coupons are created like the reward
coupons (`packages/db/src/rewards.ts` pattern: active, `maxRedemptions 1`, `perOwnerLimit 1`, `targetUserId`,
campaign `wa_agent`), audited, and visible in the admin coupon list.

## 7. Settings (`site_settings` key `waAgent`, admin-only) and secrets

- `enabled` (default **false**) — independent from `auth.phoneVerification` (codes). Both, either or none.
- `guestsEnabled` (default true) — answer numbers that are not linked to an account.
- `replyDelaySeconds` (default 10, 3–60, ±25 % jitter), `typingIndicator` (true).
- Caps: `perChatPerHour` (default 20 replies), `perChatPerDay` (60), `dailyTotal` (1500), `maxReplyChars` (1200),
  `maxMessagesPerTurn` (3). Agent daily AI spend cap in USD micros (separate from the global AI cap, default $5).
- `persona` (text, ≤ 4000 chars), `language` (`ar_eg` default), `emojiLevel` (`none|light|lively`).
- `takeoverPauseMinutes`, `retentionDays` (default 90; transcripts and wa media are deleted after it).
- `discounts` (§6). `media` (list of `{ key, mediaAssetId, caption }` the agent may send).
- `voice`: `enabled` (false) · `replyMode` (`mirror` = answer voice with voice | `sometimes` | `never`) ·
  `sometimesPercent` (20) · `maxChars` for TTS (600) · `voiceId` · `modelId` · `transcribeIncoming` (true).
- **ElevenLabs API key**: never in `site_settings`. Stored encrypted (`encryptSecret`, AAD `elevenlabs:api_key`)
  in a `integration_secrets` row with `keyHint`, set/cleared from admin, same pattern as `ai_providers.apiKeyEnc`.
- Model choice: new AI task **`wa_agent`** in the existing router (admin `AI → Routes` picks provider/model and
  fallbacks per plan/mode). Medical tools keep their own tasks (`rx_extract`, `chat`).

## 8. Delivery (work packages)

| WP | Content | Depends |
|---|---|---|
| **A. Transport + data** | `waAgent` settings schema; tables `wa_conversations`, `wa_messages` (+ retention job); bridge: route inbound (codes vs agent), download media → R2 `wa_media`, outbound stream with 24 h guard, caps, pause, typing + delay, fromMe → takeover pause; independent switches; integration tests | — |
| **B. Agent core** | tool calling in `packages/ai` (OpenAI-compatible/OpenRouter + Gemini), task `wa_agent`; `WaAgentModule` consumer, per-conversation lock + coalescing, identity, prompt (persona + hard rules + history summary), tools `get_catalog`, `account_status`, `send_media`, `handoff_to_owner`; spend cap; unit tests with the fake provider | A |
| **C. Commerce + usage** | `offer_discount` (policy), `start_subscription`, `attach_receipt`, payment approved/rejected follow-ups; `analyze_prescription` + rx-done event + result reply/link; `ask_medical`; insufficient-balance path | B |
| **D. Voice** | ElevenLabs client (STT for voice notes, TTS to ogg/opus), encrypted key, voice settings, reply modes | B |
| **E. Admin** | `/admin/whatsapp/agent`: switches, persona, delays/caps, discounts, voice + key, media list; inbox (conversations, transcript, pause/resume/block, takeover state); usage & cost; permissions `wa_agent.read`, `wa_agent.write`, `wa_agent.inbox` | A (grows with B–D) |
| Later | PDF/image renditions of rx results; lead tags + owner hot-lead alerts; weekly agent report | C |

## 8a. Implementation notes (as built, 2026-10-27)

- **Streams:** `wa:agent:in` (bridge → api), `wa:agent:out` (api → bridge), `wa:agent:sent` (bridge → api),
  `wa:agent:events` (worker → api: order_paid, payment_rejected, payment_resubmit, rx_done, rx_failed).
- **Tables:** `wa_conversations`, `wa_messages` (0025), `integration_secrets` (0026), alert kind
  `wa_agent.handoff` (0027).
- **Handoff:** the tool alerts at once and holds the agent silent; the pause is applied after the reply that
  tells the customer the owner will answer has been sent (otherwise the bridge would drop it).
- **Receipts:** a WhatsApp receipt has no transaction id; `txnId = "WA-" + payment reference`, sender phone =
  the chat's phone (stored masked). Duplicate receipts are caught by the image hashes.
- **Bank method:** `start_subscription` needs an enabled manual method with `provider = bank_transfer`,
  `requiresProof`, for the customer's currency/country. None is seeded: the admin creates it in Billing →
  Payment methods, otherwise the agent answers `no_bank_method` and offers the website checkout.
- **Payment follow-ups** are sent by the agent only when the existing customer WhatsApp notifications would not
  deliver that event (never twice).
- **Medical answers** (`ask_medical`) come from the existing chat engine and are delivered verbatim, with the
  standard disclaimer; rx results are a deterministic template + link, never model prose.
- **Voice:** ElevenLabs STT `scribe_v2` (auto language), TTS `output_format=opus_48000_64` (default model
  `eleven_multilingual_v2`); replies with a URL, coupon code, IBAN or ≥ 8 digits stay text; daily character
  cap in Redis.
- **Ops:** the `wa-bridge` service needs `R2_UPLOADS_*` and `MEDIA_PUBLIC_ORIGIN` in `compose.prod.yml`;
  add a 1-day lifecycle rule on the `wa/test/` prefix of the uploads bucket (voice-test clips).
- **Emergency stop:** AI → kill switch `wa_agent` stops the agent instantly; `waAgent.enabled` stops routing
  to the agent; codes are unaffected by both.

## 9. Risks

- **Number ban (Baileys):** owner-accepted. Mitigations: never first, 24 h window, delays with jitter + typing,
  per-chat and daily caps, coalescing, kill switch that stops the agent without touching codes.
- **Prompt injection** (text, images, voice): tools bound to the linked user, server-side policy, no tool that
  approves money or reveals other accounts, output length caps.
- **Health data on WhatsApp:** same retention and access rules as rx uploads; transcripts admin-only (`wa_agent.inbox`), audited reads.
- **Cost:** agent spend cap + per-chat caps + guest rate limit; paid tools use existing credit holds.
