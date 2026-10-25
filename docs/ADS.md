# ADS.md — Advertising inventory and placement management

> Phase 4, Task 4.7. A first-party ad system: the admin defines placements, sells or reserves them to advertisers, approves creatives, and measures delivery, without third-party ad scripts by default and without ever exposing medical context to advertisers.
> Related: `docs/TRACKING.md` (consent, CSP-from-settings pattern), `docs/CONTENT-PLATFORM.md` (article rendering), BILLING §2 (plan entitlements), GROWTH-STRATEGY §2 (guardrails).

---

## 1. Rules that cannot be configured away

1. **Sensitive surfaces never show ads.** The page classes in §2 are fixed in code; the admin can enable or disable placements only on classes that allow ads.
2. **Ad selection never uses health data.** Targeting is limited to page section/category (contextual), locale, device class and country. No user profile, no prescription, analysis, chat or medicine-history signal is used or shared. Advertisers receive aggregate reports only.
3. **No prescription-only medicine advertising** to the public (prohibited in Egypt and Saudi Arabia, among others); and **no medicine advertising at all on medicine pages** (prevents implied endorsement next to clinical information). Creative categories are reviewed before approval (§6).
4. **Always labelled** «إعلان» / "Sponsored", visually distinct from editorial content and from our own product blocks; links carry `rel="sponsored noopener"`.
5. **No intrusive formats:** no pop-ups, interstitials, auto-playing audio, expanding units, sticky mobile anchors that cover content, or ads above the H1 on mobile. These also hurt search (Google's intrusive-interstitial guidance) and trust.
6. **Zero layout shift and no render blocking:** every slot reserves its box server-side; direct-sold ads need no ad JavaScript.
7. **Paid plans can be ad-free** (`ads_free` plan entitlement, default on for paid plans; editable in the existing entitlements editor).

---

## 2. Page classes

| Class | Pages | Ads |
|---|---|---|
| `marketing` | home, features, audiences, about | allowed (max 1 per page; never in the hero) |
| `conversion` | pricing, register, login, checkout, order pages, join/invite | **never** (protects conversion and payment trust) |
| `content` | blog home, categories, tags, articles, guides, glossary | allowed (rules §3) |
| `medical_reference` | drug hub, ingredient, brand and class pages | allowed with stricter rules (§3.3) |
| `utility_public` | drug search results (noindex), 404 page | allowed (1) |
| `app_neutral` | dashboard home, `/analyze` start screen (before any upload), the analysis **waiting** panel | allowed for free-plan users only; house ads by default (§3.4) |
| `app_sensitive` | analysis results, history, chat, taste comparison, print/share sheets, capture handoff, account, billing, rewards, org, onboarding, admin, legal pages | **never** |

The class is declared by each route segment (`export const adClass = "content"`), checked by a test that walks the route tree: a route without a declared class is treated as `app_sensitive`.

---

## 3. Placement catalog (seeded; admin can enable/disable and adjust sizes, not invent new positions without code)

| Key | Class | Position | Formats (desktop / mobile) | Default |
|---|---|---|---|---|
| `home.mid` | marketing | between "how it works" and "audiences" | 970×250 or responsive banner / 320×100 | off |
| `blog.feed` | content | in the article list, after every 6th card (max 2 per page) | native card (image + title + advertiser) | on |
| `article.inline.1` | content | after the 3rd paragraph (≥ 2 blocks after any heading) | 728×90 / 320×100 or native | on |
| `article.inline.2` | content | after ~60 % of the body, only for articles ≥ 1,200 words | 728×90 / 300×250 | on |
| `article.sidebar` | content | desktop sidebar, sticky within the article column, below the TOC | 300×600 or 300×250 | on |
| `article.end` | content | after sources, before related articles | native card | on |
| `glossary.end` | content | after the definition and examples | native card | on |
| `drug.sidebar` | medical_reference | desktop sidebar below the section nav | 300×250 | off |
| `drug.end` | medical_reference | after sources and the review line | native card | off |
| `drugs.hub.mid` | medical_reference | drug hub, between "popular" and the A–Z index | responsive banner | off |
| `search.top` | utility_public | above results on drug search | 728×90 / 320×100 | off |
| `app.dashboard.card` | app_neutral | dashboard, as the last card of the home grid | native card | off |
| `app.analyze.start` | app_neutral | `/analyze` start screen, **below** the capture controls and tips | native card / 320×100 | off |
| `app.analyze.waiting` | app_neutral | the processing panel, below the progress steps | native card | off |

### 3.1 Density limits (settings `ads.maxPerPage`, defaults)
Article: 3 on desktop (2 inline + sidebar) and 2 on mobile, plus `article.end`. Glossary: 1. Drug pages: 2. Marketing: 1. App neutral: 1. A page never shows two ads of the same advertiser.

### 3.2 Spacing rules (enforced by the renderer)
- At least two content blocks between inline ads; never directly after a heading; never inside or adjacent to `:::warning` boxes, tables, lists of side effects, or sections tagged sensitive (pregnancy, overdose, interactions, children).
- Never adjacent to our own product CTA block (no confusion between our offer and an ad).

### 3.3 Medical reference pages
- Disabled by default; when enabled, only advertiser categories allowed on `medical_reference` (default: pharmacies and delivery, insurance, labs/clinics directories, health devices, wellness apps; **never** medicines or supplements with health claims).
- Contextual targeting by therapeutic class is allowed (e.g. "diabetes devices" on antidiabetic pages) **only** with a creative that makes no claim about the medicine on the page.

### 3.4 App neutral placements
- Free-plan users only (`ads_free` entitlement hides them), never during an upload, never above the upload controls, never in the result.
- Defaults to **house ads** (our own offers: credit packs, rewards invitations, plans) so the slot has value from day one; paid advertisers can be allowed per placement (`allowPaid`) for approved categories only.
- The waiting panel ad cannot delay, overlay or reorder progress information.

---

## 4. Selling and reserving inventory

### 4.1 Entities
| Table | Purpose |
|---|---|
| `advertisers` | name, legal name, contact (encrypted email/phone), category, status (`pending`/`approved`/`blocked`), notes |
| `ad_campaigns` | advertiser, name, flight `starts_at`/`ends_at`, booking type, priority, pricing model (`flat`, `cpm`, `house`), contract value (minor units + currency), impression goal, frequency cap, targeting (placements, page classes, categories/therapeutic classes, locale, device, country), status (`draft`/`scheduled`/`live`/`paused`/`ended`) |
| `ad_creatives` | campaign, format, image media id(s) per size, headline (≤ 60), body (≤ 120), CTA label, destination URL (https, validated, UTMs appended per settings), alt text, locale, status (`draft`/`in_review`/`approved`/`rejected`), reviewer, rejection reason |
| `ad_placements` | key (§3), class, enabled, sizes, `allowPaid`, max per page override, notes |
| `ad_bookings` | campaign × placement × date range × share of voice (`exclusive` = sponsorship 100 %, or weight) |
| `ad_stats_daily` | date × placement × creative: served, viewable, clicks (aggregates only) |

### 4.2 Booking types
- **Sponsorship (exclusive):** one campaign owns a placement for a date range; conflicts are refused at booking time.
- **Share of voice:** weighted rotation among overlapping campaigns on the same placement.
- **House:** fills unsold inventory; always the lowest priority.
- An **inventory calendar** per placement shows booked, available and house-filled days for the next 90 days, with estimated impressions from the last 28 days of served counts (an estimate, labelled so).

### 4.3 Selection (server-side, per request, cheap)
For a rendered page: eligible placements (class, enabled, density, user not ad-free) → for each, active bookings matching targeting → exclusive first, else weighted random by share, respecting frequency caps (per visitor only with `analytics` consent; otherwise per page view rotation) and "one ad per advertiser per page" → creative by locale/size. Cached campaign data (invalidated on change) keeps it under 1 ms per slot.

---

## 5. Measurement (first-party, aggregate)

- **Served:** counted when the slot is rendered (server-side).
- **Viewable:** a tiny shared observer (≤ 1 KB, part of the public client bundle only on pages with slots) sends a beacon when ≥ 50 % of the slot is visible for ≥ 1 s (IAB/MRC display standard). Beacons carry only the signed slot token (placement, creative, timestamp) — no visitor id, no page URL beyond the route template. Counted regardless of consent because no identifier or personal data is involved; documented in the privacy policy.
- **Clicks:** `/a/<token>` (signed, expires after 24 h) counts and `302`s to the creative's approved URL. Bot filtering as in TRACKING §4.2.
- **Reports:** per campaign and creative: served, viewable, viewability rate, clicks, CTR, delivery vs goal pacing, by placement/day; CSV and a shareable advertiser report page (signed link, expires, no internal data).
- **No third-party measurement pixels** from advertisers on our pages (an advertiser may add UTMs to the destination to measure on their side).

---

## 6. Creative review (approval workflow)

Checklist shown to the reviewer (`ads.approve`), stored with the decision:
1. No prescription-only medicine, no medicine on `medical_reference` pages, no supplement with disease claims.
2. No misleading health claims, before/after images, fear messaging, fake system alerts, or imitation of our UI.
3. Landing page works, is https, matches the ad, and does not ask for health data without a privacy policy.
4. Arabic/English copy correct; image within size budget (≤ 80 KB per size, generated through the media pipeline); alt text present.
5. Category allowed for the targeted placements.
Rejections carry a reason the sales owner can share with the advertiser.

---

## 7. Optional ad network (off by default)

An `adNetwork` provider (Google AdSense first) can fill unsold `content` placements only:
- Disabled by default; requires the owner to confirm policy eligibility (health-content restrictions apply to some networks) and counsel's view on consent.
- Loads only after `ads` consent; without consent it either stays empty or requests non-personalised ads where the network supports it (setting).
- Never on `medical_reference`, `app_neutral` or any app page.
- CSP hosts come from the provider definition only when enabled (TRACKING §6.6 pattern). Performance gates (Lighthouse with the network on) must pass before enabling in production; if they fail, the network stays off.

---

## 8. Admin screens (group «الإعلانات»)
Placements (list with class, status, density, preview of where it renders on desktop/mobile), Advertisers, Campaigns (wizard: advertiser → flight & booking → targeting → creatives → review), Creatives review queue, Inventory calendar, Reports, Settings (`ads.enabled` global kill switch, per-class switches, density, labels, frequency caps, network provider). Permissions: `ads.read`, `ads.write`, `ads.approve`, `ads.settings` (fresh auth).

## 9. Tests (minimum)
Route-class walk (every route declares a class; sensitive classes render no slot even if a booking targets them); density and spacing rules on article fixtures; ad-free entitlement hides slots; selection (exclusive vs weighted, frequency cap, one-per-advertiser); click token signing/expiry and open-redirect protection; viewability beacon carries no identifier; CLS = 0 with slots on (Playwright layout-shift observer); CSP unchanged when the network provider is off; reports reconcile `ad_stats_daily` with logs.
