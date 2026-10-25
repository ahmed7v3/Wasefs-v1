# Phase 4 — Discoverability, content engine, campaigns and ad inventory

> **Outcome:** Wasfa AI becomes findable and citable: a fast, credible public site in Arabic and English; a medically reviewed content engine (blog, guides, glossary, medicine pages) that the owner runs from a phone and automation feeds through a secure Publishing API; campaign links, consent-aware pixels and server-side conversions ready for paid advertising; and a first-party ad inventory that never touches medical privacy. The live-site console errors and the Phase 3 Lighthouse gaps are fixed first.
>
> **Specs (read the section a task points to, not everything):** `docs/SEO-GEO.md`, `docs/seo/keyword-map.csv`, `docs/CONTENT-PLATFORM.md`, `docs/PUBLISHING-API.md`, `docs/TRACKING.md`, `docs/ADS.md`, `docs/BRAND-AND-HOMEPAGE.md`. Project rules: `docs/AGENT.md` (§5 golden rules, §7 testing, §8 definition of done).
>
> **Shape:** 8 work packages in 3 releases plus a final gate. Each package is a coherent, independently reviewable unit with its own acceptance list. Releases are deployable on their own.

---

## 0. Scope

### In scope
1. Live-site fixes (Cloudflare HTML rewriting → hydration error #418 and CSP violation), public performance (render-blocking CSS, legacy JS, unused JS, the Phase 3 pricing/checkout Lighthouse gap), Lighthouse CI.
2. Public URL and locale architecture (Arabic default, English under `/en`), SEO core (metadata, robots, sitemap index, hreflang, structured data library, AI crawler policy, IndexNow, `llms.txt`).
3. Brand system: new logo and favicon set, admin-managed icon generation, OG/X card renderer, public media library and image pipeline.
4. Homepage refresh: hero, new precision section, scroll motion system, FAQ motion, footer logo, "apps coming soon", English homepage, feature and audience pages.
5. Content platform: articles, guides, glossary, pages; categories, tags, authors and medical reviewers; drafts, review, scheduling, revisions, previews; SEO panel and quality gates; public templates; RSS.
6. Publishing API for AI agents and automation (keys, scopes, signing, idempotency, media, webhooks, OpenAPI, audit).
7. Medicine pages (programmatic SEO): monographs with sources and review, ingredient/brand/class pages, public drug search, indexability rules; SEO dashboard with Search Console sync, health job and AI-visibility measurement.
8. Campaign links, attribution, consent management, pixels (GA4, Google Ads, Meta, TikTok, Snap), server-side conversions with deduplication, goals, reports (includes deferred Phase 3 Task 3.16).
9. Advertising inventory: placements by page class, advertisers, campaigns, bookings, creative review, first-party measurement, optional network provider (off).

### Explicitly out of scope (moved to Phase 5 or later, with reason)
| Item | Where | Reason |
|---|---|---|
| Support tickets, canned replies, Web Push, ticket email replies, error-ref linking | **Phase 5** | independent of discoverability; keeps Phase 4 focused |
| Full launch-readiness pass: load test of AI + auth endpoints, restore drill, full `SECURITY.md` checklist re-run | **Phase 5** (Phase 4 covers its own new endpoints) | belongs right before public launch |
| English UI for the signed-in app and admin | Phase 5 | public pages are what search sees; the app stays Arabic |
| Drug-pair interaction pages, price pages, pill identification, city doorway pages | not planned | SEO-GEO §14 (data, safety and policy reasons) |
| Native Android/iOS apps | later | only a "coming soon" announcement now |
| Article comments, user-generated content, newsletter product | later | moderation cost and medical risk |
| Real-time co-editing | later | conflict warning instead (CONTENT-PLATFORM §4.5) |
| Ad-platform cost import APIs (Meta/Google spend) | later | manual cost entry in Phase 4 |

### Systems that must keep working (regression guard for every package)
Authentication (email, Google, phone), onboarding, prescription analysis pipeline and result UI, assistant chat and SSE, credits ledger and quotas, plans/prices/price engine, checkout (Kashier and manual methods), webhooks and reconciliation, subscriptions and renewals, referrals/points/withdrawals, organisations and join links, admin console and RBAC, admin alerts, WhatsApp bridge, email sending, the existing referral cookie `wasfa_ref` and `/r/<code>`, and the existing CSP nonce model. **The full existing unit, integration and Playwright suites stay green at the end of every package.**

---

## 1. Success measures

| Area | Target | How it is measured |
|---|---|---|
| Console health | 0 console errors and 0 CSP violations on `/`, `/pricing`, an article, a drug page, `/register` in production | Playwright smoke against production (read-only) after each deploy |
| Lab performance (mobile) | Lighthouse Performance ≥ 95 on `/`; ≥ 90 on `/pricing`, checkout, article, ingredient page, blog home; Accessibility 100; SEO 100; Best Practices 100 | Lighthouse CI with budgets in the pipeline (median of 3 runs) |
| Field performance | p75 LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1 per template | CrUX API (when traffic allows) + first-party RUM (`web-vitals` beacon, 1 KB) |
| JS weight | first-load JS ≤ 80 KB compressed on `/`, ≤ 100 KB on other public templates | build report check in CI |
| Origin speed | p75 TTFB ≤ 300 ms for article/drug pages at 50 req/s on the production VPS | load test in WP1 spike and WP8 |
| Indexation | ≥ 90 % of submitted indexable URLs indexed within 60 days of submission | Search Console sitemaps + URL Inspection sampling |
| Content quality | 0 indexable medical pages without an approved review; 0 overdue reviews on indexable pages | admin Medicines SEO screen + nightly health job |
| SEO hygiene | 0 broken internal links, 0 redirect chains, 0 duplicate titles among indexable pages | nightly SEO health job |
| Privacy | 0 third-party requests before consent; 0 forbidden fields in any outbound tracking payload | Playwright network assertions + payload allow-list tests |
| Ads | CLS contribution from ad slots = 0; 0 slots rendered on sensitive routes | layout-shift observer test + route-class walk test |
| Business (tracked, not gated) | organic sign-ups, non-brand organic clicks, AI-assistant referrals, campaign CAC/ROAS | admin SEO and campaign dashboards |

No ranking or AI-citation target is set: those are outcomes we influence, not control.

---

## 2. Owner prerequisites (needed before or during the named package)

| # | Item | Needed by |
|---|---|---|
| O1 | **Cloudflare:** turn off *Email Address Obfuscation* (Scrape Shield) for `wasfa.online` (or a Configuration Rule with Email Obfuscation off); confirm *Rocket Loader* is off; decide on *JavaScript Detections* (it injects an un-nonced script that our CSP blocks); align *AI Crawl Control / Managed robots.txt* with SEO-GEO §10.4 | WP1 (first day) |
| O2 | Cloudflare R2 **public media bucket** + custom domain (e.g. `media.wasfa.online`) and its credentials | WP2 |
| O3 | Choose the logo direction (A/B/C, BRAND-AND-HOMEPAGE §1.1) after seeing the drafts | WP2 |
| O4 | Confirm which features are live for homepage copy, and whether English public pages launch with Phase 4 | WP2 |
| O5 | At least one **medical reviewer** (licensed pharmacist or physician): profile, photo, credentials, consent to publish name; weekly review capacity (sets publish caps) | WP3 / WP5 |
| O6 | Google Search Console **Domain property** (DNS TXT) + add the service account as a user; Bing Webmaster Tools; optional Ahrefs/Semrush access and a Google Ads account for Keyword Planner | WP5 |
| O7 | Confirmation of permitted clinical sources (EDA leaflets, SFDA leaflets, EMA, DailyMed) and any licensed drug data/images | WP5 |
| O8 | Legal review: consent banner text, privacy policy updates (tracking, ads, viewability counting), advertising policy page, region consent policies | WP6 / WP7 (production enablement, not build) |
| O9 | Ad platform accounts and ids/tokens (Meta pixel + CAPI token, GA4 + MP secret, Google Ads conversion ids, TikTok, Snap) — fake destinations are used until then | WP6 (production enablement) |
| O10 | Advertising sales policy: allowed advertiser categories, prices (flat/CPM) | WP7 |

---

## 3. Decisions (recorded in `docs/ARCHITECTURE.md` decision log, rows 56–72)

1. **Public pages keep the per-request CSP nonce** and render per request; their data comes from the API through Next's tagged data cache, invalidated by a signed revalidation call on publish. If the WP1 spike shows p75 TTFB > 300 ms at 50 req/s, the fallback is static generation for content routes with a hash-based CSP for those routes only, decided with measurements in the Notes.
2. **Locales:** Arabic unprefixed, English under `/en`. One root layout derives `lang`/`dir` from the path the proxy already forwards (`x-pathname`); no route-tree duplication. The signed-in app stays Arabic in Phase 4.
3. **Content body format:** Markdown + a small directive set, rendered and sanitised **at save time** in the API (`body_html` stored); public pages ship no Markdown or sanitiser code. The editor is a native `textarea` with a toolbar and server preview (robust Arabic IME and mobile keyboards, no rich-text dependency).
4. **Medical approval binds to a revision**, with four-eyes (author ≠ approver). Medicine pages are indexable only with an approved monograph; overdue reviews drop pages to `noindex` after a grace period.
5. **Public media lives in a separate public bucket/origin**, content-addressed and immutable; the private uploads bucket (prescriptions) is never used for public media.
6. **OG/X cards are rendered in the worker** with sharp/libvips (Pango shapes Arabic) from versioned SVG templates; the WP2 spike proves Arabic shaping, the fallback is the Playwright renderer as a worker job. Nothing renders images in the web container.
7. **Publishing API keys** are stored as keyed hashes, scoped, optionally IP-restricted and signed; `can_publish` defaults to false for new keys; idempotency is required on creating POSTs; the API cannot create medicine pages, monographs or arbitrary landing pages.
8. **No arbitrary third-party scripts.** Tracking and ad-network providers are code-defined adapters configured by ids/tokens; CSP sources are derived from enabled providers only.
9. **No health data to advertising or analytics platforms**; tags never load on app routes; pixels are off on medical content by default; every destination has a payload allow-list enforced by tests.
10. **Consent:** ads category is opt-in in every region; analytics follows an admin region policy (default opt-in) set after legal advice; Google Consent Mode v2 defaults to denied.
11. **Conversions** are written through the outbox in the same transaction as the business event, with deterministic `event_id`s shared by browser and server for platform deduplication.
12. **Ads are first-party and server-selected.** Page classes are fixed in code; sensitive routes can never show ads; a route without a declared class is sensitive; paid plans get `ads_free`; no prescription-medicine ads, no medicine ads on medicine pages; network ads are off by default.
13. **AI crawlers allowed by default** (search and training), admin-switchable per bot; robots.txt is generated from settings and the Cloudflare zone is aligned with it.
14. **`llms.txt` ships as a zero-cost experiment** (no `llms-full.txt`); fetches are measured.
15. **No doorway pages, drug-pair pages or price pages**; regional language variants live inside pages.
16. **Scroll motion is CSS scroll-driven only** (progressive enhancement, reversible with scroll direction, reduced-motion safe, no animation library); content is never hidden by default.
17. **HTML-rewriting edge features stay off** (Cloudflare Email Obfuscation, Rocket Loader, automatic script injection), guarded by a production HTML smoke check, because they break hydration and the CSP.

---

## 4. Releases and dependency graph

```
Release A — "Fast, credible front door"     WP1 ─┬─► WP2
                                                   │
Release B — "Content engine"                       ├─► WP3 ─┬─► WP4
                                                   │        └─► WP5
Release C — "Measure and monetise"                 ├─► WP6 ─────────► WP7 (also needs WP3)
                                                   │
Final gate                                         └──────────────────────► WP8 (needs all)
```
- WP1 is first (it fixes production and sets the SEO core everything else uses).
- WP2 and WP6 can run side by side after WP1 (different files: brand/homepage/media vs tracking/consent).
- WP3 needs WP2's media library and OG renderer. WP4 and WP5 can run side by side after WP3.
- WP7 needs WP3 (article rendering) and WP6 (consent, CSP-from-providers, beacon conventions).
- Migrations are numbered in package order starting at `0021`; a package that adds a migration owns the next free number at the time it starts and records it in Notes.

---

## WP1 — Foundation: live-site fixes, performance, URL/locale architecture, SEO core

**Specs:** this section; SEO-GEO §2, §5, §8, §10.4–10.6; BRAND-AND-HOMEPAGE §4.
**Main files:** `apps/web/next.config.ts`, `apps/web/package.json` (browserslist), `apps/web/src/proxy.ts`, `apps/web/src/lib/{csp,seo,structured-data,env}.ts`, `apps/web/src/app/{layout,robots,sitemap}.ts(x)`, new `apps/web/src/lib/locale.ts`, `apps/web/src/lib/seo/*`, `lighthouserc.json`, CI workflow, `packages/shared/src/settings.ts` (`seo` key).

### 1. Live-site errors (diagnosis already confirmed)
The production HTML (fetched on 2026-10-19) contains `__cf_email__` spans, `/cdn-cgi/l/email-protection` links and the injected `cloudflare-static/email-decode.min.js`: **Cloudflare Email Address Obfuscation** rewrites the email address that the footer/contact hub renders. That rewrite changes server HTML text nodes, so React reports **hydration error #418 (text mismatch)**, and the injected script has no nonce, so `script-src 'nonce-…' 'strict-dynamic'` blocks it (the CSP violation and the DevTools Issues entry). The page also contains Cloudflare's *JavaScript Detections* injector (`/cdn-cgi/challenge-platform/scripts/jsd/main.js`).
1. O1 applied by the owner (no CSP weakening).
2. Add `scripts/check-live-html.mjs` (run after each deploy and on a daily schedule): fetches key public URLs and fails on `__cf_email__`, `/cdn-cgi/scripts/`, `email-protection`, missing `nonce` on `<script>` tags, or missing security headers.
3. Playwright smoke project `prod-smoke` (read-only): visits the key pages, fails on any console error, `securitypolicyviolation` event or hydration warning.
4. Audit remaining hydration risks in public components (dates, `Intl` formatting, random ids, `typeof window` branches) and fix any found; add a dev-build test that fails on hydration warnings for each public template.

### 2. Performance fixes (from the Lighthouse report + Phase 3 carry-over)
1. **Render-blocking CSS (16 KB, ~160 ms):** measure `experimental.inlineCss` (CSS inlined into a nonce'd `<style>`) against the current external file on `/` and `/pricing` (FCP, LCP, HTML size, repeat-visit cost). Adopt it if LCP improves ≥ 100 ms on the mobile profile without regressing repeat views by more than that; otherwise keep the file and preload it. Split admin-only CSS so public pages do not carry it.
2. **Legacy JavaScript (13.5 KB polyfills: `Array.prototype.at/flat/flatMap`, `Object.fromEntries`, `Object.hasOwn`, `String.prototype.trimStart/trimEnd`):** set an explicit `browserslist` matching Baseline-widely-available browsers; run the bundle analyzer to find the chunk's origin. If it is a dependency compiled to ES5, remove it from public routes or replace it; if it is Next's own polyfill module, record that it is outside our control and accept it.
3. **Unused JavaScript (~101 KB across three chunks):** audit every client component reachable from public layouts: move `ToastProvider` out of the root layout into the app/admin/auth layouts that use toasts; make the contact hub a tiny button island that loads its panel on first open; keep icons as per-icon imports; check `instrumentation-client.ts` size; make sure no app-only module (`pdfjs-dist`, `heic2any`, `qrcode`, chat code) is reachable from public routes (bundle test asserts it).
4. **Critical chain:** after 1–3, the chain is HTML → (inline CSS) → font. Preload only the Arabic subset weights actually used above the fold.
5. **Pricing and checkout (Phase 3 open item: Performance 64–84, LCP 3.3–3.9 s, TBT 310–360 ms):** identify the LCP element with a trace, remove render-delaying client work, reduce the shared client bundle (item 3), and re-measure.
6. **Lighthouse CI** (`@lhci/cli`) in the pipeline against the production build with the real CSP: budgets from §1, median of 3, mobile profile; failures block merging for public-page changes. A RUM beacon (`web-vitals`, attribution build, ≤ 1 KB, sampled 25 %, no identifiers) posts to a first-party endpoint for field data.

### 3. Rendering spike (Decision 1)
Build a throwaway drug-page route that fetches cached data through the API, then load-test it on the production-like VPS (autocannon or k6, 50 req/s for 2 minutes): record TTFB p50/p75/p95 and CPU. Record numbers in Notes and confirm or switch the decision.

### 4. URL and locale architecture
1. `lib/locale.ts`: `localeFromPath`, `localizedPath(path, locale)`, `alternates(pathAr, pathEn)`; root layout sets `lang`/`dir` from the forwarded path.
2. `/en` routes for home, pricing, contact and legal pages (English copy files; legal English versions only if counsel provides them, else those routes 404 and have no hreflang).
3. Language switch in the public header/footer that links to the counterpart page only when it exists.
4. hreflang (`ar`, `en`, `x-default`) through one helper used by metadata and sitemaps.

### 5. SEO core
1. `lib/seo` grows into a module: `pageMetadata` (extended: locale, robots, OG locale alternates, `max-image-preview:large`), canonical rules (strip tracking params), `robotsFor(route)`; `X-Robots-Tag: noindex, nofollow` on app/admin routes from the proxy.
2. `seo` settings key (SEO-GEO §13) with admin screen (Settings › Search & discoverability): title template, verification tokens, AI crawler policy, IndexNow key, llms.txt switch, default OG image, brand regex.
3. `robots.ts` generated from settings (SEO-GEO §5.3); production only.
4. Sitemap **index** with per-type child sitemaps (`generateSitemaps`), each from cached data with real `lastmod`; the existing `PUBLIC_PAGES` table feeds `sitemap-pages.xml`.
5. Structured-data library extended (BreadcrumbList, Article, MedicalWebPage, Drug, ProfilePage, DefinedTerm builders) with snapshot tests; existing builders kept.
6. IndexNow sender (worker queue `seo:indexnow`, batched) and key file route.
7. `/llms.txt` route from settings and content (SEO-GEO §10.5).
8. AI-crawler and referrer logging: proxy records bot hits (user agent class, route template, status) as daily counters; referrer classification helper shared with TRACKING.

### Acceptance
- [ ] O1 done; `check-live-html` passes on production; `prod-smoke` shows 0 console errors and 0 CSP violations on the five key pages.
- [ ] Each Lighthouse finding has a recorded outcome (fixed with before/after numbers, or accepted with the reason).
- [ ] `/` Performance ≥ 95, `/pricing` and checkout ≥ 90 (mobile, median of 3) — or the gap and the next step are recorded.
- [ ] Lighthouse CI and JS budget checks run in CI and fail on regression.
- [ ] Rendering spike numbers recorded; Decision 1 confirmed or switched.
- [ ] `/en` home renders `lang="en" dir="ltr"`; hreflang pairs reciprocal; sitemap index valid against the sitemap XSD; robots from settings; app routes carry `X-Robots-Tag`.
- [ ] Structured-data snapshots pass and validate; existing landing JSON-LD unchanged in meaning.
**Tests:** locale helpers, canonical stripping, robots generation per setting, sitemap index/children, hreflang reciprocity, structured-data snapshots, bundle-reachability test (no app modules on public routes), prod-smoke, Lighthouse CI.
**Security:** CSP unchanged in strength (diff reviewed); settings writes audited; IndexNow key not secret but rotatable; bot logging stores no IPs.
**Done when:** all acceptance boxes ticked, full suite green, Release A part 1 deployable.

---

## WP2 — Brand system, visual assets, media pipeline and the homepage refresh

**Specs:** BRAND-AND-HOMEPAGE (all); CONTENT-PLATFORM §5 (media library, pipeline, OG renderer); SEO-GEO §11.
**Main files:** `brand/*`, `apps/web/public/brand/*`, `apps/web/src/components/{brand-mark,site-brand-mark}.tsx`, `apps/web/src/components/marketing/*`, `apps/web/src/content/landing*.ts`, `apps/web/src/styles/globals.css`, `packages/ui/tokens.css` (if tokens change), `apps/api/src/branding/*`, new `apps/api/src/media/*`, `apps/worker/src/media/*`, `apps/worker/src/og/*`, `packages/db/src/schema/{site-assets,media}.ts`, migration.

### Steps
1. **Logo:** three directions drawn as SVG (O3); the chosen one produced as the full set (BRAND §1.2) and the favicon/app-icon set (§1.3); `BrandMark` fallback becomes the new symbol everywhere (no pill chip left in any page).
2. **Icon routes and manifest:** stable URLs served by route handlers with admin override and ETags; `manifest.webmanifest`; metadata `icons` updated.
3. **Admin branding:** new asset keys, one-upload icon generation (sanitised SVG allow-list or PNG ≥ 512), previews (tab light/dark, Google row, iOS, Android masks, link card, email), revert to previous version.
4. **Media library foundation** (used by WP3/WP4/WP7): `media_assets` table, public bucket client, staging upload (presigned), worker `media:process` (magic bytes, megapixel guard, metadata strip, sRGB, variants AVIF/WebP/JPEG, blur placeholder, crops with focal point, budgets), dedupe by sha256, `<ContentImage>` component, CSP `img-src` for the media origin from configuration.
5. **OG renderer:** spike (Arabic shaping via sharp/Pango) → templates (`page`, `article`, `guide`, `glossary`, `drug`, `author`) → cached by content hash → `og_default`; current static `public/og/*.png` regenerated through it and `scripts/og-images.mjs` retired once parity is confirmed.
6. **Homepage:** hero pill (liquid glass with fallback), headline spacing (fluid type, line-height, gap), illustration redraw and choreography, decorative icons, new precision section, scroll motion system, FAQ motion, footer, apps "coming soon" band + optional waitlist (`app_waitlist` table), header condense + new nav entries (feature-flagged until WP3/WP5 pages exist), English homepage, copy truth pass (O4).
7. **Feature and audience pages** (`/features/*`, `/for/*`, AR + EN) owning the layer-A clusters of `keyword-map.csv`, built from content files with the shared section components; they enter `PUBLIC_PAGES`/sitemaps.
8. **Trust pages:** `/about`, `/editorial-policy`, `/medical-review`, `/sources` (copy drafted for owner and reviewer approval).
9. DESIGN-SYSTEM §3.7 and §9 updated for the scroll motion catalog; REUSE-INDEX updated.

### Acceptance
- [ ] Logo direction chosen and shipped; no pill placeholder anywhere (grep test on `Pill` import in brand components).
- [ ] All icon URLs return correct types and sizes; manifest valid; admin upload of one square symbol produces the full set; previews render; revert works.
- [ ] Media pipeline rejects SVG/HEIC/bombs, strips EXIF, produces variants within budgets; dedupe works.
- [ ] OG cards render correct Arabic (joined letters, RTL) for every template — visual snapshot reviewed and stored.
- [ ] Homepage: no headline overlap at 320–1440 px and 200 % zoom; pill, illustration, precision section, FAQ, footer, apps band match BRAND-AND-HOMEPAGE §3; reduced-motion and Firefox fallback show complete static content.
- [ ] `/` Lighthouse mobile ≥ 95 / 100 / 100 / 100; CLS ≤ 0.02; JS ≤ 80 KB; no long task from animations at 4× CPU throttling.
- [ ] Feature, audience and trust pages live in AR (EN when O4 says so), in sitemaps, with metadata and JSON-LD.
**Tests:** icon routes and overrides; SVG sanitiser corpus; media worker (fixtures per format, budgets, EXIF); OG template snapshots; Playwright visual regression (AR/EN × widths × motion/reduced); axe on all new pages; waitlist consent stored and event emitted.
**Security:** SVG sanitising (no scripts, external refs, `foreignObject`); presigned uploads scoped and short-lived; public bucket never receives private data (path prefix test); new admin writes audited with fresh auth for brand changes.
**Done when:** Release A deployable (WP1 + WP2).

---

## WP3 — Content platform: model, workflow, editor, public templates

**Specs:** CONTENT-PLATFORM (all); SEO-GEO §7, §9.
**Main files:** `packages/db/src/schema/content.ts` + migration, `packages/shared/src/content/*` (schemas, Markdown directives, slug/transliteration, quality gates, similarity), `apps/api/src/content/*`, `apps/worker/src/content/*` (publish-due, related, link health), `apps/web/src/app/(marketing)/{blog,guides,glossary,authors,preview}/*`, `apps/web/src/app/admin/content/*`, `apps/web/src/components/admin/content/*`, `apps/web/src/lib/admin-nav.ts`, i18n files, RBAC catalog.

### Steps
1. Schema and migration (CONTENT-PLATFORM §3), DATABASE.md section, permissions (§4.2) in the RBAC catalog with default role grants.
2. Renderer in `packages/shared` (remark/rehype, directive set, sanitiser allow-list, heading ids, TOC, entity extraction) — used by the API at save and by the preview endpoint.
3. API: CRUD, state machine with revision binding, four-eyes review, scheduling, previews (signed tokens), optimistic locking, slug redirects, quality gates, keyword ownership check (`seo_keywords` table seeded from `docs/seo/keyword-map.csv`), people, taxonomy, corrections; cache-tag revalidation call to the web app; outbox events (`content.*`).
4. Worker: `content:publish-due` (minute), daily cap rollover, related-content computation, sitemap chunk revalidation, IndexNow enqueue, link extraction.
5. Admin UI: content list with filters/saved views/bulk actions/calendar, editor (desktop and mobile layouts, toolbar above keyboard, slash commands, paste-to-Markdown, autosave, preview, SEO panel, review panel, history with diff and restore, conflict warning), categories, tags, people, media library screen (on WP2 foundation), redirects, content settings.
6. Public templates: blog home, category, tag, article, guide (with TOC), glossary hub and entry, author pages, preview route; breadcrumbs; JSON-LD; RSS/Atom; auto-linking; related content; share links; ad-slot anchors (rendered empty until WP7).
7. Admin navigation groups «المحتوى» and «البحث والظهور».

### Acceptance
- [ ] A reviewer-gated article goes draft → in_review → approved → scheduled → published automatically, appears with correct metadata, JSON-LD, sitemap entry and RSS item; editing it keeps the approved revision live until re-approved.
- [ ] Author cannot approve own revision; non-medical categories publish without review; daily cap rolls over in order.
- [ ] Mobile editor usable end to end on a 390 px viewport (Playwright mobile project), including image insertion and scheduling.
- [ ] Quality gates block/warn exactly as specified; duplicate detection catches a near-copy fixture.
- [ ] Unpublish → 404 within one request; archive → 410 or 301; slug change → automatic 301.
- [ ] Public article pages: no client JS needed for content; Lighthouse ≥ 90 mobile.
**Tests:** CONTENT-PLATFORM §10 in full.
**Security:** sanitiser XSS corpus (incl. Arabic bidi tricks, `javascript:` links, data URIs); preview tokens signed/expiring/noindex; RBAC on every route (SECURITY endpoint register rows); audit entries for every state change; revalidation endpoint authenticated (HMAC, replay window).
**Done when:** content can be produced and published by the owner without code; suite green.

---

## WP4 — Publishing API

**Specs:** PUBLISHING-API (all).
**Main files:** `apps/api/src/publishing/*` (controller, key guard, signature verifier, idempotency store, rate limiter tier, webhook sender), `packages/db/src/schema/publishing.ts` + migration (`api_keys`, `api_idempotency`, `publishing_api_requests`, `webhook_deliveries`), `packages/shared/src/schemas/publishing.ts`, OpenAPI generation, admin screens (keys, logs, docs viewer), error codes.

### Steps
1. Key model, hashing with pepper, scopes, `can_publish`, IP allow-list, expiry, rotation grace, revocation via the invalidation bus; admin screens with fresh auth + 2FA and one-time secret display.
2. Auth guard (Bearer; optional HMAC signature with replay cache); origin guard exemption only for this path prefix; per-key rate limits (token bucket) and concurrency limit; standard `RateLimit-*` headers.
3. Endpoints (§7.2) on top of WP3 services (no duplicate business logic): upsert by `external_id`, `Idempotency-Key` store (24 h, body hash), validate (dry run), batch (207), state actions, media upload and fetch with the SSRF guard, taxonomy, people, revisions list.
4. Workflow mapping (§8) incl. `publish_on_approval`; per-key and global publish caps.
5. Webhooks via the outbox with signing, retries and delivery log.
6. OpenAPI 3.1 generated from zod schemas at `/publishing/v1/openapi.json`; admin docs viewer; PUBLISHING-API.md examples verified by an integration test that runs them.
7. Request log, audit entries (`actor = api_key:<id>`), metrics, alerts (§10).

### Acceptance
- [ ] The quick-start flow (§2) works against a test stack exactly as written.
- [ ] Repeating any create with the same `Idempotency-Key` returns the same result; different body → 409; `PUT by-external-id` never duplicates.
- [ ] A `can_publish = false` key cannot make anything public; a medical article from any key waits for human approval.
- [ ] SSRF guard blocks private/loopback/link-local/metadata addresses, DNS rebinding (re-resolve), redirects to private ranges, non-https.
- [ ] Revoked key fails within 5 s across API instances; rotation grace works.
- [ ] OpenAPI validates; every endpoint and error code documented.
**Tests:** auth matrix (scopes × endpoints), signature/replay, idempotency, rate limits, batch partial success, SSRF corpus, webhook signing and retries, caps, audit rows, OpenAPI contract test.
**Security:** SECURITY.md threat rows: key leakage (hashing, last-4 display, rotation, alerts), replay, SSRF, mass-publication abuse (caps), stored XSS through content (shared sanitiser), webhook target abuse (SSRF guard), log hygiene (no bodies or secrets logged).
**Done when:** an external automation can publish safely; suite green.

---

## WP5 — Medicine pages, discoverability operations and SEO monitoring

**Specs:** SEO-GEO §4, §6, §7.2, §10, §12; `docs/seo/keyword-map.csv`.
**Main files:** `packages/db/src/schema/{drugs,seo}.ts` + migration (`drug_monographs`, `monograph_sources`, `monograph_revisions`, `drug_seo`, `therapeutic_classes`, `seo_keywords`, `seo_search_performance`, `seo_url_inspections`, `seo_issues`, `seo_ai_checks`, bot/referrer counters), `apps/api/src/{drugs-public,seo}/*`, `apps/worker/src/seo/*` (gsc-sync, url-inspect, health job, review-due), `apps/web/src/app/(marketing)/drugs/*`, admin screens (Medicines SEO, monograph editor, SEO dashboard, keywords, SEO inbox, AI checks).

### Steps
1. Data model and migration; slugs for ingredients/brands (stable, collision-safe); therapeutic class tree seeded from the drug DB where available.
2. Monograph editor (sections, sources, AI-assisted draft from cited sources through a new task route `seo_monograph_draft`, credit-free admin usage logged in AI usage), review via the WP3 review inbox, `next_review_due` and alerts.
3. Indexability engine (SEO-GEO §6.3) with per-page blockers visible in admin; near-duplicate brand canonicalisation.
4. Public pages: drugs hub (search box, popular, A–Z), ingredient, brand, class pages, search results (`noindex`), AR + EN where monographs exist; JSON-LD; breadcrumbs; related; product CTA; sitemaps per type/locale.
5. Public drug search API (rate-limited per IP, cached, trigram matcher reuse; no logging of search terms against users).
6. Keyword map import/export (CSV), ownership warnings feeding the editor (WP3), cannibalisation detector.
7. Search Console integration (service account credentials encrypted, daily sync, URL inspection sampling within quota), optional Bing; SEO dashboard (§12.1 KPIs), SEO health job (§12.3) → SEO inbox; AI-visibility: referrer classification, crawler counters, manual prompt-panel log.
8. Glossary seed: 80 prescription abbreviation entries drafted (AR/EN) for reviewer approval (content, not code); first 20 ingredient monographs drafted for review as the pilot batch.

### Acceptance
- [ ] An ingredient page is `noindex` and absent from sitemaps until its monograph is approved; after approval it is indexable, in the sitemap, with reviewer name/date and sources visible and in JSON-LD.
- [ ] Brand pages follow §6.3 rules; duplicates canonicalise; no page shows a personal dose recommendation.
- [ ] Overdue review → admin alert → `noindex` after grace.
- [ ] Search Console sync stores data for a test property (mocked in CI, real in production after O6); dashboard shows KPIs; health job finds seeded problems (broken link, orphan, duplicate title, cannibalisation fixture).
- [ ] Drug pages: Lighthouse ≥ 90 mobile; TTFB target met under load.
**Tests:** indexability rules table, slug generation, canonical for duplicates, review-due job, GSC client with recorded fixtures, health job detectors, public search rate limit, JSON-LD snapshots, sitemap membership.
**Security:** GSC credentials encrypted and never sent to the browser; public search hardened (length limits, rate limits, no PII logging); monograph AI drafting cannot publish; admin writes audited.
**Done when:** Release B deployable (WP3 + WP4 + WP5).

---

## WP6 — Campaigns, attribution, consent, pixels and server-side conversions (incl. Phase 3 Task 3.16)

**Specs:** TRACKING (all); GROWTH-STRATEGY §9.
**Main files:** `packages/db/src/schema/{growth,tracking}.ts` + migration, `packages/shared/src/tracking/*` (event catalog, channel classifier, payload allow-lists, event ids), `apps/api/src/{campaigns,tracking}/*`, `apps/worker/src/tracking/*` (dispatch per destination), `apps/web/src/app/c/[slug]/route.ts`, `apps/web/src/lib/tracking/*` (consent banner island, loader), `apps/web/src/proxy.ts` (touch capture), admin screens (Campaigns, Links, Goals, Integrations, Reports, Consent).

### Steps
1. Consent: banner island, preferences, `consent_records`, region policies, Consent Mode v2 defaults, account-level storage for signed-in users, footer link.
2. Campaign links: extended `campaign_links`, folders, campaigns, templates, UTM builder, CSV bulk, QR, `/c/<slug>` with click recording and attribution cookies.
3. Attribution: touch capture in the proxy, signed `wasfa_att`, `user_attribution` at sign-up, conversions table, models.
4. Goals and event catalog (seeded defaults), mapping per destination.
5. Destinations: GA4 (gtag + Measurement Protocol), Google Ads (gtag conversions + enhanced conversions off by default), Meta (Pixel + CAPI), TikTok (Pixel + Events API), Snap (Pixel + CAPI) as adapters behind one interface; a **fake destination** used in tests and staging; "send test event" in admin.
6. Loader with route allow-list, consent gating and CSP derived from enabled providers.
7. Server dispatch via outbox with consent re-check, retries, `conversion_dispatches` log, alerts.
8. Reports: campaign table, funnel, channels (incl. organic and AI assistants), destination health, event explorer, CSV export.

### Acceptance
- [ ] With consent denied: no third-party request, no click id stored, no server dispatch (Playwright network log + DB assertions).
- [ ] With consent granted: browser and server events for sign-up and purchase share `event_id`; fake destination receives exactly the allow-listed fields.
- [ ] Payload allow-list test fails when a forbidden field (drug name, analysis id, chat text, page title of a drug page) is added to a fixture.
- [ ] App routes never include the loader; medical content pages load no ad pixels by default.
- [ ] `/c/<slug>`: no open redirect; unknown/archived links land on `/`; bot clicks flagged; works without JS.
- [ ] Campaign report totals reconcile with `orders` for a seeded period.
**Tests:** TRACKING §11 in full.
**Security:** encrypted provider tokens (fresh auth to view/replace, never returned in full); CSP diff limited to enabled providers; `wasfa_att` signed; IP never stored; consent records immutable; SECURITY endpoint register rows for `/c/*`, consent endpoint, RUM/beacon endpoints, admin routes.
**Done when:** the platform is ready to run paid campaigns the day O9 credentials are entered.

---

## WP7 — Advertising inventory

**Specs:** ADS (all).
**Main files:** `packages/db/src/schema/ads.ts` + migration, `packages/shared/src/ads/*` (page classes, placement catalog, density/spacing rules, selection), `apps/api/src/ads/*`, `apps/worker/src/ads/*` (daily aggregation), `apps/web/src/components/ads/*` (slot server component, viewability observer), route-class declarations across `apps/web/src/app/**`, `/a/[token]` click route, admin screens (group «الإعلانات»), plan entitlement `ads_free`.

### Steps
1. Page-class declarations on every route segment + the route-walk test (undeclared = sensitive).
2. Placement catalog seed, advertisers, campaigns, creatives (media pipeline images), bookings with exclusivity conflicts, inventory calendar.
3. Server-side selection with density/spacing rules and one-per-advertiser; article renderer anchors filled; app-neutral slots for free plan only, house ads default.
4. Measurement: served counts, viewability beacon (signed slot tokens, no identifiers), click redirect with signed tokens, daily aggregation, reports and shareable advertiser report links.
5. Creative review workflow with the checklist; advertiser category rules per page class.
6. `ads_free` entitlement in the plans editor; settings and kill switch.
7. Optional network provider adapter (AdSense) behind settings, off, consent-gated, content pages only.

### Acceptance
- [ ] No slot renders on any `app_sensitive` or `conversion` route even with a booking targeting it.
- [ ] Article with 3 slots: spacing rules hold; CLS from slots = 0 on mobile and desktop.
- [ ] Paid user sees no ads; free user sees app-neutral house ads only unless `allowPaid` is on.
- [ ] Exclusive booking conflicts are refused; share-of-voice rotation within ±5 % over 10,000 simulated selections.
- [ ] Viewability beacon payload contains no visitor id or URL beyond the route template; click redirect refuses tampered tokens and non-approved URLs.
**Tests:** ADS §9 in full.
**Security:** advertiser contact data encrypted; creative URLs validated (https, no javascript:, no private hosts); click and beacon endpoints rate-limited; network provider CSP only when enabled; endpoint register rows.
**Done when:** Release C deployable (WP6 + WP7).

---

## WP8 — Final gate: quality, security, performance, documentation, release

### Steps
1. **Regression:** full unit/integration/Playwright suites on the release candidate; manual smoke of payments (test mode), analysis, chat, referrals on staging.
2. **Performance:** Lighthouse CI budgets on all public templates; load test of article and drug pages (50 req/s, TTFB p75 ≤ 300 ms); RUM collecting.
3. **SEO audit:** crawl the staging site (Screaming Frog or an open-source crawler) with production robots simulated: status codes, canonicals, hreflang, duplicates, orphans, structured data validation (Rich Results Test on one page per template), sitemaps vs crawl diff.
4. **Privacy audit:** network capture across public and app pages with consent denied/granted; payload allow-list tests; privacy policy and consent texts approved (O8).
5. **Security:** SECURITY.md endpoint register complete for every new route; threat rows for content XSS, publishing API, SSRF, tracking leakage, ad click abuse, admin brand/SVG upload; dependency audit (`pnpm audit --prod`); secrets scan.
6. **Docs:** DATABASE.md (all new tables), ARCHITECTURE.md (decisions 56–72 confirmed or amended), SECURITY.md, REUSE-INDEX.md, DESIGN-SYSTEM.md (motion, brand), DOCKER-GUIDE.md (public media bucket env, new worker queues, Cloudflare settings from O1), `docs/CONTENT-RUNBOOK.md` (how to run the content operation: weekly review cadence, publishing caps, handling corrections, GSC triage, adding an automation key), ROADMAP.md status.
7. **Release:** staged rollout — Release A, then B, then C — each with a feature flag for the new public sections (`public.blog`, `public.drugs`, `tracking.enabled`, `ads.enabled`), sitemaps submitted in Search Console after B, monitoring dashboards checked 24 h and 7 days after each release.

### Phase 4 final checklist
- [ ] All WP acceptance lists ticked or carried over with a written reason.
- [ ] §1 success measures met for lab metrics; field metrics collecting.
- [ ] 0 console errors / CSP violations in production smoke.
- [ ] Every indexable medical page reviewed; 0 overdue.
- [ ] Consent and privacy audit passed; legal texts approved.
- [ ] Publishing API documented and tested end to end with an external client.
- [ ] Ads cannot appear on sensitive routes (test) and are off in production until O10.
- [ ] Docs updated; decision log complete; carry-overs listed for Phase 5.
- [ ] Phase 3 carry-overs revisited: production image sizes (api 270 MB, worker 384 MB vs 200 MB target: owner sign-off or a pruning item for Phase 5), cash-out still gated by the accountant's answer.

---

## 5. Security checklist for new surfaces (summary; full rows go into SECURITY.md)
| Surface | Main threats | Controls |
|---|---|---|
| Content rendering | stored XSS, bidi spoofing, malicious links | Markdown-only input, allow-list sanitiser at save, `rel` policies, CSP unchanged, XSS corpus tests |
| Admin uploads (SVG logos, media) | script in SVG, decompression bombs, metadata leaks | SVG allow-list sanitiser, megapixel guard, metadata strip, separate public bucket |
| Publishing API | key theft, replay, mass publishing, SSRF via media fetch and webhooks | hashed keys, rotation, IP allow-list, signing, idempotency, caps, SSRF guard, alerts |
| Revalidation endpoint | cache poisoning / DoS | HMAC + timestamp, internal network only where possible, rate limit |
| Tracking | health data leakage, consent bypass, cookie tampering | allow-lists, route gating, consent re-check at dispatch, signed cookies, no IP storage |
| `/c/<slug>`, `/a/<token>` | open redirect, click fraud | own-path targets, signed tokens, bot flags, rate limits |
| Ads | malicious creatives, sensitive-page exposure | review workflow, URL validation, page classes fixed in code |
| Public drug search | scraping, enumeration cost | rate limits, caching, length limits, Cloudflare WAF |
| SEO integrations | credential leakage | encrypted credentials, never sent to the browser, fresh auth to change |

---

## 6. Open questions (owner)
1. Logo direction A, B or C (shown as drafts at the start of WP2)?
2. Launch English public pages with Phase 4, or Arabic first and English a few weeks later?
3. Who are the first medical reviewers, and how many reviews per week can they handle (sets `content.maxPublishesPerDay`)?
4. AI training crawlers (GPTBot, ClaudeBot, Google-Extended, CCBot, Applebot-Extended): keep the recommended "allow", or block training while allowing search bots?
5. Cloudflare JavaScript Detections: keep (and accept that the CSP blocks its injected script, which reduces its value) or turn off?
6. Consent region policy: opt-in everywhere (default) or notice-only for analytics in some countries after legal advice?
7. Advertising: which advertiser categories are acceptable, and should app-neutral placements ever carry paid ads (default: house ads only)?
8. Should the "notify me when the apps launch" waitlist be on at launch?

---

## Notes
*(Filled during execution: measurements, migration numbers, deviations with reasons.)*

### Release A — first pass (2026-10-19, branch `phase4/release-a`)
**Migrations:** `0021_media_assets` (WP2 media library).
**Live site (WP1 §1):** `node scripts/check-live-html.mjs https://wasfa.online` on 2026-10-19 fails on `/`, `/pricing`, `/contact`, `/privacy` (`__cf_email__`, `/cdn-cgi/scripts/`, `email-protection`, one un-nonced script each); all pages warn on `/cdn-cgi/challenge-platform/`; no missing security headers. Confirms the diagnosis; fixed only by O1.
**Bundles (WP1 §2.3), first-load JS gzip, before the ToastProvider move:** `/` 301 KB, `/pricing` 352 KB, `/contact` 340 KB, legal pages 301 KB — far over the 80/100 KB budgets. `check:bundles` warns (strict mode off) until the chunk contents are identified; no app-only module (pdfjs, heic2any, qrcode, chat) is reachable from public routes.
**Polyfills (WP1 §2.2):** with the explicit `browserslist`, Next 16 still emits `polyfillFiles` (113 KB raw core-js, `nomodule`). It is Next's own module, outside our control; whether modern browsers download it is to be confirmed in Lighthouse.
**Deviations:**
- BullMQ forbids `:` in queue names: IndexNow is queue `seo` / job `seo.indexnow`; media processing is job `media.process` on the existing `images` queue.
- Sitemap index via route handlers (`/sitemap.xml`, `/sitemap-pages.xml`): Next 16 `generateSitemaps()` serves `/sitemap/<id>.xml` without an index.
- IndexNow key file at `/indexnow.txt` (sent as `keyLocation`) instead of `/<key>.txt`.
- `/en/pricing` not shipped: plan cards and `@wasfa/ui` price parts are Arabic-only; `PUBLIC_PAGES.pricing.pathEn = null` until they are localised (no hreflang pair to a mixed-language page).
- Media admin routes use `settings.read/write` until WP3 adds `media.*` permissions. Production R2 must block public reads of `staging/*` (staged originals still carry EXIF) — part of O2.
- `lighthouserc.json` lives in `apps/web/` (existing file); the CI job is non-blocking until a baseline is recorded.
**Open in Release A:** O1 (Cloudflare), inlineCss measurement, LCP/trace work on pricing/checkout, RUM beacon + endpoint, rendering spike on the VPS, bot-hit logging, dev-build hydration test, Lighthouse baseline; all of WP2 except the media library foundation (logo O3, icon routes/manifest, admin icon generation, OG renderer spike, homepage refresh, feature/audience/trust pages — O3/O4).

### Release A — second pass (2026-10-23, branch `phase4/release-a-2`)
**Migrations:** `0022_brand_icons_waitlist` (site_assets keys widened, `site_asset_history`, `app_waitlist`).
**Bundles (first-load JS gzip, strict in CI):** `/` and `/en` 301 → 144.5 KB, legal 301 → 144.5, `/pricing` 352 → 228.1, `/contact` 340 → 222.6. Budgets rebased: `/` 150, public templates 170, form pages (`/pricing`, `/contact`) 235. Reason: React 19 + Next 16 client runtime is ≈ 120 KB before any app code, so 80/100 KB are unreachable; the form pages carry zod (~32 KB) and the public catalogue (~36 KB).
**Lighthouse (mobile, median of 3, local production build):** `/` 0.94 (LCP 3016 ms, TBT 108, CLS 0), `/pricing` 0.91–0.97 (LCP 2589), `/en` 0.94. CI blocks on `/` ≥ 0.9 plus SEO/A11y; 0.95 target not met (gap ~0.01–0.02).
**inlineCss:** measured and rejected (LCP +150 ms on `/`, +146 ms on `/pricing`, +48 KB uncacheable HTML).
**Polyfills:** Next's nomodule polyfill chunk is not part of first load (never counted). Accepted.
**Hydration:** audit found no risks; `hydration-dev` Playwright project passes on all 33 public pages.
**OG spike (Decision 6 confirmed):** librsvg + bundled IBM Plex Sans Arabic via a generated `FONTCONFIG_FILE` shapes Arabic correctly; `og-images.mjs` retired.
**Logo (O3 pending):** direction A shipped as default; drafts in `brand/directions/index.html`.
**Deviations:** waitlist admin gated by `users.read` (personal data); bot hits have no status (the proxy cannot see it); unknown nested routes map to `/<segment>/[rest]`; pixel visual baselines opt-in (`VISUAL=1`); Next upgraded to 16.4.3 (GHSA-2464-fhr4-w9xw, GHSA-673q-mjm6-r5xr).
**Open:** rendering spike on the VPS (SSH not permitted from the agent session), O1/O2/O4/O5 owner items, trust-page copy approval.

### WP2 close-out (2026-10-24)
**Audit of WP2 steps 1–9 against the code:** every step is implemented except the items under "Carried over" below. `/en/pricing` **is** shipped (`PUBLIC_PAGES.pricing.pathEn = "/en/pricing"`); this supersedes the first-pass deviation about it.
**Fixed in this pass:**
- Header: the four section links now appear from `lg` (they overflowed the bar at 768 px in AR and EN and wrapped to two lines); below `sm` the "create account" button is tighter (English overflowed 320 px by 20 px).
- Media worker aligned with CONTENT-PLATFORM §5.3: variant widths 320/480/640/960/1280/1600 (was …/1920), WebP quality 72, the 1600 px AVIF kept ≤ 180 KB by stepping quality 50 → 30 (`encodeWithinBudget`), `avif_over_budget_1600` warning logged by `media.process`. Unit tests added (fake encoders for the step-down, a noisy 3000×2000 fixture, a 500 px no-upscale case).
- Metadata `icons` now list the 48 and 192 px PNGs (Google's favicon rule needs a 48-multiple at a crawlable URL); dead `pipe-*` CSS from the retired precision loop removed; axe e2e now covers the feature, audience, trust and English pages (21 paths); REUSE-INDEX has the OG renderer row and the new media wording.
**Measured (Playwright against `next dev`, API down so defaults render):** the homepage in AR and EN at 320/360/390/768/1024 px, and the feature, audience, trust, pricing and contact pages at 320/390/768 px (46 combinations): no horizontal overflow after the fixes; the two headline lines never overlap at 320–1440 px (AR and EN) nor at 200 % zoom of 640–1440 px; `lang`/`dir` correct (`ar`/`rtl`, `en`/`ltr`). Console errors are only the Next dev overlay's inline-style CSP reports, as in the hydration spec.
**Carried over (with reason):**
- Focal-point crops (16:9, 4:3, 1:1, OG 1200×630) and persisted media warnings → WP3 step 5: the original is deleted after processing and the focal point is edited later in the media screen, so crops must be derived from the widest variant where the editor and the consumers live.
- Event `app_waitlist_joined` → WP6: the event catalog and outbox contract are WP6's; the waitlist join still writes a log line without the address.
- Footer "Resources" column and consent link, header Blog/Medicines entries → when WP3/WP5/WP6 ship those pages.
- JPEG is produced at every width (not only 1200 px) because `ContentImage` uses it as the `<img>` fallback `srcset`.
- Owner decisions still open: O3 (logo direction; A shipped as default), O4 (feature list confirmation for homepage copy), trust-page copy approval. Lighthouse `/` mobile 0.94 (target 0.95) and first-load JS 144.5 KB (target 80 KB) stay as recorded in the second pass.
**Not run here (Docker was down):** the Playwright stack suites, the API/worker media integration tests, a Lighthouse re-run after the header change, pixel visual baselines (`VISUAL=1`).

### WP3 — content platform (2026-10-24/25)
**Migration:** `0023_content_platform` (14 tables + `media_assets` columns + revisions guard trigger + generated `search_tsv` + role grants for admin/marketing). **UNAPPLIED**: Docker was down all session, so the SQL, the trigger, the deferred FKs and every `*.int.test.ts` below have never run on Postgres. `drizzle-kit generate` reports "No schema changes" against the snapshot.
**Built (decisions in CONTENT-PLATFORM §11):** shared library (`@wasfa/shared/content`: workflow state machine, 16 quality gates, shingle/minhash similarity, word diff, slug/transliteration, preview tokens, revalidation signing; `/content/render`: unified/remark/rehype renderer with a custom sanitiser), contract `schemas/content.ts`, `content` setting, `content.*` permissions, 13 `CONTENT_*` error codes, db helpers (`publishItemTx` …), API (items/revisions/autosave/actions/preview tokens/corrections, taxonomy/people/redirects/options/bulk/inbox/link suggestions, public read API, media rights + usage), worker (`content.publish-due` every minute, `content.changed` outbox handler → signed web cache purge + IndexNow), web (public blog/guides/glossary/authors/preview/page templates AR+EN, `.content-prose` CSS, HMAC `/api/revalidate`, proxy 301/410, sitemaps, RSS, admin lists/calendar/review/taxonomy/people/redirects/media library, the editor), SECURITY.md (58 register rows, 13 threat rows, 12 carry-overs).
**Verified:** unit tests — shared 841, db 13, api 379, worker 141, web 1235 (all pass); typecheck and lint clean for all packages except one pre-existing `no-html-link-for-pages` error in `growth-referrals-view.tsx` (untouched); `next build` passes (136 routes); `check:bundles --strict` passes: content templates 144.9 KB gzip (home 144.4 KB). The build found two real bugs that unit tests could not: route handlers that read the API were prerendered at build time (now `force-dynamic`), and the copy-link island imported the whole message catalogue (+37 KB, now props).
**Not verified (needs Docker):** migration 0023, all integration tests (API items/public/taxonomy, worker publish-due), every Playwright spec (`content-infra`, `content-pages`, `admin-content`, `content-editor`), Lighthouse on content pages, and the editor's layout in a real browser at 320–1440 px (mobile keyboard toolbar, per-paragraph bidi in the textarea). Acceptance boxes that depend on them are NOT ticked.
**Deviations (with reasons):**
- Item/revision split (CONTENT-PLATFORM §11.1) instead of §3's "everything on content_items": the live page must keep the approved revision while edits continue; `content_autosaves` holds autosave because revisions are append-only; no hard delete (archive instead).
- `page` slugs are paths of up to 3 segments (`features/x`) with reserved first segments and names (`checkItemSlug`); the public catch-all uses `no-store` fetches.
- Related content is computed at read time (no `related` job); link health beyond extraction is WP5; `keyword_ownership` gate and drug/auto-link resolvers are seams for WP5.
- Auto-generated OG cards per item are NOT hooked up yet (explicit OG image, else the site default); focal-point crops and persisted media warnings are not implemented (WP2 carry-over, still open).
- `content.api_keys` and `seo.*` permissions and the «البحث والظهور» nav group come with WP4/WP5.
- Manual publish beyond the daily cap is refused (`CONTENT_PUBLISH_CAP`); only scheduled items roll over.
- Worker joins the `edge` network in `compose.prod.yml` to reach the web app's `/api/revalidate` (owner to confirm the topology change).
- `/sitemap.xml` serves its last good copy during an API outage; bulk actions run the normal workflow per item through `ContentBulkPort`.
**Owner prerequisites for WP3 to work in production:** O5 (a reviewer profile linked to an account, else medical content can never be approved); secrets `CONTENT_PREVIEW_SECRET` (api), `REVALIDATE_SECRET` + `WEB_INTERNAL_URL` (worker/web) — features are off when unset; `MEDIA_PUBLIC_ORIGIN` plus the media origin in `CSP_IMG_SRC_EXTRA` (and the bucket in `CSP_CONNECT_SRC_EXTRA`) for images and uploads.
