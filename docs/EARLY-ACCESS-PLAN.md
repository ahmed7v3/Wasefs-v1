# EARLY-ACCESS-PLAN.md — Pre-launch landing + waitlist on `early.wasfa.online`

Status: **implemented** (see §7 for what differs from the plan) · Branch: `phase6/early-access` · Time budget: **≤ 60 min wall-clock**

Goal: a pre-launch page on a subdomain that does three jobs. It **sells the idea** (hook, design, motion), **collects the useful data** (who they are, where they are, what they'd pay) in two short steps, and **measures the market** (visits → sign-ups funnel, per campaign, per country/city, price demand curve). Admins see and export everything from the admin dashboard.

---

## 1. Decisions (made here, not left to builders)

| # | Topic | Decision | Why |
|---|---|---|---|
| D1 | Where it lives | Inside `apps/web` as route group `app/(early)/early/*`. `proxy.ts` rewrites host `early.wasfa.online` → `/early/*`. New Caddy site block `early.{$SITE_DOMAIN}` → `web:3000`. Cloudflare DNS `early` CNAME (proxied). | Reuses fonts, i18n, `@wasfa/ui`, API client, Turnstile. No new app to build, deploy or secure. |
| D2 | Location data "in the background" | **Cloudflare visitor-location headers** (`CF-IPCountry`, `cf-ipcity`, `cf-region`, `cf-timezone`, `cf-iplatitude/longitude`, city level). Turn on the "Add visitor location headers" managed transform. Browser adds `Intl` timezone, `navigator.language`, device class. **No GPS prompt**: the browser always shows a permission dialog for that, which breaks the "no friction" goal. | Collected silently and accurate to the city. **Not hidden**: one line under the form links to a privacy note that lists what's collected (Egypt Law 151/2020, Saudi PDPL; TRACKING.md §1). No raw IP is stored. A daily-salted hash counts unique visitors and is dropped after 48 h. |
| D3 | Visit counting | Server-side `view` event on page render (RSC). No third-party pixel and no cookie needed for the count. A first-party `wasfa_ea` session id (necessary class: it links your step-1 to your step-2) ties funnel events together. | Counts stay accurate even with ad-blockers. Meets TRACKING.md consent rules. |
| D4 | Phone | `libphonenumber-js/min` in `packages/shared`. Country picker defaults from `CF-IPCountry`. Stored as E.164, unique. Second submit = update, not duplicate. **No OTP** at waitlist stage (WhatsApp verification happens at real sign-up later). | One field, one tap. OTP here would cost ~30% of conversions for no gain. |
| D5 | Country list | All **22 Arab League states**, ordered: detected country first, then GCC + Egypt, then the rest alphabetically (Arabic). Flags are **SVG** (`flag-icons` subset, 22 files). Emoji flags don't render on Windows. | Correct display on every OS. |
| D6 | Pricing question (the "smart" part) | Two taps, local currency. **(a) Price probe (Gabor-Granger, randomized):** "Would you subscribe today at **{X} {currency}/month**?" → نعم / ربما / لا. Each visitor gets a random X from a per-currency ladder. **(b) Fair-price chips:** "What's a fair monthly price for you?" 4–5 local-currency chips + "free only". Ladders live in `site_settings` (`earlyAccess.priceLadders`), safe defaults in code, stored as **integer minor units + ISO currency** (§5.5). | One random probe per person gives an unbiased demand curve (% yes per price) without a boring survey. The fair-price chips give a second signal. Results are split by role and country. |
| D7 | Role | Chips: مريض · مرافق/ولي أمر · طبيب · صيدلي · صاحب صيدلية/عيادة · طالب طب · أخرى. Reuse `PROFESSIONS` from `packages/shared/src/identity.ts` where it fits, plus an `EARLY_ROLES` const. | Segments pricing and features. |
| D8 | One extra signal | "What do you want most?" multi-select chips (the 7 features). Optional, one tap. | Ranks features for the roadmap. |
| D9 | Viral loop | After submit: "You're #N in line". Personal invite link `early.wasfa.online/?r=<code>`. Each friend who joins moves you up. `referred_by` stored. | Cheap growth, and the referral graph is data too. |
| D10 | Campaign links | Reuse `campaign_links` (growth.ts). Short link `early.wasfa.online/c/<slug>` records a `click` event, sets first-touch, then 302s to `/` with UTMs. Plain `?utm_*` links also work. Admin creates and copies links from the dashboard. | §5.1 reuse. One attribution model. |
| D11 | The character | A **"soft-3D" clay character** built from the brand symbol shape: layered radial gradients, specular highlight, contact shadow and rim light in SVG+CSS. Two eyes whose pupils **follow the cursor** (lerped, spring easing), **blink** every 3–6 s at random, slow idle float, small head tilt toward the cursor (CSS `perspective` + `rotateX/Y`). Mobile: follows touch, otherwise looks around on its own. `prefers-reduced-motion` turns it static. ~3 KB JS, zero dependencies. | Looks 3D with no Three.js (~150 KB) hurting LCP or the Lighthouse ≥ 90 goal. **Upgrade path:** a real WebGL version lazy-loaded after LCP if you prefer (see §6, option). |
| D12 | Liquid glass | Header and hero badge: `backdrop-filter: blur() saturate()` + inset highlight + an SVG `feDisplacementMap` refraction edge (Chromium), with a blur-only fallback elsewhere. Header shrinks and gains depth on scroll. | The premium feel in the references, without hurting performance. |
| D13 | Data model | Two new tables (below). Personal data is readable only via `/admin/*` with `users.read`. Exports are **audited** (same pattern as `admin-waitlist.controller.ts`). Logs redact phone/name (§5.7). | Matches existing security model. |
| D14 | Abuse | Public endpoints: `@Public()`, Redis rate limit (10/min/IP), invisible Turnstile on submit, input-size limits, zod at the boundary (§5.2, §5.8). | Public form means bots. |

### Schema (packages/db/src/schema/early-access.ts)

```
early_access_events            -- the funnel + visit counter
  id, occurred_at, session_id, visitor_hash (daily-salted, nullable),
  type: view | click | phone_focus | phone_submit | details_view | details_submit | share
  campaign_link_id → campaign_links (nullable), utm jsonb, referrer_host,
  country, region, city, timezone, device (mobile|tablet|desktop), browser, os, lang,
  variant (headline A/B, nullable), is_bot
  idx: (occurred_at), (type, occurred_at), (country, city), (campaign_link_id)

early_access_signups           -- one row per phone
  id, phone_e164 UNIQUE, phone_country, name, role,
  price_probe_minor, price_probe_currency, price_probe_answer (yes|maybe|no),
  fair_price_minor (nullable = "free only"), fair_price_currency,
  wanted_features text[], ref_code UNIQUE, referred_by_id → self,
  -- captured silently at submit:
  country, region, city, timezone, lat_approx, lon_approx (city-level, 2 decimals),
  device, browser, os, lang, referrer_host, utm jsonb, campaign_link_id,
  first_seen_at, time_to_submit_ms, steps_completed (1|2),
  status: new | contacted | invited | converted, admin_note,
  privacy_ack_at, created_at, updated_at
  idx: (created_at), (country, city), (role), (campaign_link_id), (referred_by_id)
```

Step 1 (phone) creates the row with `steps_completed=1`, so a phone is saved even if the visitor drops off at step 2. Step 2 fills the rest.

### API (apps/api/src/early-access/)

| Route | Auth | Purpose |
|---|---|---|
| `POST /public/early-access/event` | public, rate-limited | funnel events (beacon) |
| `POST /public/early-access/join` | public, Turnstile | step 1: phone → `{ signupId, position, refCode, probePrice }` |
| `PATCH /public/early-access/join/:id` | public + signed token from step 1 | step 2: name, role, price answers, features |
| `GET /public/early-access/stats` | public, cached 60 s | "N people already joined" social proof |
| `GET /c/:slug` (web route on subdomain) | public | campaign click → 302 |
| `GET /admin/early-access/overview?from&to&campaign&country` | `users.read` | KPIs, time series, funnel, geo, roles, price curve |
| `GET /admin/early-access/signups?…filters,sort,page` | `users.read` | table |
| `PATCH /admin/early-access/signups/:id` | `users.write` | status, note |
| `GET /admin/early-access/signups/export.csv` (+ `.xlsx`-friendly UTF-8 BOM) | `users.read`, audited | full export, respects filters |
| `GET /admin/early-access/events/export.csv` | `users.read`, audited | raw funnel export |
| campaign links CRUD under existing growth admin | `growth.write` | create/copy/QR |

---

## 2. Page structure (`early.wasfa.online`, Arabic RTL, light, warm bg `#F6F6F4`)

The reference (`docs/references/4-landing-target.png`) is used for **rhythm, not copying**: calm off-white, generous whitespace, one strong dark section, isometric-line illustrations, character on the side.

1. **Liquid-glass header.** Logo · "كيف يعمل" · "المزايا" · primary pill **"احجز مكانك"** (scrolls to the form). Live counter chip "🔵 ١٬٢٤٠ انضموا" pulled from `/stats`.
2. **Hero** (two columns; stacks on mobile with the character first, small):
   - Glass badge: **«صُنع في العالم العربي — للمرضى والأطباء العرب»** with a small animated glint.
   - H1 options (pick one; the other two become the A/B `variant`):
     - A: **«الخط الصعب؟ خلّيه علينا.»** / sub-line: «وصفة AI تقرأ أصعب الروشتات وتشرح لك دواك، جرعته، ومواعيده… في ثوانٍ.»
     - B: **«افهم دواءك في ثوانٍ — حتى لو خط الطبيب مستحيل.»**
     - C: **«مساعدك الطبي الذكي… على واتساب.»**
   - **Phone capture bar** (the main element): flag + dial-code picker | number input | button «احجز مكاني مجانًا». Under it: three perk ticks: رصيد مجاني · خصم المؤسسين · أول من يجرّب.
   - Opposite side: **the character** (D11), with a soft blurred halo behind it in brand navy → soft blue.
3. **Step 2: pre-booking sheet.** Opens as a bottom sheet / side panel **on the same page** (no page load, phone already saved): name → role chips → price probe (نعم/ربما/لا) → fair-price chips → features (optional) → «تأكيد الحجز». Progress dots, every answer one tap, ~20 s total. Success state: "أنت رقم #N" + invite link + WhatsApp share button + confetti-light micro-animation.
4. **Feature bento grid** (7 cards, lucide icons + small motion on hover/scroll):
   قراءة الخط الصعب بالذكاء الاصطناعي · بوت واتساب سريع وذكي · PDF وصور وتقارير وتذكير بالمواعيد · بدون تحميل ولا تسجيل معقّد · تطبيقات Android و iOS قريبًا · مساعد ذكي تسأله عن أي شيء · ارفع الروشتة واعرف الجرعات والمواعيد والأسماء.
5. **Dark section: "على واتساب، كما تتكلم"**: an animated chat mock (typing dots → reply bubbles with dose times) showing the bot. Text and bubbles only, no prescription images.
6. **How it works: 3 steps** (صوّر أو أرسل ← نقرأ ونفهم ← تحصل على جدولك وتذكيراتك), with isometric line illustrations in the reference's style.
7. **Founding members perks.** Big card: خصم مدى الحياة للمؤسسين · رصيد مجاني عند الإطلاق · تجربة مجانية · اشتراك مجاني للأوائل · وصول مبكر قبل الجميع · أولوية في طلب المزايا. Countdown-free (no fake urgency); "launching soon" ribbon.
8. **Apps coming soon**: App Store / Google Play badges marked «قريبًا», "already works in the browser and WhatsApp, no download".
9. **FAQ** (8–10 Q&As, answer-first, also feeds GEO): ما هي وصفة AI؟ هل هي مجانية؟ متى الإطلاق؟ هل بياناتي آمنة؟ هل تغني عن الطبيب؟ (no, §5.11 disclaimer) …
10. **Final CTA**: the same phone bar repeated + live counter.
11. **Footer**: privacy note link, terms, socials from site settings, «صُنع بحب في العالم العربي».

**Motion system:** one small IntersectionObserver reveal utility (fade-up 12 px, 500 ms, `cubic-bezier(.2,.7,.2,1)`, staggered), CSS-only where possible, all motion off under `prefers-reduced-motion`. No scroll-jacking, no autoplay video. **Eye comfort:** warm off-white, text `#0B1220` at 85%, line-height 1.8 for Arabic, max line ~65ch, contrast AA+.

---

## 3. SEO + GEO

- Fully SSR/static. `generateMetadata`: Arabic title/description with the hook. **Canonical = the subdomain itself.** `og:image` generated with `next/og` (character + headline, 1200×630). Twitter card.
- JSON-LD: `Organization`, `WebSite`, `SoftwareApplication` (`applicationCategory: HealthApplication`, `offers` with `availability: PreOrder`, `areaServed`: the 22 Arab countries), `FAQPage`.
- **Geo SEO:** `areaServed` + country names in natural copy and the FAQ; `hreflang="ar"` + `x-default`. City/country personalization is client-side only, so crawlers always see the same page.
- **GEO (AI engines):** `llms.txt` for the subdomain, an answer-first "what is Wasfa AI" paragraph, FAQ phrased the way people ask assistants, `robots` allows AI crawlers per SEO-GEO.md.
- `robots.ts` + `sitemap.xml` for the subdomain. Core Web Vitals: LCP = H1 text (no hero image), fonts already self-hosted, character JS deferred.
- Target: Lighthouse mobile **Perf ≥ 90, SEO 100, A11y ≥ 95, Best-practices 100** (AGENT.md §7).

---

## 4. Admin dashboard: `/admin/growth/early-access`

- **Filter bar:** date range (today/7d/30d/custom), campaign link, country, city, role, device. All views respect it. URL-synced so filtered views can be shared.
- **KPI tiles:** visits · unique visitors · step-1 sign-ups · completed (step 2) · conversion rate · today's sign-ups · invites sent → joined (viral coefficient).
- **Charts** (inline SVG, no chart lib; per the dataviz skill): sign-ups and visits over time (daily/hourly) · **funnel** view → phone focus → phone submit → step 2 → completed · **geo**: countries table + bars, drill-down to cities · **roles** split · **price**: demand curve (% "yes" per probe price, per currency, filterable by role/country) + fair-price distribution + median.
- **Campaigns table:** link name, clicks, visits, sign-ups, CR, cost-per-signup if cost entered. Sortable. "New link" button: name + slug + UTMs → copy URL + QR (reuses `qrcode`).
- **Sign-ups table:** all columns, sort by any column (date, country, city, role, price, campaign, referrals), search by name/phone, row drawer with full detail + status + note.
- **Export:** CSV of current filter (sign-ups, raw events, campaigns), UTF-8 BOM so Excel shows Arabic correctly. Audited.
- **Settings:** price ladders per currency, headline variant on/off, perks text, counter on/off, all in `site_settings` (§5.9).

---

## 5. Task list and timeline (≤ 60 min, parallel waves)

Per CLAUDE.md: main session (Opus) writes briefs and reviews; Sonnet `builder` implements; Haiku `runner` runs checks. Max 3–4 builders per wave (memory: usage limit). No `git stash` while builders run.

| Wave | Time | Who | Task |
|---|---|---|---|
| **0** | 0–5 min | Opus | Final briefs, shared contracts committed first: zod schemas + consts in `packages/shared/src/schemas/early-access.ts` (`EARLY_ROLES`, `ARAB_COUNTRIES` with dial codes + currency, event types, price ladder defaults, request/response schemas). Add `libphonenumber-js`. |
| **1** | 5–30 min | builder **A** | DB: `early-access.ts` schema + migration + repo functions (insert event, upsert signup, position, referral, admin aggregations: KPIs, series, funnel, geo, roles, price curve, campaigns, list+filter+sort, CSV streams). |
| | | builder **B** | API module `early-access`: public controller (event, join, PATCH step 2 with HMAC token, stats), admin controller (overview, signups, patch, exports, audited), CF-header geo extraction helper, UA parser (device/browser/os, tiny), rate limits, Turnstile. Unit tests for token, geo extraction, price-probe assignment. |
| | | builder **C** | Web page `(early)`: proxy host rewrite, layout + metadata + JSON-LD + og image + robots/sitemap/llms.txt, liquid header, hero, phone bar with SVG-flag picker, step-2 sheet, success/invite state, all sections, reveal utility, i18n keys. |
| | | builder **D** | The character component (D11) + liquid-glass primitives (D12) + chat-mock animation + isometric illustrations (3). Self-contained in `components/early/visual/*`. |
| **2** | 30–48 min | builder **E** | Admin page `/admin/growth/early-access`: filter bar, KPI tiles, SVG charts, funnel, geo drill-down, price curve, campaigns table + create link + QR, sign-ups table + drawer, export buttons. Add to admin nav. |
| | | builder **C/D** (continue) | Wire page to API (events beacon, join, stats counter, `/c/:slug`), A/B variant, reduced-motion, 360 px pass. |
| | | runner | Caddy block `early.{$SITE_DOMAIN}`, compose env (`EARLY_DOMAIN`), CSP update, docs: `REUSE-INDEX.md` rows, `DATABASE.md` tables. |
| **3** | 48–60 min | runner + Opus | `pnpm typecheck && pnpm lint && pnpm test` (+ api integration tests for public join / wrong-owner-hidden on admin), `pnpm --filter @wasfa/web build`, Lighthouse on `/early`. Opus reviews `git diff`, fixes, commits (Conventional Commits). |

**Out of the 60 minutes (needs you, ~5 min):** Cloudflare DNS `early` record + enable "visitor location headers" transform, deploy to EC2 (`compose.prod.yml` pull), Turnstile site key for the subdomain if a new widget is required.

### Definition of done
- [ ] Phone → step 2 → success works on 360 px and desktop, RTL correct, keyboard + screen-reader usable.
- [ ] Admin shows visits, sign-ups, funnel, geo, roles, price curve, campaigns; filters + sort + export work; exports are audited.
- [ ] No raw IP stored; phone/name redacted in logs; public endpoints rate-limited + Turnstile.
- [ ] typecheck / lint / test / build green; Lighthouse targets met.

---

## 6. Open choices (defaults chosen; tell me to change)

1. **Subdomain name:** `early.wasfa.online` (alternatives: `join.`, `soon.`).
2. **Character:** soft-3D SVG/CSS (default, fast) **or** real WebGL (Three.js, lazy after LCP, +~150 KB, +~20 min).
3. **Headline:** A as default, B/C as A/B variants.
4. **Price ladders (defaults, monthly):** EGP 49/79/99/149/199 · SAR 9/15/19/29/39 · AED 9/15/19/29/39 · others in USD 2.99/4.99/6.99/9.99. Editable from admin later.
5. **Countries:** the 22 Arab states only (default) or also a free "other country" option for the diaspora.

---

## 7. As built (differences from the plan)

- Phone validation uses `toEarlyE164` with per-country length rules in `packages/shared/src/schemas/early-access.ts` instead of `libphonenumber-js` (no new dependency).
- Admin write actions (sign-up status/note, campaign links) use the `referrals.write` permission; reads use `users.read`; the settings tab needs `settings.write`.
- The headline A/B variant is chosen in `proxy.ts` (httpOnly `ea_v` cookie) so the server renders the final H1 (no layout shift); bots always get variant A.
- `visitor_hash` is cleared by the daily growth retention job (`pruneEarlyVisitorHashes`), so a hash lives 48–72 h.
- `GET /admin/early-access/links` lists every `campaign_links` row (the table has no per-site marker).
- **Deploy needs:** `WEB_ORIGIN` for the api must include `https://early.wasfa.online` (CORS), Cloudflare DNS `early` (proxied) + "Add visitor location headers" managed transform, Turnstile hostname `early.wasfa.online`, migration `0032_early_access`.
