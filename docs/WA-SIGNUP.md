# Sign up and sign in with WhatsApp (spec, 2026-10-29)

Goal: an account in two taps, the phone proven by WhatsApp itself, nothing weaker than today.
Builds on: the WhatsApp bridge (apps/worker/src/wa-bridge), reverse-OTP verification
(apps/api/src/phone), the phone auth plugin (apps/api/src/auth/phone-plugin.ts, which already mints
sessions and uses `PHONE_PLACEHOLDER_EMAIL_DOMAIN` emails), the WhatsApp agent (docs/WA-AGENT.md).

## 1. Principles

1. **The phone comes from WhatsApp, never from text.** The sender is resolved by the bridge exactly as
   for verification codes (jid, alternate jid, LID mapping). A sender that cannot be resolved gets a
   short reply pointing to the website flow; nothing is created.
2. **A session goes only to the browser that asked.** The web flow binds the challenge to an httpOnly
   nonce cookie; the session is minted when that browser polls, never by the inbound message.
3. **Single use, short life.** Challenges live 5 minutes and are consumed atomically.
4. **Privileged accounts keep their factors.** Accounts with two-factor on, platform roles, or that are
   suspended/deleted never sign in through WhatsApp (they get `login_use_password`).
5. **Every WhatsApp sign-in is announced in the chat**, with a one-word way to undo it.

## 2. Web flow ("Continue with WhatsApp")

1. `POST /auth/whatsapp/start` (better-auth plugin endpoint, Turnstile `always`, 10/h per IP): creates `wa:login:<token>` in Redis, TTL 300 s:
   `{ nonceHash, createdAt, status: "pending", ua: short device label }`. `token` = 8 chars Crockford
   base32 shown as `XXXX-XXXX`. Sets cookie `wasfa_wa_login` = 32 random bytes (httpOnly, Secure,
   SameSite=Lax, Path=/auth/whatsapp, Max-Age 300); stores only its SHA-256. Response:
   `{ token, waLink, expiresAt }` with `waLink = https://wa.me/<bridge number>?text=<i18n "login code"
   message containing WASFA-XXXX-XXXX>`. Desktop shows the link as a QR (existing `use-qr-code`).
2. Bridge: a fresh 1:1 text containing `WASFA-[0-9A-Z]{4}-[0-9A-Z]{4}` (digits normalized like codes) is
   a login claim (before verification-code parsing). With a resolved phone it goes to stream
   `wa:login:in` `{ id, phone, token, jid, pushName (clipped 60, control chars stripped), receivedAt }`;
   unresolved → one `wa_unresolved` reply (existing path). Login claims are routed regardless of the
   agent switch, but only when `auth.whatsappLogin` is enabled (setting, default true).
3. API consumer (group `api`): `GETDEL`-style atomic claim (Lua or `SET` status with `XX` on
   `status == pending`). Then:
   - existing verified user with that phone → refuse if 2FA enabled, platform role, status not active,
     or anonymized (`status: "refused", reason`); else `status: "approved", userId`.
   - no user → create one: name = pushName or `t("auth.whatsapp.defaultName")`, email
     `w<hex>@PHONE_PLACEHOLDER_EMAIL_DOMAIN`, emailVerified false, phone + phoneVerified true +
     phoneVerifiedAt now, no password, `signupMethod: "whatsapp"` in whatever audit/analytics field
     exists; terms accepted at = now (the web page states the terms before the button). Free plan is
     activated the same way onboarding does it today. Unique-phone race → treat as existing user.
   - reply on WhatsApp with fixed outcome `login_ok` ("تم تسجيل دخولك لوصفة ✅ مش انت؟ ابعت: خروج") or
     `login_refused` ("الحساب ده محمي، ادخل بكلمة السر من الموقع") or `login_expired`.
4. `GET /auth/whatsapp/status?token=` (60/min per IP): requires the cookie; if `nonceHash` mismatches →
   `pending` forever (no oracle). When `approved`: delete the challenge, `createSession(userId)`,
   `setSessionCookie`, clear the nonce cookie, return `{ status: "signed_in", isNew }`. The web then goes
   to `/welcome` (new) or `next` (existing).
5. **Undo:** a 1:1 message `خروج` / `LOGOUT` from a resolved phone revokes every session of that user
   created by WhatsApp sign-in in the last 24 h (sessions get `loginMethod = "whatsapp"`; add the column or
   reuse an existing metadata field) and replies `logout_ok`.

## 3. Agent flow (account from the chat)

Agent tools (only when `auth.whatsappLogin` and the agent are on; phone must be resolved):
- `create_account({ name?, confirmed: true })` for a guest chat: the model must first ask the customer
  to confirm and mention the terms link; `confirmed` must be true. Creates the user exactly as §2.3,
  links the conversation, returns `{ created, loginUrl }`.
- `login_link({})` for a linked chat (same refusals as §1.4): returns `{ loginUrl }`.
`loginUrl` = `<WEB_ORIGIN>/auth/whatsapp/link/<token>`: a separate Redis key `wa:magic:<token>`
(32 random bytes base64url, TTL 900 s, single use) → `{ userId }`. Opening it (GET page → POST
`/auth/whatsapp/magic` with the token in the body, never logged) mints the session. Rate: 3 links per user
per hour. The agent sends the link as text (agent outbound already allows site URLs as text).

## 4. Onboarding in one screen

New users from WhatsApp, Google, or email land on `/welcome`: name (prefilled), "for me / for an
organization" toggle, optional profession chips, one button. Phone step appears only if the phone is not
verified. The free plan is activated automatically; plan choice moves to an in-app upsell. `social_follow`
moves to a dashboard card after the first successful analysis. The onboarding machine keeps its steps;
the UI collapses them and the API accepts a combined `PUT /onboarding/welcome` that completes
account_type, name, organization (if individual), profession_intent (optional), plan_picker (free).

## 5. Settings and limits

`auth.whatsappLogin` (bool, default true) and `auth.whatsappAgentSignup` (bool, default true), admin-only.
Limits: start 10/h per IP; status 60/min per IP; claims per phone 5/h (excess ignored silently);
magic links 3/h per user. All identifiers hashed in keys and logs; no phone or token in logs.

## 6. Out of scope now

Value-before-account (a guest reading before sign-up) and passkeys: next phases.
