## Context

- Home: `apps/web/src/app/(marketing)/page.tsx` (LandingHero, WhatsAppSection, SkillsGrid, PrecisionWalkthrough,
  HowItWorks, Audiences, TrustSection, FaqSection, AppsBand, FinalCta, MascotSprite, JSON-LD); settings key
  `landing` (`packages/shared/src/settings.ts`), edited in the generic `/admin/settings`.
- Early: `apps/web/src/app/(early)/early/page.tsx`, `components/early/{EarlyHero,EarlySections,PhoneCapture}.tsx`,
  visual primitives `components/early/visual/*` (WasfaCharacter, GlassSurface/GlassBadge, HaloBackdrop, Reveal,
  IsoIllustration, WhatsAppChatMock, early-visual.css), used only by `/early`.
- SEO: `lib/seo.ts` (pageMetadata), `lib/structured-data.ts` (builders), sitemaps, robots, `llms.txt`, settings
  key `seo`; CI already runs a Lighthouse job on the home page.
- Growth: `apps/api/src/growth/prompts.service.ts` (`next()`, 6 triggers, ≤1/session, cooldown), web
  `components/growth/prompt-slot.tsx` (inline card + events), settings group `growth`.
- Ads: nothing built; `docs/ADS.md` is the reference design (page classes, catalog, rules).
- Auth: `/register`, `/login`, `components/auth/{register-form,login-form,social-buttons,whatsapp-login}.tsx`.
- **Branches:** production is `main`; this repo's OpenSpec and the reading work live on `setup-openspec`, which
  is not merged yet. Implementation of this change happens on a branch from `origin/main`.

## Goals / Non-Goals

**Goals:** the early look everywhere public; SEO budgets enforced in CI; a working, admin-run ad business;
upgrade modals at the right moments; every knob in the admin.

**Non-Goals:** ad networks, advertiser self-service, new plans/prices, article-body ad rendering beyond the
slot component (keys seeded, rendering can follow).

## Decisions

### D1 Shared visual system
Move `components/early/visual/*` to `apps/web/src/components/visual/*` (same names), update `/early` imports.
The home sections become `components/home/*` built on them. `components/marketing/mascot.tsx` is retired in
favour of `WasfaCharacter`. Performance: the hero mascot is SVG/CSS (no Lottie). Images are AVIF/WebP via
`next/image` with explicit sizes. Below-the-fold sections hydrate lazily (client islands only where interactive).

### D2 Home entry points
Hero primary: signed out → `/register` («ابدأ مجانًا»), secondary «تسجيل الدخول» → `/login`, plus the WhatsApp
sign-up block (existing `whatsapp-login`). Signed in (session cookie check on the server) → «افتح لوحة التحكم».
The phone-capture component stays only on `/early`. `landing` settings gain `sections: {key, enabled, order}[]`
plus per-section copy fields (zod, admin-editable, defaults = current copy).

### D3 SEO
- `pageMetadata` adds hreflang alternates and absolute OG images per page; home gets Organization, WebSite
  (+SearchAction to drug search), SoftwareApplication (offers from plans), FAQPage (from the FAQ section's data,
  one source), BreadcrumbList on every public page.
- Lighthouse CI budgets: LCP ≤ 2.5 s, CLS ≤ 0.05, INP proxy (TBT ≤ 200 ms), SEO ≥ 95, a11y ≥ 95 on the home page
  (mobile profile). The job fails on a breach.
- `llms.txt` and an answer-first "what is Wasfa" block read plan facts from settings/plans.
- `/a/*` (ad redirect) disallowed in robots and sent with `X-Robots-Tag: noindex`.

### D4 Ads data model (`packages/db`, one migration)
- `ad_placements` (key PK, enabled, page_classes text[], devices text[], max_per_page, format, size_desktop,
  size_mobile, closable, dismiss_days, allow_paid, sort): seeded from the ADS.md catalog plus `global.bottom_banner`
  and extra `home.*` keys (`home.after_hero`, `home.mid`, `home.before_faq`) per owner decision 2.
- `advertisers` (id, name, category, contact, active).
- `ad_creatives` (id, advertiser_id null = house, title, image media id, alt, target_url, category, status
  draft|approved|paused|archived, starts_at, ends_at, weight, targeting jsonb {placements[], pageClasses[],
  devices[], locales[], countries[]}).
- `ad_stats_daily` (creative_id, placement_key, day, impressions, clicks) PK (creative, placement, day).
- Settings key `ads`: `enabled` (global kill switch), `maxPerPage` per page class, bottom banner defaults.
- Page classes and the safety floor are **code** (`packages/shared/src/ads.ts`): every route segment exports
  `adClass`; a route test fails when a route lacks one (missing = `app_sensitive`). Floor: classes
  `conversion`, `app_sensitive` can never serve; category `medicine` can never be approved.

### D5 Delivery
- Server component `<AdSlot placement="home.mid" pageClass="marketing" />` reserves the box with the configured
  aspect ratio, picks a creative server-side (eligible, scheduled, targeted, weighted random, no repeat of the
  same advertiser on a page, density cap per page class, ads-free entitlement check) and renders a plain
  `<a href="/a/<token>" rel="sponsored noopener">` with `next/image`. No ad JavaScript except a tiny shared
  IntersectionObserver beacon (impression = 50 % visible for 1 s) posting to `/api/ads/i` (batched).
