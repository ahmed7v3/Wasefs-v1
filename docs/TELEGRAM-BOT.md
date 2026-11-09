# Telegram prescription bot

A Telegram bot inside `apps/api` (`src/telegram-bot/`, admin in `src/admin/telegram/`). A linked customer sends a
prescription photo and gets the same reading as the web and WhatsApp, then can ask follow-up questions about it.
No new dependency: the Bot API is called with `fetch`.

## Setup

1. In Telegram open **@BotFather**, send `/newbot`, choose a name and a username, copy the token
   (`123456789:AA...`).
2. In the admin panel open the Telegram page (permission `wa_agent.write`, fresh login within 10 minutes) and paste the
   token. The api checks it with `getMe`, stores it encrypted (`integration_secrets`, key `telegram`, AAD
   `integration_secret:telegram`), registers the webhook `${API_PUBLIC_URL}/webhooks/telegram` and the command menu
   (Arabic default, English for English clients). The token is never shown again: only the last characters and the bot
   username.
3. Turn the bot on in the settings (`telegramBot.enabled`, off by default) and optionally set the welcome texts and the
   support username.
4. `API_PUBLIC_URL` must be a public https URL (Telegram only calls https).

Removing the token deletes the webhook and the stored secret.

## Webhook security

`POST /webhooks/telegram` has no session. Telegram echoes a secret in `x-telegram-bot-api-secret-token`; it is
`HMAC-SHA256(key = ENCRYPTION_KEY, "telegram-webhook")`, first 48 hex characters, so every api instance derives the same
value and nothing extra is stored. A wrong or missing header is `401`; everything else is `200` immediately and the
update is processed afterwards. Updates are deduplicated by `update_id` (Redis, 1 hour). Rotating `ENCRYPTION_KEY`
means pasting the token again (this also re-registers the webhook with the new secret).

## Linking a chat to an account

`/start` or `/link` shows Telegram's own "share my number" button. The contact is accepted only when
`contact.user_id` equals the sender, in a private chat (a forwarded or typed contact card is refused). The number is
normalised to E.164 and matched with `findVerifiedUserIdByPhone` (verified phone, not anonymised). No match: the person
gets the sign-up button. Analysis, balance and history need a linked chat; anyone else gets a friendly gate, never an
error. `/unlink` asks for confirmation first.

## What the bot does

- Photo, image file, or an album (all photos of one `media_group_id`, collected for 2.5 s, are ONE analysis): imported as
  the user's own `rx_page` files and sent through `RxService.create` (credit hold, quota, kill switch, page limits). One
  progress message is edited through the stages while the status is polled every 2 s for up to 3 minutes. Insufficient
  credits shows price, balance and a top-up button. The same photos are never charged twice (Redis marker per chat and
  `file_unique_id`; a repeat re-shows the finished result).
- Result: HTML message(s) of at most 4096 characters with the buttons re-analyze, ask about the result, copy summary,
  new chat, balance.
- Free text with an active analysis: answered by the `telegram_agent` task (balanced; see "AI route") with the analysis and the last 12
  messages since the last "new chat". Safety rules: no diagnosis, no brand substitution, no dose advice, pharmacist or
  doctor for any change.
- Per-chat limit 30 messages per 10 minutes (one friendly warning, then silence).

| Command | Does |
|---|---|
| `/start` | Welcome and main menu (contact button when unlinked) |
| `/menu` | Main menu |
| `/new` | New chat: forgets the active analysis and messages (history keeps every analysis) |
| `/balance` | Balance, price per page, analyses left, top-up button |
| `/history` | Last 5 analyses, tap to reopen (ownership checked by the rx service) |
| `/last` | Reopen the latest analysis |
| `/language` | Arabic / English for this chat |
| `/help`, `/support` | Help text, support link |
| `/link`, `/unlink` | Link or unlink the account |

Callback data is `<verb>:<arg>` under 64 bytes (`menu:*`, `rx:<id>`, `rerun:<id>`, `ask:<id>`, `sum:<id>`, `pdf:<id>`, `retry`,
`unlink:yes|no`, `lang:ar|en`).

## Data and privacy

Tables `telegram_chats` (chat id, linked user, language, context reset, active analysis, blocked flag) and
`telegram_messages` (last 40 per chat, follow-up context only). Message text, phone numbers and the token are never
logged. A 403 from Telegram marks the chat blocked; the next message from it clears the flag.

## AI route

