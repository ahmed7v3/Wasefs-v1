# DESIGN-SYSTEM.md — Wasfa AI

> The visual and interaction contract for `apps/web` and `packages/ui`. Brand colours, fonts and the light theme are locked in AGENT.md §3; this file says how they are used.
> **Source of truth for values: `packages/ui/tokens.css`.** This document explains the _why_ and the _rules_; if the two disagree, fix the document or change the token, never hard-code a value in a component.
> Status: everything in §5 is **built** as of Phase 1 Tasks 1.9-1.11. Dark mode is deliberately out of scope for Phase 1; the tokens are CSS variables so a dark theme can override them later.

---

## 1. Principles

1. **Calm, light, trustworthy, premium.** A medical product: generous white space, soft surfaces, one strong colour (navy), no decoration that does not carry meaning.
2. **Arabic-first, RTL-correct.** Design in RTL at **360 px** first; desktop is the second pass; LTR must simply work because everything uses logical properties.
3. **Readable above all.** Arabic needs air: body line-height 1.75, headings 1.35, body 16 px minimum, never light grey on white.
4. **Accessible by default.** WCAG 2.2 AA: contrast, focus, 44 px touch targets, labels on every field, no information by colour alone, reduced-motion respected.
5. **Tokens only.** No hex codes, no magic pixel values, no `left`/`right` in components.
6. **Flagship screens get the care** (AGENT.md priority 3): landing, checkout, dashboard, admin. Everything else is consistent, not bespoke.

---

## 2. Visual target (`docs/references/*.png`)

These are the direction, not templates to copy. We take the _feel_, in our palette (navy `#1E3A8A`, soft blue `#60A5FA`) and Arabic RTL.

| File    | What it shows                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | What we take from it                                                                                                                                                                                                                                                               |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `1.png` | An **Arabic RTL admin dashboard**: sidebar on the right with grouped, collapsible sections and a filled pill for the active item; top bar with a search field, icon buttons with small count badges and an account menu; a grid of **stat cards** (large number, small label, round icon chip, thin coloured edge); a smooth line chart with a soft gradient fill and rounded segmented control (weekly / monthly / yearly); status chips with soft tinted backgrounds; a lower panel with a calendar strip and list cards. Dense but orderly. | The **Admin v1** layout (Task 1.10): right-side sidebar in RTL, stat-card grid, rounded containers, tinted status chips, chart style, filter chips above tables. We use navy (not saturated multi-colour) for the active item and keep the colour accents to status only.          |
| `2.png` | A **soft, airy workspace**: a large rounded white panel floating on a blurred pastel gradient; a slim icon rail; very large, high-contrast type for the focused content with the rest faded; a dark rounded control bar; small round floating tiles.                                                                                                                                                                                                                                                                                           | The **atmosphere** of the dashboard shell and the AI screens (Phase 2): floating rounded surface over a gentle gradient, a narrow icon-first nav, clear focus on one thing at a time, large readable type.                                                                         |
| `3.png` | An **AI assistant home**: greeting headline, three equal rounded suggestion cards (icon, one sentence, small category label), a rounded composer at the bottom with an attach button, a text field, a mic/send pair and a row of dark pill "skill" chips; soft white-blue gradient with faint line art; a friendly mascot.                                                                                                                                                                                                                     | The **empty-state dashboard home** (Task 1.9: "tools arrive soon" cards use the same card rhythm), the later `/ai` composer and skill chips (Phase 2), and the page backdrop (`.page-backdrop` in `globals.css` already approximates this wash). Dark pills become **navy** pills. |

Common to all three: generous radii (16-32 px), soft shadows tinted toward the brand colour, white surfaces on a faintly tinted background, icon chips in rounded squares or circles, restrained colour.

---

## 3. Tokens (`packages/ui/tokens.css`) — built

### 3.1 Colour

