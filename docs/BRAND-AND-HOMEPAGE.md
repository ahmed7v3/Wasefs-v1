# BRAND-AND-HOMEPAGE.md — Brand assets, favicon system, visual content and the homepage refresh

> Phase 4, Task 4.2. Extends `docs/DESIGN-SYSTEM.md` (tokens, typography, RTL, motion, performance rules); where this file changes a rule there, DESIGN-SYSTEM is updated in the same task.
> Current state reviewed before writing: the header and footer use `BrandMark` (`apps/web/src/components/brand-mark.tsx`), which falls back to a lucide **pill icon in a navy chip** when no logo is uploaded (the "placeholder-like symbol"); `app/icon.svg` is the default favicon and `/admin/branding` already lets an admin upload a logo, a dark logo and a favicon (`site_assets`, `branding` settings); OG images are rendered offline by `apps/web/scripts/og-images.mjs`; the landing page is server-rendered with CSS-only animations and a global reduced-motion rule.

---

## 1. Brand identity system

### 1.1 Concept
«وصفة AI» reads prescriptions and **checks itself**. The mark carries both ideas: the Arabic letter **و** (first letter of وصفة) drawn so that its tail becomes a **check stroke**, inside a rounded square ("app tile") in brand navy. It is legible at 16 px, distinct from generic pill/cross/heart health icons, and works in one colour.

Three directions are drawn in Task 4.2 for the owner to choose from (one decision, recorded in phase4.md):
- **A. و-check tile** (recommended): navy tile, white و whose tail sweeps into a check.
- **B. Prescription sheet + scan line:** a folded-corner page with a horizontal scan line and a check.
- **C. Wordmark-only:** «وصفة» custom lettering with the dot of the ة as a small check badge.
The mascot family (`mascot.tsx`, `brand/wasfa-doctor-character.svg`) stays an illustration system, **not** the logo (too detailed for small sizes).

### 1.2 Logo set (files in `apps/web/public/brand/`, SVG masters in `brand/`)
| Asset | Use | Spec |
|---|---|---|
| `symbol.svg` | favicon source, app icon, avatar, small spaces | 24×24 grid, optical stroke ≥ 2 px at 16 px |
| `logo-ar.svg` | default header/footer lockup (symbol + «وصفة AI») | horizontal, symbol on the right in RTL |
| `logo-en.svg` | English pages, English OG cards | symbol + "Wasfa AI" |
| `logo-ar-mono.svg`, `logo-en-mono.svg` | single colour (print sheet, receipts, embossing) | `currentColor` |
| `logo-ar-dark.svg` | dark surfaces (OG backgrounds, future dark mode) | white wordmark |
| `logo-512.png` | Organization JSON-LD logo, email header | replaces the current `public/logo.png` (same path kept) |

Rules: clear space = the height of the و; minimum lockup height 24 px on screen; never recolour outside tokens, stretch, add effects or place on busy images without the tile. Colours: `primary` `#1e3a8a` with `accent` `#60a5fa` only as a highlight in larger sizes. The wordmark uses the existing IBM Plex Sans Arabic Bold converted to outlines (no font dependency in the SVG).

### 1.3 Favicon and app icon set
| File | Size | Notes |
|---|---|---|
| `favicon.ico` | 16, 32, 48 (multi-size) | legacy browsers and some crawlers |
| `icon.svg` | vector | with an embedded `@media (prefers-color-scheme: dark)` variant (lighter tile edge so it does not vanish on dark tabs) |
| `icon-48.png`, `icon-96.png`, `icon-192.png` | PNG | Google Search favicon needs a square multiple of 48 px at a stable, crawlable URL |
| `apple-touch-icon.png` | 180×180 | opaque background (iOS adds no transparency), no rounded corners (iOS masks) |
| `icon-512.png`, `icon-maskable-512.png` | 512 | manifest; maskable keeps the symbol inside the 80 % safe zone |
| `manifest.webmanifest` | — | `name` «وصفة AI», `short_name` «وصفة», `lang`/`dir`, `start_url` `/dashboard`, `display` `standalone`, `theme_color` and `background_color` from tokens, icons above |

