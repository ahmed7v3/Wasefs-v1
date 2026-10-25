# TRACKING.md — Campaigns, attribution, consent, pixels and server-side conversions

> Phase 4, Task 4.6 (absorbs the deferred Phase 3 Task 3.16). Builds on what exists: `campaign_links` (Phase 3 table), `growth_events` (first-party funnel events), the `wasfa_ref` / `wasfa_join` attribution cookies, the outbox, `AdminAlertService`, feature flags and experiments.
> Related: GROWTH-STRATEGY §9 (events, funnels), SEO-GEO §12 (organic and AI referrals), `docs/ADS.md` (ad inventory measurement), SECURITY.md (endpoint register).

---

## 1. Non-negotiable privacy rules (health product)

1. **No health data ever leaves for an advertising or analytics platform.** Never sent, in any form (URL, title, event parameter, custom data, hashed or not): prescription images or text, medicine names from a user's prescription, analysis results, chat content, medical questions, conditions, search terms typed into drug search, or which drug pages a signed-in user viewed.
2. **Ad and analytics tags never load on app pages** (`/dashboard`, `/analyze`, `/ai`, `/taste`, `/billing`, `/checkout`, `/account`, `/rewards`, `/org`, `/capture`, `/admin`, `/onboarding`). The only exceptions are explicit, allow-listed conversion moments rendered on a neutral confirmation page (§6.3), and only with consent.
3. **Drug and medical content pages** load only the first-party analytics (no third-party ad pixels) by default (`tracking.pixelsOnMedicalContent = false`). Even when an admin enables pixels there, page URLs and titles are replaced by the route **template** (`/drugs/[slug]` → `/drugs/:slug`), never the drug name.
4. **Consent first** for anything that is not strictly necessary (§3). No third-party script runs, no ad click identifier is stored, no server-side conversion is sent for a person without the matching consent.
5. **Allow-list, not block-list:** every outbound payload is built from a typed allow-list per destination (§6.4). A unit test fails if any field outside the allow-list appears.
6. **No arbitrary scripts:** admins configure supported integrations by id and token; there is no "paste any script" field (supply-chain and XSS risk). New providers are added in code, reviewed like any feature.
7. Legal basis and wording are confirmed by counsel (Egypt Law 151/2020 on personal data, Saudi PDPL, GDPR for EU visitors, platform terms). Until then defaults are the strictest (opt-in everywhere for ads).

---

## 2. Concepts

| Term | Meaning |
|---|---|
| **Visitor** | an anonymous browser, identified by a random first-party id `wasfa_vid` (set only when analytics consent or notice-only policy allows; otherwise a per-session in-memory id) |
| **Touch** | one arrival with attributable context: campaign link click, UTM landing, referral link, organic search, AI assistant referral, direct |
| **Channel** | classification of a touch: `paid_search`, `paid_social`, `display`, `email`, `affiliate/partner`, `referral_program`, `organic_search`, `ai_assistant`, `social_organic`, `referral_site`, `direct`, `internal` |
| **Goal** | a configurable conversion (§5): e.g. sign-up, verified phone, first analysis, checkout started, purchase |
| **Conversion** | a goal reached by a visitor/user, with value and attributed touches |
| **Destination** | a platform receiving events: GA4, Google Ads, Meta, TikTok, Snap, X, LinkedIn (Phase 4 ships GA4, Google Ads, Meta, TikTok, Snap; others are adapters behind the same interface) |

---

## 3. Consent management