| Token (Tailwind class)                           | Value                                                                 | Use                                                                                                                                       |
| ------------------------------------------------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `primary`                                        | `#1e3a8a`                                                             | Brand navy: primary buttons, links, active nav, headings on light.                                                                        |
| `primary-hover`                                  | `#172e6e`                                                             | Hover/pressed for primary.                                                                                                                |
| `primary-soft`                                   | `#e3eafb`                                                             | Hover wash, selected rows, ghost-button hover.                                                                                            |
| `accent`                                         | `#60a5fa`                                                             | Highlights, chart accents, decorative gradients. **Never as text colour or as the only boundary of a control** (contrast 2.5:1 on white). |
| `accent-soft`                                    | `#e6f1fe`                                                             | Badges, backdrop wash.                                                                                                                    |
| `on-primary`                                     | `#ffffff`                                                             | Text/icons on `primary`.                                                                                                                  |
| `bg`                                             | `#f5f7fb`                                                             | Page background (app, auth, admin).                                                                                                       |
| `bg-warm`                                        | `#f6f6f4`                                                             | Page background of the public pages (landing, legal, contact); `text` / `text-muted` on it are 17.3 / 6.8; `primary` 9.6.                 |
| `mascot-navy/blue/indigo/teal/coral/amber/olive` | `#1e3a8a` `#3b82f6` `#3e4ea8` `#2a6f77` `#c65a4a` `#d4902e` `#5f7f3b` | Landing illustrations only (mascots, accent bars, tints via `/10`). Decorative; **never as text colour**.                                 |
| `surface`                                        | `#ffffff`                                                             | Cards, panels, inputs.                                                                                                                    |
| `text`                                           | `#0b1220`                                                             | Body text.                                                                                                                                |
| `text-muted`                                     | `#4a5670`                                                             | Secondary text, hints, captions.                                                                                                          |
| `border`                                         | `#d3dae6`                                                             | Decorative dividers and card borders only (see 3.2).                                                                                      |
| `neutral-50 … 900`                               | cool grey-blue ramp                                                   | Disabled states, table stripes, input borders (`neutral-400`), icons.                                                                     |
| `success` / `-soft`                              | `#15803d` / `#dcfce7`                                                 | Confirmed, verified, paid.                                                                                                                |
| `warning` / `-soft`                              | `#b45309` / `#fef3c7`                                                 | Needs attention, low confidence, pending.                                                                                                 |
| `danger` / `-soft`                               | `#b91c1c` / `#fee2e2`                                                 | Errors, destructive actions, suspended.                                                                                                   |
| `ring`                                           | `#2563eb`                                                             | Focus ring colour.                                                                                                                        |

### 3.2 Measured contrast (WCAG ratio, computed from the token values)

| Pair                                              | Ratio              | Rule                                                                                                 |
| ------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------- |
| `text` on `bg` / `surface`                        | 17.5 / 18.7        | Body.                                                                                                |
| `text-muted` on `surface` / `bg`                  | 7.4 / 6.9          | Secondary text is safe at any size.                                                                  |
| `primary` on `surface` / `bg` / `primary-soft`    | 10.4 / 9.7 / 8.6   | Links, headings, active nav.                                                                         |
| `on-primary` on `primary` / `primary-hover`       | 10.4 / 12.7        | Button labels.                                                                                       |
| `success` / `warning` / `danger` on their `-soft` | 4.57 / 4.51 / 5.30 | Status chips: **do not go lighter or smaller than `text-sm` semibold**; these are near the AA limit. |
| `danger` on `surface`                             | 6.5                | Inline error text.                                                                                   |
| `ring` on `surface` / `bg`                        | 5.2 / 4.8          | Focus ring (needs 3:1).                                                                              |
| `neutral-400` on `surface`                        | 3.13               | **Input/control borders**: WCAG 1.4.11 needs ≥ 3:1 for the boundary that identifies a control.       |
| `border` on `surface`                             | 1.41               | **Not enough** for a control boundary: use only for decorative dividers and card edges.              |
| `accent` on `surface` / on `primary`              | 2.54 / 4.07        | Not for text on white.                                                                               |

### 3.3 Typography