**Stable URLs:** pages always reference `/favicon.ico`, `/icon.svg`, `/icon-<n>.png`, `/apple-touch-icon.png`, `/manifest.webmanifest`. These are served by small web route handlers that return the **admin-uploaded** asset when one exists (from the API's `/assets/<key>`, cached with the asset's `sha256` ETag) and the bundled default otherwise. Google and browsers keep one URL while the admin can change the image (no `?v=` churn on the favicon URL Google indexed).

### 1.4 Admin-managed branding (extends `/admin/branding`)
- New `site_assets` keys: `symbol` (SVG or PNG ≥ 512, square), `favicon_ico` (optional override), `apple_touch_icon` (optional override), `og_default`, `logo_en`, `logo_mono`, `email_logo`. `branding` settings gain `themeColor`, `manifestName`, `manifestShortName`.
- **One upload generates the set:** uploading a square `symbol` (SVG sanitised with an allow-list, or PNG ≥ 512 px) makes the API render ICO 16/32/48, PNG 48/96/192/512, the 180 px apple icon on an opaque tile, and the maskable icon with padding (sharp). Each can be overridden individually.
- Validation: square, minimum size, file size budgets (icons ≤ 20 KB each, SVG ≤ 10 KB after sanitising), contrast warning when the symbol is too light on white.
- **Preview panel:** browser tab (light and dark), bookmark, Google result row with favicon, iOS home screen, Android adaptive icon (circle and squircle masks), WhatsApp/Facebook link card with the default OG image, email header.
- Changes are audited, cache-busted through the asset `sha256`, and revert-able (previous asset version kept).

### 1.5 Consistency checklist (verified in the Task 4.2 E2E)
Browser tab (Chrome, Safari, Firefox; light/dark) · bookmarks · Android "add to home screen" · iOS home screen · Google result favicon (after recrawl) · Organization logo in JSON-LD · OG/X cards for every page type · WhatsApp and Telegram previews · transactional emails · admin shell · auth pages · print sheet and receipts (mono logo) · 404/error pages.

---

## 2. Visual content system (social cards, covers, illustrations)

### 2.1 Open Graph / X card templates (rendered by the worker, CONTENT-PLATFORM §5.6)
Common frame 1200×630: `bg-warm` background with the faint lattice motif, brand symbol + wordmark at the top start corner, a 6 px navy rule, safe area 1100×550 (X crops), Arabic text right-aligned, English left-aligned, title max 3 lines (auto-fit 56→40 px), no text smaller than 28 px.
| Template | Content |
|---|---|
| `page` | page title + one-line subtitle (replaces the current static set; `og-images.mjs` retired once parity is reached) |
| `article` | category chip, title, author name, cover image on the start half (cropped by focal point) |
| `guide` | "دليل" chip, title, number of sections |
| `glossary` | the term large (e.g. **BID**), its Arabic meaning |
| `drug` | Arabic + English name, active ingredient, class chip; **no product photo**, a neutral pictogram per dosage form |
| `author` | photo (if any), name, credentials line |
Each template is versioned; changing a template re-renders cards lazily on next publish or by an admin "re-render all" job (rate-limited).

### 2.2 Article covers and in-article images
- Ratio 16:9 master (≥ 1600×900), crops 4:3 and 1:1 via focal point.
- Style guide: flat or soft-isometric illustrations in the brand palette (same family as the landing mascots), real photography only when licensed and relevant; no images of unidentified pills, no gore, no fear imagery, no people presented as doctors unless they are our reviewers.
- AI-generated illustrations allowed for concepts, labelled in the credit; never for anything that looks like a real medicine pack.

---

## 3. Homepage refresh (review → keep / change)

The page structure stays (hero, skills, precision, how it works, audiences, trust, FAQ, final CTA); content truth is checked first: the skills grid and hero reassurance still say «قريبًا» for features that are live after Phase 2 and 3. At launch the copy reflects what is actually available (owner confirms the list in Task 4.2).

### 3.1 Hero
**Trust pill** («صُمِّم للمريض والصيدلي والطبيب العربي»): keep the text; redesign the container:
- Larger: `py-2.5 px-5`, text `text-base`, icon in a 28 px glossy circle.
- **Frosted / liquid glass:** semi-transparent white fill (≈ 60 %), `backdrop-filter: blur(14px) saturate(160%)`, a 1 px gradient border (white 70 % → `primary-soft`), an inner top highlight (inset shadow), a soft navy-tinted drop shadow, and a slow **one-time** specular sweep on load (a pseudo-element moving `transform` only, 1.2 s, then still). A subtle lattice/gradient blob sits behind it so the blur has something to refract.
- Fallback when `backdrop-filter` is unsupported or `prefers-reduced-transparency: reduce`: opaque `surface` with the same border. The element is small, so the blur cost is negligible on mobile.