### 3.1 Categories
| Category | Includes | Default |
|---|---|---|
| `necessary` | session, CSRF, security, consent record itself, `wasfa_ref`/`wasfa_join` (they fulfil the user's own invite/join request) | always on |
| `analytics` | first-party visitor id, our own funnel analytics, GA4 (if enabled) | per region policy |
| `ads` | ad pixels, click ids (`gclid`, `fbclid`/`_fbc`, `ttclid`, `ScCid`, `msclkid`), server-side conversions, enhanced conversions | **opt-in everywhere** |

### 3.2 Region policies (admin, `tracking.consent`)
- `opt_in` (default for all regions, required for EU/EEA/UK/CH): nothing beyond `necessary` until the visitor accepts.
- `notice` (admin may choose per country after legal advice): first-party `analytics` runs with a visible notice and an easy opt-out; `ads` still requires opt-in.
- Region from Cloudflare's `CF-IPCountry` header (falls back to `opt_in` when unknown).

### 3.3 Banner and preferences
- A small, non-blocking banner at the bottom (not a full-screen wall), Arabic/English, equal-weight **"قبول الكل"** and **"رفض غير الضروري"** buttons plus **"تخصيص"**. No pre-ticked boxes. Shown on public pages only; signed-in users see it once and their choice is stored on the account too.
- Server-rendered markup, ≤ 3 KB client JS, no layout shift (fixed position, reserved), `data-nosnippet`, accessible (focus management, Escape closes to "reject non-essential" only if the region policy allows that default).
- A permanent "إعدادات الخصوصية" link in the footer reopens it; withdrawal is as easy as consent.
- **Google Consent Mode v2** signals (`ad_storage`, `analytics_storage`, `ad_user_data`, `ad_personalization`) default to `denied` and update from the choice. Meta `fbq('consent', …)`, TikTok `holdConsent/grantConsent` equivalents are wired the same way.
- **Records:** `consent_records` (visitor id or user id, region, policy version, categories granted, source `banner`/`settings`/`account`, timestamp, hashed user agent). Changing the policy text bumps the version and asks again.

---

## 4. Campaign links and attribution

### 4.1 Campaign link manager (extends `campaign_links`)
New columns: `folder_id`, `tags`, `channel`, `destination_type` (`path` | `pricing_plan` | `article` | `drug_page` | `join_link` | `referral_code`), `destination_ref`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `utm_id`, `extra_params` (allow-listed), `starts_at`, `ends_at`, `expired_target` (where to send after `ends_at`), `cost_minor` + `currency` (manual spend), `owner_id`, `notes`, `archived_at`. `targetPath` keeps the no-open-redirect rule (own paths only).
Supporting tables: `campaign_folders`, `campaigns` (a named group of links with budget, dates, goals, platform campaign ids for later import).

Admin features: create from a template (source/medium presets per platform, e.g. *Meta paid social*, *Google Search*, *WhatsApp broadcast*, *Pharmacy QR*), UTM builder with live preview of the final URL, naming-convention validation (lower-case, hyphens, allowed sources list), duplicate a link, bulk create from CSV, QR code (SVG/PNG download, reuses the org QR component), short link `https://wasfa.online/c/<slug>`, copy buttons, archive, search and filter by folder/tag/channel/status.

### 4.2 The click endpoint `/c/<slug>`
1. Look up the active link (cached); unknown or archived → redirect to `/` (never 404 for a printed QR).
2. Record a click in `campaign_clicks`: link id, time, visitor id if allowed, **country** (CF header), device class (mobile/tablet/desktop from UA), browser family, referrer **host** only, bot flag (known bot UA list + Cloudflare bot score header when present); no IP stored (a daily-salted hash is used only for unique-click counting and dropped after 48 h).
3. Set first-party attribution (§4.3), then `302` to the destination with the link's UTMs appended (so the landing page and GA4 see them) and `?ref=` when the link carries a referral code.
4. Budget: ≤ 20 ms server time; works without JavaScript.

### 4.3 Attribution model
- **Touch capture** happens in the proxy on any public landing with UTMs, click ids or a known referrer: a compact first-party cookie `wasfa_att` (`first` touch with 90-day life; `last` non-direct touch updated on each new attributable arrival; ≤ 1 KB, signed to stop tampering). Click ids are written **only with `ads` consent**; when consent arrives later in the same session, the consent script asks the server to promote the click id held in a 30-minute `necessary`-class session store (never in a cookie before consent).
- At **sign-up** the touches are copied to `user_attribution` (first touch, last non-direct touch, landing page template, campaign link id, referral code, AI-assistant/organic classification) and become immutable for that user.
- **Conversions** (`conversions` table): goal, user, occurred_at, value (net, minor units, currency) where relevant, `event_id` (deterministic, §6.2), attributed `first_touch` and `last_touch` (copied), order id when relevant.
- **Models in reports:** first touch, last non-direct touch (default), and linear across the two (simple and explainable). Lookback window per goal (default 30 days for purchases after the last touch).
- Referral program attribution (REFERRALS-REWARDS) is unchanged and keeps priority for **rewards**; marketing attribution is reporting-only and never changes who earns a reward.

### 4.4 Channel classification
A pure, unit-tested function `classifyTouch(utm, referrerHost, clickIds)`: explicit UTM medium wins (`cpc|ppc|paid` → paid_*, `email`, `affiliate`, `qr` → offline), then click ids, then referrer host lists (search engines, social networks, **AI assistants** list from SEO-GEO §12.4), then `direct`. Lists are settings, not code.

---

## 5. Goals and event definitions (admin-configurable)

### 5.1 Internal event catalog (closed list; adding one is a code change)
`page_view` (template only), `pricing_viewed`, `sign_up_started`, `sign_up_completed`, `email_verified`, `phone_verified`, `activation` (first successful analysis; **no properties**), `checkout_started`, `payment_method_selected`, `purchase` (order paid), `subscription_started`, `subscription_renewed`, `trial_started`, `credit_pack_purchased`, `referral_invite_sent`, `lead_submitted` (organisations "request an offer"), `app_waitlist_joined` (BRAND-AND-HOMEPAGE §5.8), `campaign_click`.
These extend `growth_events` names (Phase 3) and reuse its writer.

### 5.2 Goals (`conversion_goals`)
Admin defines: name, internal event, optional filter (plan, product type, first-time only), value rule (`none` | `fixed` | `order_net` | `order_gross`), counting (`once_per_user` | `every`), lookback days, and **per-destination mapping**: platform event name (e.g. Meta `CompleteRegistration`, `Purchase`, `Subscribe`, `StartTrial`, `Lead`; GA4 `sign_up`, `purchase`; Google Ads conversion action id/label; TikTok `CompleteRegistration`, `CompletePayment`; Snap `SIGN_UP`, `PURCHASE`), enabled flag per destination, browser and/or server delivery.
Defaults seeded: Sign-up, Activation, Checkout started, Purchase, Subscription started, Lead.

---

## 6. Destinations: browser tags and server-side events

### 6.1 Integration settings (`tracking_integrations`, admin screen "التتبع والبيكسل")
Per provider: enabled, environment (production only by default), ids (GA4 measurement id, Google Ads conversion id, Meta pixel id, TikTok pixel code, Snap pixel id), server credentials **encrypted** (Meta CAPI access token, GA4 Measurement Protocol API secret, TikTok Events API token, Snap CAPI token) using the Phase 3 encrypted-credential pattern, test event codes, `send_browser`, `send_server`, `enhanced_matching` (off by default; when on, only SHA-256 of normalised email/phone with `ads` consent), page allow-list (route templates where the browser tag may load), last delivery status, **"Send test event"** button that fires a test conversion and shows the platform's response.

### 6.2 Deduplication
- Every conversion gets a deterministic `event_id` = `<goal>:<subject>` (`purchase:<order_id>`, `sign_up:<user_id>`, `subscription_started:<subscription_id>`). The same id is used by the browser tag and the server event, so platforms deduplicate (Meta `eventID`/`event_id`, TikTok `event_id`, GA4 `transaction_id` for purchases, Google Ads `transaction_id`/order id).
- The browser learns the id from the server: the confirmation page renders a small JSON (`<script type="application/json" nonce>`) with `{event_id, goal, value, currency}`; nothing else.
- Our own `conversions` table has a unique key on `(goal, subject)` so retries and double clicks never double-count internally.

### 6.3 Where browser conversion tags may fire
Only on: public marketing pages (page view with template path), `/register` completion screen, the **order confirmation page** (`/billing/orders/[id]` "success" state, which shows plan and amount only), and the waitlist/lead confirmation. These pages render no health content. The analysis, chat and history pages never load tags.

### 6.4 Payload allow-list (server-side and browser)
| Field | Allowed? |
|---|---|
| event name (mapped), event_id, event time | yes |
| value, currency (purchase/subscribe goals) | yes |
| content_type = `product`, content_ids = plan **code** (`plus_monthly`) or pack code | yes |
| page URL | route template only, no query string except UTMs |
| client ids: `_ga` client id, `_fbp`, `_fbc`, `ttclid`, `gclid` | only with `ads`/`analytics` consent as applicable |
| hashed email / phone (SHA-256, normalised) | only with `ads` consent **and** `enhanced_matching` on |
| IP address, user agent | forwarded to Meta/TikTok CAPI only with `ads` consent (required by those APIs for matching); never stored by us beyond the request |
| country | yes (from CF header) |
| anything about prescriptions, medicines, analyses, chats, conditions, search terms, drug pages viewed | **never** (test-enforced) |

### 6.5 Server-side delivery
- Conversions write an outbox row in the same transaction as the business event (Phase 3 pattern: `onSucceeded` for purchases, sign-up handler for registrations). The worker job `tracking:dispatch` sends per destination with retries (exponential, 24 h), records `conversion_dispatches` (destination, event_id, status, http code, attempts, error class — **no payload stored**), and alerts on sustained failure.
- Consent is checked at dispatch time against the user's latest consent record; withdrawn consent cancels pending dispatches.
- Platforms' policies may restrict health-related advertisers (e.g. limits on lower-funnel events or custom parameters). The system must keep working when only upper-funnel goals (`PageView`, `Lead`, `CompleteRegistration`) are allowed: every goal mapping is individually switchable per destination.

### 6.6 Loading browser tags (performance and CSP)
- One **consent-aware loader** (`apps/web/src/lib/tracking/loader.ts`, ≤ 4 KB) loaded with `next/script strategy="lazyOnload"` and the CSP nonce; it injects each provider's script only after consent, only on allow-listed route templates, never before the page is interactive.
- CSP additions (`script-src`, `connect-src`, `img-src`, `frame-src`) are **derived from the enabled integrations** (each provider declares its hosts in code); disabled providers add nothing. `strict-dynamic` stays; the loader is nonce'd and its injected scripts inherit trust.
- Performance budget: no tag may move LCP or INP; Lighthouse runs with tags enabled in CI (consent pre-granted fixture).

---

## 7. Reporting (admin "الحملات" and "التحليلات")

- **Campaign table:** per link and per campaign: clicks (raw / unique / bot-filtered), landing sessions, sign-ups, activations, checkouts, purchases, revenue (net), conversion rates per step, cost (manual or imported later), CAC, ROAS, payback (revenue minus AI cost and rewards; uses Phase 3 margin data). Date range, model selector (first / last non-direct / linear), compare periods, CSV export (`finance.export` for revenue columns).
- **Funnel view:** visit → sign-up → activation → paid within N days, by channel / campaign / landing template / device / country.
- **Channels:** organic search, AI assistants, referral program, paid, direct — the same classification as SEO reports.
- **Destination health:** dispatch success rate, last error, events per day per destination, consent rates by region.
- **Event explorer:** recent events (names, times, goal, destination status) — no personal data beyond user id link for admins with `users.read`.

---

## 8. Data model (summary; DATABASE.md updated in Task 4.6)
`campaigns`, `campaign_folders`, `campaign_links` (+ new columns), `campaign_clicks`, `consent_records`, `user_attribution`, `conversion_goals`, `conversions`, `tracking_integrations`, `conversion_dispatches`. Retention: clicks 13 months, dispatch logs 90 days, consent records for the account lifetime + 3 years (legal hold value from settings), conversions indefinitely (financial reporting).

## 9. Settings (`tracking`)
`consent.regionPolicies`, `consent.policyVersion`, `pixelsOnMedicalContent` (false), `attribution.lookbackDays`, `attribution.defaultModel`, `channel.hostLists` (search, social, AI assistants), `utm.allowedSources`, `clickIds.enabled`, `bots.extraUserAgents`, retention values.

## 10. Permissions
`tracking.read` (reports), `tracking.write` (links, campaigns, goals), `tracking.integrations` (destinations and credentials; fresh auth + 2FA), `finance.export` (existing) for revenue exports.

## 11. Tests (minimum)
Channel classification table tests; attribution first/last touch rules incl. referral precedence untouched; `/c/<slug>` open-redirect, unknown slug, expired link, bot flag; consent: no third-party script tag in HTML or DOM before consent (Playwright with network interception), withdrawal stops dispatch; **payload allow-list test** per destination with a fixture carrying forbidden fields; dedupe ids identical in browser JSON and server dispatch; app routes never include the loader; CSP contains only enabled providers' hosts; outbox retries and idempotency; reports reconcile with `orders` totals.
