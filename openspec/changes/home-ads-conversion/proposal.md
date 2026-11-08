## Why

The owner wants the public site to sell as well as the pre-launch page `early.wasfa.online` does, to earn from
advertising without hurting trust or search, and to turn free users into subscribers with clear, well-timed
upgrade moments. Today:
- the home page (`apps/web/src/app/(marketing)/page.tsx`, 10 sections) has the older look; the early page's
  visual system (mascot `WasfaCharacter`, glass surfaces, halo backdrop, reveal motion, iso illustrations,
  WhatsApp chat mock in `components/early/visual/*`) is used only on `/early`;
- **no ad system exists**: `docs/ADS.md` is design only (no tables, api, admin, slots);
- the growth prompt engine exists (`apps/api/src/growth/prompts.service.ts`: credits_out, credits_low,
  expiring_free_credits, analysis_taste, plan_expiring, org_usage; ≤1 per session, cooldown), but it renders
  **inline cards only**, mostly on the dashboard, has no trial-ended moment, and admins cannot edit prompts.

## Owner decisions (2026-11-08)

1. **One change** for home page, SEO, ads and conversion.
2. **Ads: maximum placement, everything admin-configurable** (positions, density, page classes, the closable
   bottom banner, on/off per placement and globally). A small **non-configurable floor** stays because it is
   legal or medical-safety: no ads on results, history, chat, checkout/payment, account or admin; always
   labelled «إعلان»; no medicine ads; no targeting by health data; `rel="sponsored"`; no layout shift.
3. **Pop-ups: a real modal at calm moments only**: after the free trial/welcome credits end and when
   credits reach zero, shown on the dashboard or the analyze start screen; never during an upload, an
   analysis, a result or an error; at most one per session; one-tap close; cooldown after dismissal.
5. **WhatsApp ads (2026-11-08, follow-up):** simple image or text ads sent by the WhatsApp agent after
   selected moments (after an analysis result, after selected commands), most of the time but not every time,
   with an admin on/off switch.
4. **Advertisers: house ads + direct-sold**, managed in Admin (image, link, dates, placement, targeting by
   page/device/locale, on/off, stats). No third-party ad scripts.

## What Changes

- **Home page in the early style**: the early visual primitives move to a shared location; every current
  home section is rebuilt in that style; the early phone-capture area becomes sign-up / sign-in (email,
  Google, WhatsApp) and "open your dashboard" for signed-in visitors. Fully responsive, RTL-first, fast.
- **SEO/GEO**: strongest-practice metadata, structured data, internal linking, performance budgets and
  automated checks for the home page and the whole public site, using the existing builders in
  `lib/seo.ts` and `lib/structured-data.ts`.
- **Ad system (first-party)**: placements catalog, creatives, schedule and targeting, delivery with reserved
  boxes, closable bottom banner, click redirect and impression counting, daily stats, `ads_free` plan
  entitlement, full admin console.
- **Conversion**: prompt forms (inline / banner / modal), new trial-ended moment, credits-out modal, more
  surfaces (analyze start, locked features), and an admin console for every prompt (on/off, form, copy ar/en,
  target plan, CTA, cooldown, preview), with truthful copy tied to plan entitlements.
- **WhatsApp ads**: a WhatsApp channel on creatives (image + caption or text), trigger moments, probability
  and caps, opt-out command, anti-ban limits, same stats and admin.
- **Docs**: `docs/ADS.md` and `docs/GROWTH-STRATEGY.md` rules updated to these decisions.

## Capabilities

### New Capabilities
- `marketing/home-page`: the public landing page, its sections, entry points and responsive behaviour.
- `marketing/seo`: search and AI-discoverability requirements for the public site.
- `ads/placements`: ad inventory, delivery rules, admin management and measurement.
- `ads/whatsapp-ads`: ads sent by the WhatsApp agent: triggers, frequency, formats, floor and limits.
- `growth/conversion-prompts`: upgrade moments, their forms, timing rules and admin control.

### Modified Capabilities
- (none; these areas had no specs yet)

## Out of scope

- Third-party ad networks (AdSense etc.), advertiser self-service and online ad payment (bookings are
  recorded by the admin).
- New paid plans or price changes (prompts use the existing plans and entitlements).
- Blog/article ad placements beyond what the existing content pages can host in this change (catalog keys
  exist; rendering inside articles can follow).

## Impact

- `apps/web` (home page, shared visual components, ad slot renderer, bottom banner, prompt modal, admin pages),
  `apps/api` (ads module, growth prompts extensions, admin endpoints), `packages/db` (ad tables + migration,
  prompt config), `packages/shared` (schemas, settings, i18n), `apps/worker` (daily ad stats roll-up).
- New migration (must be timestamped after production's last applied migration; see the migration-order
  rule in tasks).
- WhatsApp agent: event consumer (after rx_done) on `main`; command triggers need the command layer from
  `setup-openspec` (merged first, or added when it lands).
- Privacy policy text (first-party ad measurement, no ad cookies) and `docs/ADS.md`, `docs/GROWTH-STRATEGY.md`.