**Headline spacing** («افهم روشتتك في ثوانٍ.» / «بدقة تراجع نفسها.»): the two lines currently sit too tight because display Arabic glyphs (descenders of ث، ي and the dots) collide with a tight line-height on two `block` spans.
- Line-height for Arabic display sizes ≥ 1.3 (`leading-[1.3]`), plus a deliberate gap between the two lines (`mt-[0.12em]` on the second), `text-balance`, and a fluid size `clamp(2.1rem, 1.2rem + 4.2vw, 4.25rem)` instead of three breakpoint jumps.
- Verified with screenshots at 320, 360, 390, 768, 1024, 1280, 1440 widths and at 200 % zoom; no overlap, no orphan word on a line.
- The H1 stays the **LCP element** (text, painted on first render, font preloaded via `next/font`).

**Illustration** (`IsoScene`, «مثال توضيحي»): redraw for clarity and quality.
- One clear story in three planes: a handwritten prescription card → a scan beam → a structured result card with three rows (two confident, one flagged «راجع الصيدلي»), matching the product's real result UI so it doubles as a product preview.
- Consistent isometric angle and stroke widths, brand palette only, fewer decorative particles, crisp at 2× and 3×.
- «مثال توضيحي» becomes a small chip attached to the result card (part of the illustration's accessible description too), not a floating caption.
- Inline SVG ≤ 25 KB (no network request), `aspect-ratio` box reserved, `role="img"` with the existing descriptive alt text.
- **Motion choreography:** one intro sequence (≈ 2.4 s) — paper settles, the beam sweeps once, rows assemble top to bottom, the flagged row pulses once — then idle; a slow, low-contrast scan shimmer every ~8 s only while the hero is in view (paused off-screen through a view timeline), all `transform`/`opacity`, all disabled under reduced motion.
- Decorative icons around the hero (floating capsules, sparkles) are re-placed on an 8-px grid with consistent sizes and strokes; at most three, each with a distinct, slow, non-synchronised motion; none overlaps text at any width.

**Mobile order:** pill → H1 → lead → full-width CTAs → reassurance → illustration (100 % width, max-height 52 svh). Touch targets ≥ 48 px. No horizontal overflow at 320 px.

### 3.2 Replace "السرعة والدقة معًا" (precision section)
Problem with the current section: an abstract claim ("speed and accuracy together") with a looping 6-second pipeline animation that repeats the hero's idea, does not show *what* is checked, and loops forever.
New section: **«ماذا يحدث لكل سطر في روشتتك؟»** — a scroll-told, concrete walkthrough of one handwritten line:
1. **نقرأ الخط** — the scribble «Amoxil 500 1×3» with the read text appearing under it.
2. **نطابق مع قاعدة الأدوية** — three candidate names, the right one highlighted with its active ingredient (from our real DB vocabulary).
3. **نتحقق من الجرعة والتكرار** — "500 mg · 3 مرات يوميًا" normalised, glossary link for «1×3».
4. **نعلّم ما لا نتأكد منه** — a second line stays flagged with «اسأل الصيدلي» and the raw text shown, honouring AGENT §5.11.
- **Desktop:** a sticky visual on one side, four short text steps on the other; each step's view timeline drives the visual's state (CSS scroll-driven animations). **Mobile:** four stacked cards, each with its own small visual frame; no sticky, no scroll-jacking.
- **Proof, only if true:** an optional stat strip («متوسط وقت التحليل X ثانية» and an accuracy figure from the evaluation harness) appears only when the admin publishes a value backed by data (`landing.proof` setting; hidden while null). Never a made-up number.
- All text is server-rendered HTML (indexable, readable without animation); the section ends with a link to `/features/prescription-reader`.

### 3.3 Scroll motion system (replaces "fade in on scroll")
Principles: motion explains structure or progress; it is **tied to scroll position, so it plays forward when scrolling down and reverses when scrolling up**; nothing is invisible by default; no library.
| Pattern | Where | How |
|---|---|---|
| **Depth parallax** | hero illustration layers, section backdrops | `animation-timeline: view()` moving layers at different `translate` rates (≤ 24 px) |
| **Progress draw** | the connector line of the new precision section and "how it works" steps | SVG `stroke-dashoffset` driven by a view timeline |
| **Sticky storytelling** | precision section (desktop) | `position: sticky` + per-step view timelines switching visual states |
| **Settle** | cards in skills/audiences grids | from `scale(.97) translateY(12px)` to rest over the first 25 % of entry, opacity never below 0.6 |
| **Header condense** | site header | `animation-timeline: scroll(root)` adds shadow and reduces padding after 64 px |
| **Heading underline** | section headings | underline scales from 0 to 1 with entry progress |
Implementation rules: all inside `@supports (animation-timeline: view())` **and** `@media (prefers-reduced-motion: no-preference)`; browsers without support (currently Firefox) get the static, fully visible page; only `transform`, `opacity`, `clip-path`, `stroke-dashoffset`; no JS scroll listeners; `will-change` only on the sticky visual; tested at 4× CPU throttling on a mid-range Android profile with no long tasks attributable to animation and INP unaffected. DESIGN-SYSTEM §3.7 and §9 are updated to allow exactly this catalog.

### 3.4 FAQ accordion
- Keep native `<details>/<summary>` (no JS, accessible, text in HTML, FAQ JSON-LD unchanged).
- Smooth open/close: `interpolate-size: allow-keywords` on the container and a `::details-content` transition of `block-size` + `content-visibility` (240 ms, `ease-standard`); the answer text slides 6 px and fades from 0.4; chevron rotates. Browsers without support open instantly (no broken state).
- Exclusive mode (one open at a time) with the `name` attribute on the group (setting in the content file; default on).
- Reduced motion: instant.

### 3.5 Footer
- Real logo lockup (§1.2) instead of the pill fallback; the `BrandMark` fallback itself becomes the new symbol, so no page anywhere shows the pill chip again.
- Layout: brand column (logo, tagline, "apps coming soon" chips, social icons from `socials` settings) + link columns **المنتج** (features, pricing, for pharmacists/clinics), **الموارد** (blog, guides, medicines, glossary), **الشركة** (about, editorial policy, medical review, contact), **قانوني** (privacy, terms, disclaimer, «إعدادات الخصوصية» consent link); bottom bar with © year, the medical disclaimer line and the language switch (AR/EN on public pages).
- Mobile: brand block first, link columns as a two-column grid (no accordions: links must stay crawlable and visible), 48 px touch rows.

### 3.6 Android and iOS "coming soon"
- A compact band before the final CTA: a lightweight CSS/SVG phone frame showing the result card, the line «تطبيق وصفة AI على أندرويد و iOS — قريبًا», two neutral platform chips (Android, iOS icons + «قريبًا»), and an optional «أبلغني عند الإطلاق» form (email + explicit marketing consent → `app_waitlist`, event `app_waitlist_joined`).
- **Not** the official App Store / Google Play badges (their brand guidelines require a live listing); a setting `apps.androidUrl` / `apps.iosUrl` switches the chips to official badges automatically when the apps are published.
- `SoftwareApplication` JSON-LD keeps `operatingSystem: "Web"` until real listings exist.

### 3.7 Header
Reviewed: the structure and behaviour are good and stay. Two clear improvements only: (1) the scroll-condense state from §3.3, (2) navigation entries for **المدونة** and **الأدوية** once those sections exist (internal linking and discovery), keeping the mobile menu within one screen.

### 3.8 English homepage
`/en` uses the same components with English copy (`content/landing.en.ts`), `dir="ltr"`, mirrored layout through logical properties; illustration text switches language.

---

## 4. Performance and quality gates for this work
- Home page Lighthouse mobile: Performance ≥ 95, Accessibility 100, Best Practices 100, SEO 100 (existing DESIGN-SYSTEM target) on the production build with the CSP and Cloudflare in front.
- LCP element is the H1; CLS ≤ 0.02; total JS on `/` ≤ 80 KB compressed first load; inline SVGs ≤ 25 KB each; no new runtime dependency for motion.
- Visual regression screenshots (Playwright) for 360, 390, 768, 1280, 1440 widths in AR and EN, with motion on and reduced motion.
- axe: zero violations; focus order logical; all decorative SVGs `aria-hidden`.