Font (self-hosted by `next/font`, `apps/web/src/lib/fonts.ts`): **IBM Plex Sans Arabic is the only typeface** (owner decision 2026-10-11, ARCHITECTURE #26). `font-heading` and `font-body` both resolve to it: headings are weight **700** (the base `h1`-`h4` rule, line-height 1.3, never letter-spaced), body is 400. Plex 400 and 700 are preloaded; 500 and 600 load on demand, so do not use `font-medium` above the fold. On the public pages (`.marketing-type`) `font-semibold` renders as 700, so those pages need only the two preloaded weights. Do not preload more weights.

Type scale (Tailwind sizes; mobile → `sm:` ≥ 640 px):

| Role            | Classes                                                      | Where                                                                       |
| --------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Display         | `font-heading font-bold text-4xl sm:text-5xl` text `primary` | Landing hero only.                                                          |
| H1              | `font-heading font-bold text-3xl sm:text-4xl`                | Page titles.                                                                |
| H2              | `font-heading font-semibold text-2xl`                        | Section titles.                                                             |
| H3 / card title | `font-heading font-semibold text-xl`                         | `CardTitle`, drawer and dialog titles.                                      |
| Lead            | `text-lg text-text-muted`                                    | Intro paragraph under a heading.                                            |
| Body            | `text-base` (16 px), line-height 1.75                        | Default.                                                                    |
| Small           | `text-sm`                                                    | Hints, table secondary text, chips.                                         |
| Caption         | `text-xs text-text-muted`                                    | Timestamps and legal footers only; never for anything the user must act on. |

Rules: one `h1` per page; headings use `text-wrap: balance` (set globally); numbers use **Western digits** by default (admin setting); tables and stat cards use tabular figures (`tabular-nums`); do not bold whole paragraphs; do not letter-space Arabic.

### 3.4 Spacing and layout

- Spacing uses Tailwind's 4 px step. Named rhythm tokens: `gutter` 1 rem (mobile) / `gutter-lg` 2 rem (≥ `sm`), `section` 4 rem between landing sections.
- `Container`: `max-w-page` 72 rem; `width="reading"` 40 rem for prose, forms and legal pages.
- Card padding `p-6 sm:p-8`; vertical rhythm inside a form 20-24 px; between sections 48-64 px on mobile, 64-96 px on desktop.
- Breakpoints: Tailwind defaults (`sm 640`, `md 768`, `lg 1024`, `xl 1280`). **Verify every screen at 360 px and 1440 px.**
- App shell (Task 1.9): top bar 64 px; sidebar 256 px expanded / 72 px collapsed, on the **inline-start** side (right in RTL); below `lg` the sidebar becomes a drawer. Content area uses `Container` or a full-width fluid panel for tables.

### 3.5 Radii

| Token          | Value    | Use                                                    |
| -------------- | -------- | ------------------------------------------------------ |
| `rounded-sm`   | 0.5 rem  | Small chips, table cells' inner controls.              |
| `rounded-md`   | 0.75 rem | Inputs, selects, toasts.                               |
| `rounded-lg`   | 1 rem    | Buttons, icon chips, dropdowns.                        |
| `rounded-xl`   | 1.5 rem  | Cards, dialogs.                                        |
| `rounded-2xl`  | 2 rem    | Hero and floating shell panels (like `2.png`/`3.png`). |
| `rounded-full` | —        | Badges, avatars, pills.                                |

### 3.6 Elevation

| Token                                 | Use                                                                  |
| ------------------------------------- | -------------------------------------------------------------------- |
| `Card elevation="flat"` (border only) | Dense admin areas, tables.                                           |
| `shadow-card` (default)               | Cards.                                                               |
| `shadow-raised`                       | The single flagship surface of a screen (hero, shell panel, dialog). |
| `shadow-focus`                        | Focus ring glow on controls (`focus-visible:shadow-focus`).          |

Shadows are navy-tinted. One raised surface per screen; if everything floats nothing does.

Layer order (z-index): sticky bars 10, dropdowns and popovers 20, drawers and dialogs 30, toasts 40, skip-link 50.

### 3.7 Motion — built (`--motion-*`, `--ease-standard`)

| Token           | Value                        | Use                                                                                |
| --------------- | ---------------------------- | ---------------------------------------------------------------------------------- |
| `--motion-fast` | 150 ms                       | Hover, focus, colour changes, checkbox ticks.                                      |
| `--motion-base` | 200 ms                       | Dropdowns, tabs, toasts in/out, accordion.                                         |
| `--motion-slow` | 320 ms                       | Drawers and dialogs, shell sidebar collapse.                                       |
| `ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | Everything. Entering things decelerate; do not use bounce or spring on medical UI. |

Rules: animate only `opacity` and `transform` (and colour); no layout-shifting animation. Motion never carries meaning on its own. **`prefers-reduced-motion: reduce`** is honoured globally in `globals.css` (animations and transitions collapse to ~0 ms), so components do not need their own checks; auto-playing or looping animation is not allowed outside the landing hero, and there it must also stop under reduced motion.

**Scroll motion catalog (public landing only, `globals.css` "Scroll motion" block).** CSS scroll-driven animation (`animation-timeline: view()`/`scroll()`) is allowed for exactly these utilities, always inside `@supports (animation-timeline: view())` **and** `@media (prefers-reduced-motion: no-preference)`, with no JS scroll listeners and nothing hidden by default: `motion-parallax` (layer drift, `--parallax-shift` at most 24px), `motion-draw` (SVG `stroke-dashoffset` on `pathLength="1"` paths), `motion-settle` (cards from `scale(.97) translateY(12px)`, opacity never below 0.6), `motion-underline` (heading underline `scaleX`), and the precision sticky story (`motion-story*`, `precision-sticky`, `story-panel*`; `will-change` only on the sticky stage). Only `transform`, `opacity`, `clip-path` and `stroke-dashoffset` animate. Browsers without support get the still, fully visible page.

---

## 4. RTL rules

1. `<html lang="ar" dir="rtl">` by default (root layout). Set `lang`/`dir` on any embedded LTR fragment instead of flipping the page.
2. **Logical properties only:** `ms-* me-* ps-* pe-*`, `start-* end-*`, `text-start/end`, `border-s/e`, `rounded-s/e`, `inset-inline-*`. Never `ml-* mr-* pl-* pr-* left-* right-* text-left/right` for layout.
3. **Flex and grid follow the document direction**: do not reverse rows by hand (`flex-row-reverse`) to fake RTL.
4. **Icons.** Icons that express _direction_ mirror in RTL with `rtl:-scale-x-100`; icons that depict objects never do.
   - **Mirror:** `ChevronLeft/Right`, `ArrowLeft/Right`, `ChevronsLeft/Right`, `PanelLeft/Right` (sidebar toggle), `LogIn`, `LogOut`, `Undo`, `Redo`, `Reply`, `Forward`, `Send`, `RotateCcw/Cw` (retry arrows), `IndentIncrease/Decrease`, "back" and "next" arrows, step-progress arrows.
   - **Do not mirror:** `Check`, `X`, `Plus`, `Minus`, `Search`, `Clock`, `Phone`, `Mail`, `Bell`, `Settings`, `ShieldCheck`, `Pill`, media play/pause, brand logos, anything with text or digits in it.
   - Charts: the time axis runs right-to-left in RTL (as in `1.png`); legends and tooltips use logical alignment.
5. Numbers, Latin brand names, emails, URLs and phone numbers are LTR runs inside RTL text: wrap them in `<bdi>` or `dir="ltr"` (inputs for email, phone, codes and URLs get `dir="ltr"` and `text-start`) so punctuation does not jump.
6. Phone numbers display as E.164 with `dir="ltr"`; dates are Gregorian (`Intl` with `ar-EG` or `ar` and Latin digits), Hijri only when the admin setting is on.
7. Never hard-code Arabic in components: strings go through `t()` (`@wasfa/shared/i18n`). Content pages (legal, landing copy) live in content files.
8. Truncation: use `truncate` / line-clamp with the full text in `title` or an accessible tooltip; never cut mid-word in headings.
9. Test every screen at 360 px **and** 1440 px, in RTL; check scrollbars, drawers (slide in from the inline-start) and dropdown alignment.

---

## 5. Components

### 5.1 Built (`packages/ui`, registered in REUSE-INDEX.md)

| Component                   | Notes                                                                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `Button` / `buttonStyles()` | `primary`, `secondary`, `ghost`; sizes `md` (44 px) and `lg` (48 px); focus ring; `buttonStyles()` styles links (`next/link`) as buttons. |
| `Card`, `CardTitle`         | `flat` / `card` / `raised` elevation, `rounded-xl`, padding `p-6 sm:p-8`.                                                                 |
| `Container`                 | Page column with responsive gutters; `width="reading"`.                                                                                   |
| `cn`                        | Class-name joiner.                                                                                                                        |

### 5.2 Primitives — built in Task 1.9 (registered in REUSE-INDEX.md; `Textarea` and `Card padding` added in Task 1.10)

All primitives: accessible name on every control, visible `focus-visible` ring, disabled state at 50 % opacity **plus** `aria-disabled`, minimum 44 px hit area, tokens only, logical properties, forward `ref` and native props.

| Component    | Spec                                                                                                                                                                                                                                                                                                                         |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Input`      | `min-h-11`, `rounded-md`, `border border-neutral-400` on `surface`, `px-4`, `text-base`; hover border `neutral-600`; focus = `shadow-focus` + `border-ring`; invalid = `border-danger` + `aria-invalid`; supports `dir="ltr"` variant for email/phone/code, an inline start icon and an end action (show/hide password).     |
| `Field`      | Wraps a control: **visible label above the control** (never placeholder-only), optional hint (`text-sm text-text-muted`), error message (`text-sm text-danger` with an icon; linked with `aria-describedby`; `role="alert"` when it appears after submit), required marker (text "(مطلوب)" via `t()`, not just an asterisk). |
| `Select`     | Native `<select>` styled like `Input` (best on mobile, free a11y); a custom listbox only if a native one cannot do the job.                                                                                                                                                                                                  |
| `Checkbox`   | 24 px box (44 px hit area with its label), `rounded-sm`, `primary` when checked, label to the inline-end of the box.                                                                                                                                                                                                         |
| `Dialog`     | Modal, focus trap, `Esc` closes, returns focus, `rounded-xl shadow-raised`, title (`H3`) + description, actions at the inline-end; destructive confirmations require an explicit verb button ("حذف الحساب") and, for the most dangerous actions, a typed confirmation. Bottom sheet below `sm`.                              |
| `Toast`      | Non-blocking result of an action; `role="status"` (errors `role="alert"`); 5 s (errors persist until dismissed); max 3 visible; bottom, centred on mobile, inline-end on desktop; never the only place an error appears.                                                                                                     |
| `Tabs`       | `role="tablist"`, arrow-key navigation (arrows follow RTL), active = `primary` underline or filled pill; used for login (email / phone) and admin detail views.                                                                                                                                                              |
| `Avatar`     | `rounded-full`, image with initials fallback on `primary-soft`; sizes 32 / 40 / 56.                                                                                                                                                                                                                                          |
| `Badge`      | `rounded-full text-sm font-semibold px-3 py-1` on a `-soft` background (success / warning / danger / info / neutral); also the "قريباً" (coming soon) badge. Always contains text: colour is never the only signal.                                                                                                          |
| `Skeleton`   | `animate-pulse` block on `neutral-100`, shaped like the final content; the pulse stops under reduced motion (global rule).                                                                                                                                                                                                   |
| `EmptyState` | See §7.                                                                                                                                                                                                                                                                                                                      |

### 5.3 Patterns used by screens

- **Stat card** (admin and dashboard, from `1.png`): `Card` + large number (`text-3xl font-heading tabular-nums`) + label (`text-sm text-text-muted`) + icon chip (`size-12 rounded-lg bg-primary-soft text-primary`). Optional trend `Badge`.
- **Data table** (admin): server pagination, filters in the URL, sticky header, row height 48 px, zebra off by default, row click opens a detail drawer, actions in an end-aligned menu; on mobile it becomes a list of cards. Never horizontal-scroll the whole page.
- **Floating contact hub** (Task 1.9 / 1.11): a round button at the inline-end corner that opens WhatsApp / Telegram / phone links; hidden when no contact is configured; clears the on-screen keyboard and the safe area on mobile.
- **Social-provider buttons** (login): full-width secondary buttons with the provider mark; a provider that is `coming_soon` is rendered **disabled** with a "قريباً" `Badge` and `aria-disabled`; all driven by `GET /auth/providers`.

### 5.4 Capture (Task 2.6) — `packages/ui/src/capture`

One component for every place a prescription photo is taken: `/analyze` (`variant="full"`), the phone page `/capture/<token>` (`compact`, no Analyze bar), and later the dashboard card (`compact`) and the `/ai` composer (`composer`: no empty-state copy and no Analyze bar). Mount **one per page**: the drop and paste listeners are on the window.

**API**

```ts
<CaptureSurface
  variant="full" | "compact" | "composer"
  maxPages={n}                      // plan limit (public setting rx.maxPages)
  onPagesChange={(pages) => …}      // CapturePage[] = { localId, fileId, status, previewUrl, quality, progress, errorRef … }
  price?={{ perPage, balance }}     // shows "تحليل — N رصيد" and the balance; N × pages > balance → "رصيدك غير كافٍ" + support link
  onAnalyze?={(fileIds) => …}       // absent: no Analyze bar (phone page, composer)
  disabled? supportHref?
  uploader={CaptureUploader}        // injected by apps/web: prepare(file) → ready pages, upload(page) → { fileId }
  handoff?={HandoffClient}          // absent: no "استخدم هاتفك" button
/>
```

The UI package knows nothing about the API, R2, pdf.js or libheif. Sub-components (`DropOverlay`, `PageTray`, `PageThumb`, `ImageEditor` (lazy), `QualityHint`, `PhoneHandoff`) are exported for reuse and tested on their own.

**States** (all strings in `packages/shared/src/i18n/{ar,en}.capture.ts`)

| State                    | What the person sees                                                                                                                                                                                                                                                                                                                                                     | Announced (polite live region)   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| **Empty**                | Dashed card: icon, "ابدأ بتصوير الروشتة", hint with the page limit, primary "اختر صورة", "التقط صورة" on touch devices only, "استخدم هاتفك" when a handoff client is given, "أو اسحب الصورة وأفلتها هنا", and "أو الصق صورة (Ctrl+V)" only when the device has a fine pointer and hover (a keyboard).                                                                    | —                                |
| **Dragging**             | Calm full-page overlay "أفلت الصورة هنا" while a _file_ is dragged over the window (enter/leave depth counted so child elements do not flicker it away); hidden on leave or drop. Dragged text or links do nothing. A non-image file is refused with an error toast.                                                                                                     | "أفلت الملف لإضافته."            |
| **Processing**           | Tile with a spinner "جارٍ التجهيز…" (decode, resize, JPEG, quality check run in the browser).                                                                                                                                                                                                                                                                            | "أُضيفت الصفحة n."               |
| **Uploading**            | Tile with a progress bar and "جارٍ الرفع n%"; two pages upload at once, the rest queue.                                                                                                                                                                                                                                                                                  | —                                |
| **Quality warning**      | The page waits (it is _not_ uploaded) and a hint card with the preview, the reason ("الصورة غير واضحة — جرّب الإضاءة أو قرّب الكاميرا"), "لا يُخصم أي رصيد قبل أن تضغط «تحليل»", and two buttons: **إعادة الالتقاط** (removes the page and opens the picker) and **المتابعة على أي حال** (uploads it). Analyze is disabled with a reason until every warning is decided. | "الصفحة n تحتاج مراجعة: …"       |
| **Ready**                | Tile with a check and "جاهزة"; the Analyze button is enabled and shows the price and the balance.                                                                                                                                                                                                                                                                        | "اكتمل رفع الصفحة n."            |
| **Insufficient credits** | The Analyze button is replaced by `role="alert"`: "رصيدك غير كافٍ", the price against the balance, and a link "تواصل مع الدعم لشحن رصيدك" (payments arrive in Phase 3). Pages stay; nothing is lost.                                                                                                                                                                     | alert                            |
| **Offline**              | A `warning` banner "لا يوجد اتصال بالإنترنت — سيستمر الرفع تلقائيًا عند عودة الاتصال". Retries wait for the connection instead of using up attempts.                                                                                                                                                                                                                     | "لا يوجد اتصال…" / "عاد الاتصال" |
| **Upload error**         | Tile in `danger` with the friendly sentence, the `WSF-XXXX-XXXX` reference when the API gave one, and "إعادة المحاولة" (retries only that page). Network and 5xx failures are retried automatically (1, 2, 4 s) before this shows.                                                                                                                                       | "تعذّر رفع الصفحة n."            |
| **Limit reached**        | "وصلت إلى الحد الأقصى (n صفحات)"; add buttons disabled. A PDF with more pages than room is cut with a toast.                                                                                                                                                                                                                                                             | —                                |
| **Handoff waiting**      | Dialog: QR code, the link as text (copy button), a countdown (`m:ss`, Western digits), "في انتظار الهاتف…", and the note that nothing is analysed until Analyze is pressed here.                                                                                                                                                                                         | —                                |
| **Handoff connected**    | Same dialog with "وصلت n من 4 صور من هاتفك"; each phone photo appears in the tray as it is processed.                                                                                                                                                                                                                                                                    | "وصلت صفحة من هاتفك: الصفحة n."  |
| **Handoff expired**      | "انتهت صلاحية الرمز" with "رمز جديد" (a fresh single-use code for the same capture session). Pages already received stay.                                                                                                                                                                                                                                                | —                                |

**Keyboard and screen reader.** Everything is a native control reachable by Tab. A focused page tile reorders with the arrow keys (the arrows follow what is on screen, so in RTL the right arrow moves a page toward the start) and has move/remove/edit buttons for pointer users; the tile that moved keeps focus. The editor (rotate 90°, crop with four handles that take arrow keys, Shift for a bigger step, reset) is a dialog, loaded only when opened. All controls are ≥ 44 px, logical CSS only.

**Browser pipeline** (`apps/web/src/lib/capture`): decode with `createImageBitmap(file, { imageOrientation: "from-image" })` → long edge 2048 → JPEG q0.85 → SHA-256, in a Worker where OffscreenCanvas exists (main thread otherwise). HEIC: native decode first (Safari), else `heic2any` loaded on demand. PDF: first ≤ 4 pages rasterized with pdf.js (on demand). Quality (`quality.ts`, on a 512 px grayscale copy): long edge < 1000 → low resolution; variance of the Laplacian < 100 → blurry (**untuned**, see phase2.md Notes); mean brightness < 50 → dark; mean > 215 **and** under 0.3 % ink pixels (gray < 100) → washed out. A clean white page with dark text is bright on average and must pass, so brightness alone is not enough. Blur wins over washed-out (a blur erases the ink too).

### 5.5 Assistant (Task 2.11) — `packages/ui/src/chat`

`/ai` is a history panel (inline-start, 288 px; a drawer below `lg`) next to the conversation. Components: `Composer`, `ModeToggle`, `MessageList`, `Message`, `Markdown`, `ThinkingPanel`, `SourceChips`, `SkillChips`; the web app owns data (`apps/web/src/components/chat`).

- **Composer**: a rounded surface with a growing textarea (to 8 lines, then it scrolls), attach (+), web-search toggle, a cost note on hover/focus of the info button, the mode segmented control, and one round navy button that is **send** or, while streaming, **stop**. `Enter` sends, `Shift+Enter` adds a line, and the Enter that confirms an IME candidate never sends (`isComposing` or keyCode 229). Pasted or dropped images attach; the counter appears at 80% of the 8000-character limit.
- **ModeToggle**: native radios in a pill group; a mode the plan lacks is a disabled radio with the "ترقية" badge and a title, never hidden.
- **Messages**: user messages are soft-navy bubbles at the inline-end; answers are plain text under the product name. Markdown is sanitized (raw HTML is shown as text), links open in a new tab with `noopener noreferrer`, tables scroll inside their own box, code blocks are LTR, and runs of Latin text and numbers inside Arabic are wrapped in `<bdi>`. The medical disclaimer sits under every answer; copy, regenerate (last answer only) and 👍/👎 appear once the answer is complete.
- **Streaming**: text is applied once per animation frame; the list follows the newest text only while the user is at the bottom, otherwise a "↓ جديد" button appears. The list itself is not a live region: one polite status announces "اكتملت الإجابة." (or the stopped variant) when the answer ends.
- **ThinkingPanel**: collapsed; "يفكّر…" while the model reasons, then "فكّر لمدة N ث" with an expand control. **SourceChips**: domain plus title, no favicon, new tab.

### 5.6 Result (Task 2.9) — `packages/ui/src/{ImageViewer,RxTable,ConfidenceBadge,StepProgress,CandidatePicker}.tsx`

`/analyze/[id]` shows one analysis; `/analyze/history` lists them. The UI package knows no API: `apps/web/src/components/rx` owns data, the stream, corrections and actions.

**Layout.** From `lg` the grid is image (inline-start, 2fr) and results (3fr). Below it the image is a collapsible block on top (toggle "إخفاء/عرض الصورة") and results follow. The table is a real `<table>` from `xl`; below, the same markup is stacked cards with explicit ARIA roles (`table`, `row`, `rowheader`, `columnheader`, `cell`) so it is still announced as a table. `tabular-nums` throughout; logical CSS only (the viewer stage is `dir="ltr"` because image coordinates are physical; its overlays use `inset-inline-start`).

**API**

```ts
<ImageViewer pages={ViewerPage[]} page onPageChange regions={ViewerRegion[]} activeId onHover(id|null) onSelect(id) onImageError? onRetry? />
<RxTable items activeIndex selectedIndex onActivate(i|null) onSelect(i) onReview(i) pending? />
<ConfidenceBadge level="high"|"medium"|"low" unmatched? />   // unmatched: "غير مؤكد", never shown as high
<StepProgress steps current elapsedSeconds? note? />
<CandidatePicker open onOpenChange rawText candidates|null loadFailed? onRetry? busy? error? onCorrect({candidateId|text, consentForEval}) />
```

**States**

| State                            | What the person sees                                                                                                                                                                                                                                                                                           |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Running                          | Card with the four steps (done check, current `Spinner`, pending number), elapsed `m:ss`, "يمكنك مغادرة هذه الصفحة…". One polite status line announces the step that begins; the clock is not live. After 3 dropped streams a note says it is following automatically (polling every 2 s). No other animation. |
| Done                             | Split layout, table, notices, actions, disclaimer. A polite status says "اكتمل التحليل."                                                                                                                                                                                                                       |
| Refunded                         | Card with the guidance and "لم نخصم أي رصيد", link to a new analysis.                                                                                                                                                                                                                                          |
| Failed                           | `role="alert"` card, the `WSF-` ref chip, new analysis and support links.                                                                                                                                                                                                                                      |
| Image deleted / loading / failed | Placeholder in the viewer: "الصورة حُذفت بعد 30 يومًا", spinner, or message + "حاول مرة أخرى". The result stays.                                                                                                                                                                                               |
| Flagged row                      | Amber edge on the inline-start side, confidence badge, "راجع" (44 px) opening the picker. Unmatched rows show the raw text read and "غير مؤكد".                                                                                                                                                                |
| Correcting                       | Picker closes at once, the row shows the new value with `aria-busy`, the API answer replaces it; on failure it reverts and an error toast with the ref appears.                                                                                                                                                |
| Deep re-run                      | Only when a line is low confidence, the mode is not already deep and the pictures exist: price (pages × credits per page) shown first; a short balance disables it with an alert.                                                                                                                              |

**Viewer interaction.** Drag (when zoomed), wheel, two-finger pinch, `+`/`-`/`0` and arrows (focus the viewer, a labelled group), toolbar buttons. Hovering, focusing or selecting a row outlines its `box_2d` and pans a zoomed image to show it (and switches page); hovering a box highlights its row and tapping it selects the row. Outlines are `aria-hidden`: the row buttons are the accessible equivalent.

**Print.** `RxPrintSheet` (hidden on screen, `data-rx-print`) is the page: A4, RTL, lines table, disclaimer, unreadable note; no image, no names. `globals.css` hides the shell whenever `[data-rx-print]` is on the page, so Ctrl+P and the Print button give the same sheet.

**Share and copy.** Text is built only from structured fields (never notes, initials, date or files). Share is a link to `https://wa.me/?text=`.

### 5.7 Billing (Task 3.7) — `packages/ui/src/billing`

The pricing page, checkout and billing account are built from these (all strings through `billing.*` keys; money only through `formatMoney`, `tabular-nums`, never computed in the UI). The rules of BILLING §6 and GROWTH-STRATEGY §2 are part of the components: no countdown without a real `endsAt`, no fee added after Pay.

| Component         | Notes                                                                                                                                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PlanCard`        | Article with badges, name, price slot, feature list (check / dash plus a spoken "غير مشمولة"), choose button; the recommended plan has a `primary` ring.                                                 |
| `PriceTag`        | Amount in `font-heading` bold; the struck old price is read as "السعر قبل الخصم".                                                                                                                        |
| `PromoBadge`      | `Badge` (success by default) with a tag icon; always has text.                                                                                                                                           |
| `Countdown`       | Renders nothing without a real server `endsAt`; once-a-minute under reduced motion.                                                                                                                      |
| `ComparisonTable` | A real `<table>` (caption, column and row headers) in its own focusable scroll box; yes/no spoken in words.                                                                                              |
| `CheckoutSummary` | Plan line, discount line in `success`, one native `<details>` «الضريبة والرسوم» line (hidden only when there is no tax or fee), «الإجمالي» at `text-3xl sm:text-4xl`; the total is a polite live region. |
| `MethodPicker`    | Native radios in a `fieldset`, 56 px rows, fee at the inline end ("بدون رسوم" / "+ 7.20 ج.م").                                                                                                           |
| `ProofUploader`   | `CaptureSurface` (compact, one page) for the transfer screenshot.                                                                                                                                        |
| `CopyField`       | LTR value box and a copy button; "تم النسخ" is announced politely.                                                                                                                                       |
| `ReceiptSheet`    | Card on screen; under `@media print` plain, borderless, black on white (the shell chrome carries `print:hidden`).                                                                                        |

---

## 6. Forms

1. **One column.** Labels above controls. Group related fields with a heading, not a border.
2. **Validate twice.** The browser runs the _same shared zod schema_ as the API (`packages/shared`), so messages are specific and instant. The server stays the authority.
3. **Server errors.** The API answers `VALIDATION_FAILED` with `details.fields`: an array of **field paths only** (values are never echoed, so a password or a phone cannot leak back). The form marks each listed path invalid (`aria-invalid`, danger border) and shows that field's message from the client-side schema, or the generic "قيمة غير صحيحة" (via `t()`) when the client rules did not catch it. Nested paths are dotted (`organization.city`).
4. **Summary.** If the form has more than 3 fields or the errors are off-screen, show an error summary at the top (`role="alert"`, focus moved to it) listing links to each invalid field.
5. **Submit.** The submit button shows a spinner and is disabled while the request runs (prevents double submit); the label stays readable. Keep the user's input on every error.
6. **Other error codes.** `RATE_LIMITED` → "wait a moment" with the retry time if known; `AUTH_REQUIRED` with `details.reason = "reauth"` → open the re-authentication dialog and replay the action; `FORBIDDEN` → permission message; anything else → the generic error state with the `WSF-` reference (§7).
7. **Specific controls:** passwords have a show/hide toggle and a strength hint (min length 10); OTP-style codes use `inputmode="numeric"`, `autocomplete="one-time-code"` and `dir="ltr"`; phone inputs take a country selector and store E.164; `autocomplete` attributes are set on every identity field; the browser's password manager must work (no blocking of paste).
8. **Destructive actions** use a `Dialog` with an explicit verb; account deletion also requires re-authentication and a typed confirmation.

---

## 7. States: empty, loading, error

| State                                           | Pattern                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Loading, content of known shape**             | `Skeleton` shaped like the content, shown only if loading exceeds ~300 ms (avoid flashes); preserve layout so nothing shifts.                                                                                                                                                                  |
| **Loading, a button action**                    | Spinner inside the button, button disabled; never a full-page spinner for a form submit.                                                                                                                                                                                                       |
| **Loading, long operations** (Phase 2 analysis) | Determinate or step-based progress with text ("جارٍ قراءة الروشتة…"); always cancellable or recoverable.                                                                                                                                                                                       |
| **Empty** (`EmptyState`)                        | Icon in a `primary-soft` round chip, a one-line title saying what is empty, one sentence saying why or what to do, **one primary action** (or none). Friendly, never blaming. Used for empty tables, "tools arrive soon" cards, no sessions, no results (with a "clear filters" action).       |
| **Error, recoverable** (inline or card)         | `TriangleAlert` icon in `danger`, friendly Arabic message from `ERROR_INFO` (never provider names, SQL or stack), **the `WSF-XXXX-XXXX` reference** in a `danger-soft` chip whenever the API supplied one, a retry button, and a "تواصل مع الدعم" link. Pattern: `apps/web/src/app/error.tsx`. |
| **Error, page-level**                           | `error.tsx` / `not-found.tsx` / `global-error.tsx` (built): centred `Card elevation="raised"` over the backdrop, `role="alert"`.                                                                                                                                                               |
| **Forbidden (403)**                             | Not an error page: a calm "ليست لديك صلاحية" state with a link home. The nav already hides what the user cannot do.                                                                                                                                                                            |
| **Offline / upstream down**                     | Banner with retry; keep the user's data.                                                                                                                                                                                                                                                       |
| **Success**                                     | `Toast` for small actions; a full confirmation state (icon, title, next step) for flows that end (registration, verification, payment).                                                                                                                                                        |
| **Pending/coming soon**                         | `Badge` "قريباً" + disabled control; never a dead link.                                                                                                                                                                                                                                        |

---

## 8. Accessibility checklist (per screen)

- [ ] Every control has a visible label or an `aria-label` from `t()`; icon-only buttons have an accessible name; decorative icons are `aria-hidden`.
- [ ] Keyboard: logical tab order, visible focus, no traps (except dialogs, which trap and return focus), `Esc` closes overlays.
- [ ] One `h1`, headings in order, landmarks (`header`, `nav`, `main#main`, `footer`), the skip link works.
- [ ] Contrast per §3.2; status never conveyed by colour alone.
- [ ] Touch targets ≥ 44 px, ≥ 8 px apart.
- [ ] Zoom to 200 % and text spacing changes do not break the layout; no horizontal page scroll at 360 px.
- [ ] Axe (Playwright) has no serious/critical violations at 360 px and 1440 px (Task 1.9 gate).
- [ ] Forms: errors announced (`role="alert"` / `aria-describedby`), focus moves to the first error or the summary.
- [ ] Reduced motion: nothing essential depends on animation.

---

## 9. Performance rules for design

- No layout shift: images via `next/image` with explicit sizes; fonts via `next/font` (done); skeletons keep their space.
- No webfont beyond the two families; icons come from `lucide-react` only (AGENT.md §3), imported individually.
- Backgrounds are CSS gradients, not images (`.page-backdrop`). The landing page targets Lighthouse mobile Performance ≥ 95, SEO 100, Best Practices 100, Accessibility ≥ 95 (Task 1.11).
- Motion budget: nothing animates on scroll except the scroll-motion catalog of §3.7 (landing only, reduced-motion-safe, `transform`/`opacity`/`stroke-dashoffset`, no JS listeners, `will-change` only on the sticky stage).