Free-text answers use their own AI task, `telegram_agent` (balanced mode), so the bot can be tuned apart from the WhatsApp
agent: its own row in Admin > AI > Routes (seeded with the same models as `wa_agent`), its own kill switch
(`ai.killSwitch.telegram_agent`), its own plan entitlement and usage rows. Not a medical task in `MEDICAL_AI_TASKS`, like
`wa_agent`. Existing installs get the route and the plan entitlements copied from `wa_agent` by
`packages/db/migrations-pending/telegram-agent-backfill.sql` (idempotent).

- With a readable active analysis the question is about it; without one the bot answers general questions about
  prescriptions and medicines briefly (strict safety prompt: no diagnosis, no dose beyond the label, no brand
  substitution, pharmacist or doctor for any decision, reply in the person's language) and adds "send a photo for a full
  analysis" with the menu buttons. Unlinked chats still get the link gate.
- A transient failure (timeout, provider unavailable, empty answer) is retried once automatically. A pause or a missing
  route is never retried.
- What the person sees, by cause (never a provider detail): kill switch or spend cap = "the service is paused"; no
  route, no model, provider unavailable or out of quota = "the chat model is not set up right now"; timeout or empty
  answer = "the reply took longer than usual" with a 🔄 button that asks the same question again (the text waits in
  Redis `tg:retry:<chatId>` for 10 minutes and is removed when used).
- The log line "Telegram follow-up failed" carries the error class, the AppError code and reason, the provider error
  code and HTTP status, `task`, `mode` and a 12-character hash of the chat id. Never the question, the answer or the token.

## PDF

The result keyboard (and the history reopen view, which uses it) has a 📄 PDF button (`pdf:<id>`). With
`telegramBot.autoPdf` on (default, admin Telegram page) the PDF also follows every FRESH result automatically, after the text
and without blocking it (not when an old analysis is reopened).

- Only the worker has Typst, so the api enqueues `telegram.rx-pdf` ({analysisId, locale}) on the `documents` queue and waits
  for it with QueueEvents (45 s). The worker loads the finished result from the database, renders it with the same
  template and renderer as the WhatsApp PDF (`createRxPdf`, language passed in) and returns the storage key
  (`wa/out/<yyyy>/<mm>/<uuid>.pdf`). The api reads the bytes from object storage and uploads them with `sendDocument`
  (`wasfa-analysis-<yyyy-mm-dd>.pdf`, the analysis date, with a caption).
- Ownership: `RxService.get(user, id)` first, and only a `done` analysis; anything else answers "not found".
- Cache: Redis `tg:pdf:<rxId>:<locale>` holds the storage key for 7 days (a missing object renders again); a 60 s lock
  `tg:pdf:lock:<rxId>:<locale>` stops a double tap rendering twice.
- UX: chat action `upload_document`, a progress message ("preparing your PDF"), deleted when the file arrives or edited into
  an error with a 🔄 button (`pdf:<id>`). A PDF failure never touches the text result.
- Generated PDFs are not purged by any retention job yet (`wa/out/` objects are only removed with their WhatsApp message).

## Known limits

- The album debounce timer lives in the process that received the first photo (the photo list and the lock are in
  Redis); a restart inside the 2.5 s window loses that album, the user resends.
- Daily admin counters (analyses, messages) are Redis counters kept 3 days.

## Ads on Telegram

After a delivered analysis result or follow-up answer the bot may send ONE separate ad message (never inside the medical
text, never before it). Selection is the WhatsApp machinery (`AdsWhatsappService.maybeTelegramAd`): the same approved
creatives of the WhatsApp channel that have a `waText`, the same ad label, the tracked `/a/<token>` link (sent as a URL
button) and the same switch, trigger (`after_rx_done`), quiet hours, per-chat daily cap, gap, global limit and
probability from `ads.whatsapp`. Ads-free plans and failures never get one. Caps are counted per chat (`tg:<chatId>`) and
the impression is recorded only after the message was sent. `telegramBot.adsEnabled` (admin page toggle) switches ads off
for Telegram only. No analysis or message text reaches the ad code.

## Profile data and privacy

`telegram_chats` stores, per chat: Telegram user id, username, first and last name, language code (refreshed on every
update together with `last_seen_at`), `started_at` (first `/start`), and, only after the person taps the share-number
button, `phone` (E.164) with `phone_shared_at`. The phone is kept even when no verified Wasfa account matches (the
button is the consent); Telegram never sends a phone otherwise. It is saved only when `contact.user_id` equals the sender.
The `/start` text says the number is used to link the account and for service and marketing updates. None of these values
is logged. `/unlink` clears the phone and its timestamp; a deletion request must delete the `telegram_chats` row (the
profile fields and the 40 stored messages cascade away). The admin status shows how many phones were shared
(`stats.sharedPhones`).
