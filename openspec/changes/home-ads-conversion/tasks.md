# Tasks

Implementation branch: `feat/home-ads-conversion` from `origin/main`. Migration rule: number after main's last
migration, journal `when` later than production's last applied migration (see design Risks).

## 0. Groundwork

- [x] 0.1 [main] Land the OpenSpec setup (openspec/, .claude/commands+skills, CLAUDE.md section) on `main` in
      its own small PR so changes are visible where the code is built.
- [x] 0.2 [runner] Create `feat/home-ads-conversion` from `origin/main`; copy this change folder into it.

## 1. Shared visual system and home page (D1, D2)

- [x] 1.1 [builder] Move `components/early/visual/*` to `components/visual/*`; update `/early`; visual
      parity check (screenshot test of `/early` before/after).
- [x] 1.2 [builder] `landing` settings: sections (key, enabled, order) + per-section copy, defaults = current
      copy; admin fields.
- [x] 1.3 [builder] Rebuild every home section in the early style (`components/home/*`), hero entry points
      (register / login / WhatsApp; dashboard when signed in), reduced-motion, 320 px → wide.
- [x] 1.4 Verify — [runner] web typecheck/lint/unit; Playwright: home at 320/768/1440 no horizontal scroll,
      44 px targets, axe clean; signed-in hero shows dashboard.

## 2. SEO (D3)

- [x] 2.1 [builder] Metadata (hreflang, OG per page), home JSON-LD set (Organization, WebSite+SearchAction,
      SoftwareApplication from plans, FAQPage from FAQ data), BreadcrumbList on public pages; unit tests on
      builders.
- [x] 2.2 [builder] Lighthouse CI budgets as failing assertions (mobile); `llms.txt` + answer block from
      settings; robots/X-Robots-Tag for `/a/*`.
- [x] 2.3 Verify — [runner] Lighthouse job green with budgets; structured data validated in tests.

## 3. Ads (D4, D5, D6)

- [x] 3.1 [main] Final review of the schema and the safety-floor code before building.
- [x] 3.2 [builder] Migration + schema + repos; seed placements; `ads` settings; `adClass` on every route + route
      test; `ads_free` entitlement (default on for paid plans).
- [x] 3.3 [builder] Selection service (eligibility, schedule, targeting, weights, density, advertiser dedupe,
      entitlement), `<AdSlot>` server component, impression beacon, `/a/<token>` redirect, Redis counters,
      `ads.rollup` worker job.
- [x] 3.4 [builder] Bottom banner island (reserved spacer, close, dismiss days, safe-area), home placements.
- [x] 3.5 [builder] Admin `/admin/ads` (overview, placements, creatives with media picker + approval category
      check, advertisers), permissions and audit.
- [x] 3.6 Verify — [runner] api/worker/web tests; Playwright: no ad on result/chat/checkout even with all
      placements on; banner closes and does not cover content; CLS budget holds with ads on.

## 4. Conversion prompts (D7)

- [x] 4.1 [main] Final default copy (ar/en) for trial_ended and credits_out modals, and the banned-claims list.
- [x] 4.2 [builder] Settings-backed prompt catalog (defaults = today), `trial_ended` trigger from the ledger,
      `surface` + calm rule in `next()`, placeholders from plans/entitlements, claims lint.
- [x] 4.3 [builder] `prompt-modal.tsx`, banner form, analyze-start surface, in-progress guard; events.
- [x] 4.4 [builder] Admin `/admin/growth/prompts` (list, edit, preview, enable, counts).
- [x] 4.5 Verify — [runner] unit tests of triggers/calm/cooldown; Playwright: modal after trial ends on
      dashboard, never during an analysis, one per session, cooldown after dismiss.

## 6. WhatsApp ads (D9)

- [x] 6.1 [builder] Creative channels + WhatsApp fields, `ads.whatsapp` settings, admin form (channel, text,
      image, preview of the WhatsApp message), `ads_opt_out` flag.
- [x] 6.2 [builder] `maybeWhatsAppAd` (switch, trigger, floor, caps, quiet hours, probability, content-blind
      selection) + hook after delivered `rx_done`; opt-out keywords; stats under channel whatsapp.
- [ ] 6.3 [builder] Command triggers (help, balance, report, schedule) once the command layer is on `main`.
- [x] 6.4 Verify — [runner] api unit tests: never after rx_failed/payment/takeover/ads-free/opt-out, caps and
      gap, probability with a seeded draw, global daily limit, selection independent of analysis content.

## 5. Docs and release

- [x] 5.1 [runner] Update `docs/ADS.md`, `docs/GROWTH-STRATEGY.md`, privacy policy ad-measurement text.
- [ ] 5.2 [main] Review full diff against the five specs; PR to `main`; owner enables ads/prompts in admin after
      deploy.
- [x] 5.3 Verify — [runner] `openspec validate home-ads-conversion --strict`, full CI green.