- `/a/<token>`: token = signed (HMAC) creative + placement + day; increments clicks; 302 to target.
- Bottom banner: a client island fixed to the bottom with a matching spacer appended to the page (never
  covers content), close button stores `adBannerClosedUntil` in localStorage (no cookie), respects safe-area insets.
- Worker job `ads.rollup` folds the Redis counters into `ad_stats_daily` every 5 min (counters keyed by
  creative/placement/day; no user data).

### D6 Admin (group «الإعلانات», `/admin/ads`)
Overview (global switch, today/7-day impressions, clicks, CTR per placement and creative), Placements (toggle,
classes, devices, density, sizes, banner dismiss days, preview), Creatives (create/edit with media picker,
targeting, schedule, approve/pause with category check), Advertisers. Permissions `ads.read` / `ads.write`,
audited like other admin writes.

### D7 Conversion prompts
- Prompt catalog moves from code constants to a settings-backed catalog (`growth.prompts[key]`: enabled, form
  inline|banner|modal, copy {ar,en} with placeholders {plan},{price},{analyses},{renewDate}, targetPlan,
  cta {label, href}, cooldownDays). Defaults equal today's behaviour plus two new keys.
- New moment `trial_ended`: free user, welcome/trial credits granted and fully spent (from the credit ledger:
  `trial` period source exhausted), not yet shown. `credits_out` gains the analyze start surface.
- Calm rule in the engine: `next(user, context)` accepts `surface` ∈ {dashboard, analyze_start, result, ...};
  modal form is returned only for `trial_ended|credits_out` and only on `dashboard|analyze_start`; the client
  additionally refuses to open a modal while an upload or analysis is in progress (state flag).
- Copy rendering fills placeholders from plans/entitlements at request time. The admin preview shows the
  filled text. A lint in the admin save path rejects copy containing banned claims (list in settings:
  «أدق»/«more accurate» unless the target plan has a deeper analysis mode entitlement, health-outcome words).
- Web: `components/growth/prompt-modal.tsx` (focus-trapped dialog, one-tap close, Esc, reports
  shown/clicked/dismissed), banner form reuses the shell banner, inline stays `prompt-slot`.
- Admin page `/admin/growth/prompts`: list, edit, preview, enable, counts.

### D9 WhatsApp ads
- Creatives gain `channels` (web, whatsapp) and WhatsApp fields: `waText` (≤ 700 chars, the «إعلان» label is
  added by code), optional image (media library). Links go through `/a/<token>` with channel `whatsapp`.
- Settings `ads.whatsapp`: `enabled` (false), `triggers` (after_rx_done, after_command:{help,balance,report,
  schedule}), `probability` (0.7), `maxPerUserPerDay` (2), `minGapHours` (6), `globalDailyLimit` (300),
  `quietHours` (23:00–08:00 Africa/Cairo), `allowOptOut` (true).
- One deterministic function `maybeWhatsAppAd(conversation, trigger)` (no model): checks switch, trigger,
  floor (ads-free plan, takeover pause, failure/payment context, opt-out), caps in Redis (per user/day, gap,
  global/day), quiet hours, then the probability draw; picks a creative with channel whatsapp by weight and
  schedule only (never by message or analysis content); queues it as one extra outbound part after the
  trigger's own parts, so normal 24-hour window, typing, delay and per-turn caps apply.
- Hook points: on `main`, `WaAgentEventsConsumer` after a delivered `rx_done` (not `rx_failed`, not payment
  events). Command triggers hook into the command router on `setup-openspec` once that branch is on `main`.
- Opt-out: the commands «وقف الإعلانات» / «شغل الإعلانات» set a per-user flag (`wa_conversations.ads_opt_out`);
  until the command layer lands, the bridge's keyword routing handles them like STOP/START.
- Stats: sent = impression (channel whatsapp), clicks via the redirect; the admin shows the WhatsApp channel
  separately. No message text is stored in ad tables.

### D8 Rule documents
`docs/ADS.md` §1–3 and `docs/GROWTH-STRATEGY.md` §2/§4 are updated in this change to the owner decisions
(admin-configurable density and banner; modals at calm moments) and keep the safety floor verbatim.

## Risks / Trade-offs

- **SEO cost of heavy ads** (Google's intrusive guidance) → banner reserves space and is closable; budgets in CI
  catch CLS/LCP regressions; admin can scale density down.
- **Trust cost of modals** → calm surfaces only, one per session, cooldown doubling, truthful copy lint.
- **Two diverged branches** → implementation from `origin/main`; the new migration must be numbered after
  `main`'s last migration and timestamped after production's last applied one (Drizzle skips older
  timestamps); whichever of this change and the `setup-openspec` merge lands second renumbers its migration.
- **Privacy** → no ad cookies, no user ids in ad tables; privacy policy text updated.

## Migration Plan

1. Ship the shared visuals and the new home page behind the existing `landing` settings (sections can be
   toggled).
2. Ship ads with `ads.enabled = false` and only house creatives; the admin turns placements on after review.
3. Ship prompt catalog with defaults equal to today; enable the modal moments from the admin.
Rollback: `ads.enabled = false`, prompt moments off, home sections toggled; code revert if needed.

## Open Questions

- The free plan's "trial": confirm it is the welcome credits (referral 20) or the first month's free credits
  (default assumed: whichever trial-period grant the user received first).
