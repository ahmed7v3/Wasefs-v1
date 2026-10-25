# CONTENT-PLATFORM.md — Blog, medical pages, media and the editorial workflow

> Phase 4. The system the owner, editors, medical reviewers and automation use to publish articles, guides, glossary entries and drug monographs, with SEO built in.
> Related: `docs/SEO-GEO.md` (what to publish and why), `docs/PUBLISHING-API.md` (machine access), `docs/BRAND-AND-HOMEPAGE.md` (visual identity, OG templates), `docs/phases/phase4.md` (tasks).
> Applies the golden rules of `docs/AGENT.md` §5: zod at every boundary, repository-only queries, admin-controlled settings, Arabic-first RTL, medical safety, audit on every admin write.

---

## 1. Goals and non-goals

**Goals:** an editor writes and publishes a well-structured, SEO-complete Arabic or English article from a phone in minutes; a medical reviewer approves exact revisions; automation creates hundreds of drafts safely; public pages are server-rendered, fast and fully indexable; nothing is lost (revisions), nothing is published by accident (states, previews, permissions).

**Non-goals (Phase 4):** comments on articles, user-generated content, newsletters beyond the existing lifecycle mail, multi-site, real-time co-editing (two editors on one article get a conflict warning instead, §4.5).

---

## 2. Content types

All public editorial content is one table family with a `type`; drug monographs have their own structured model because their sections are fixed and reviewed field by field.

| Type | URL | Body | Medical review | Notes |
|---|---|---|---|---|
| `article` | `/blog/<slug>` | Markdown | per category (default on) | news-like or evergreen posts |
| `guide` | `/guides/<slug>` | Markdown | on | pillar pages, longer, with TOC |
| `glossary` | `/glossary/<slug>` | Markdown (short) + `definition` field | on | prescription abbreviations and terms |
| `page` | `/about`, `/editorial-policy`, `/medical-review`, `/sources`, `/features/*`, `/for/*` | Markdown + optional page blocks | off (`/features` copy reviewed by the owner) | replaces hard-coded marketing copy where useful; legal pages stay as they are (Phase 3 drafts) |
| `monograph` | drug ingredient pages (SEO-GEO §6) | structured sections | **always** | `drug_monographs` table, same workflow and revisions |

---

## 3. Data model (summary; DATABASE.md gets the full columns in Task 4.3)

Migration numbering continues after `0020`. Every table has `created_at/updated_at`; every admin write is audited.

| Table | Purpose | Key columns / constraints |
|---|---|---|
| `content_items` | one row per piece of content per locale | `id`, `type`, `locale` (`ar`/`en`), `translation_group_id` (links AR↔EN for hreflang), `slug` (unique per `type,locale`), `status`, `title`, `excerpt`, `body_md`, `body_html` (sanitised, rendered at save), `toc` jsonb, `word_count`, `reading_minutes`, `category_id`, `primary_author_id`, `reviewer_id`, `reviewed_revision_id`, `reviewed_at`, `next_review_due`, `published_at`, `first_published_at`, `content_updated_at` (meaningful edits only), `scheduled_at`, `featured_media_id`, `seo` jsonb (title, description, canonical override, robots, focus keyword, secondary keywords, OG title/description/image override), `flags` jsonb (`autoLink`, `showToc`, `showRelated`, `sponsored`), `source` (`editor`/`api`), `api_key_id`, `external_id` (unique per `api_key_id`), `current_revision_id`, `lock_version` |
| `content_revisions` | append-only snapshots | `id`, `item_id`, `number`, the full editable payload, `created_by` (user or api key), `note`, `diff_stats`; never updated or deleted (retention: all) |
| `content_categories` | tree (max depth 2) | `slug` per locale, names AR/EN, description (category page intro), `requires_medical_review`, `default_reviewer_id`, `seo` jsonb, `sort` |
| `content_tags` + `content_item_tags` | flat tags | tag pages indexable only with ≥ 5 posts + intro |
| `content_people` | authors and reviewers (public profiles) | `slug`, names AR/EN, `role` (`author`/`reviewer`/`both`), `credentials` (e.g. «صيدلانية، بكالوريوس صيدلة جامعة القاهرة»), `licence_number` (optional, shown only if `show_licence`), `bio_md`, `photo_media_id`, `same_as` (URLs), `user_id` (nullable link to an account), `active` |
| `content_links` | extracted links per item (internal and external) | used by link health, related content and orphan detection |
| `content_entities` | drug / ingredient / glossary mentions found in the body | drives auto-linking and related content |
| `content_corrections` | public corrections log | `item_id`, `summary`, `created_at` |
| `slug_redirects` | 301 map | `from_path` unique, `to_path`, `reason`; chains collapsed on write |
| `media_assets` | public media library | `id`, `kind` (`image`), `storage_key`, `original_filename`, `seo_filename`, `mime`, `width`, `height`, `bytes`, `sha256` (dedupe), `alt_ar`, `alt_en`, `caption`, `credit`, `licence` (`own`/`licensed`/`cc-by`/`public-domain`/`ai-generated`), `licence_ref`, `focal_point`, `variants` jsonb, `status` (`processing`/`ready`/`failed`), `uploaded_by` / `api_key_id` |
| `content_publish_log` | every status change | `item_id`, `from`, `to`, `actor`, `reason`, `at` |

`drug_monographs`, `monograph_sources`, `drug_seo`, `therapeutic_classes` are defined in SEO-GEO §6.1 and share `content_revisions`-style history (`monograph_revisions`).

---

## 4. Workflow

### 4.1 States
```
draft ──submit──► in_review ──approve──► approved ──publish / schedule──► scheduled ──(time)──► published
  ▲                  │ request changes                                                       │
  └──────────────────┘                                                   unpublish ◄──────────┤
published ──edit──► (published stays live; the edit is a new draft revision until republished)│
any ──archive──► archived (410 Gone for published URLs, or 301 to a chosen replacement)        │
```
- **Categories without medical review** skip `in_review`/`approved`: `draft → scheduled/published`.
- **Approval binds to a revision.** Publishing serves exactly `reviewed_revision_id`. Any later edit to a reviewed field (body, title, excerpt, medical sections) makes the live page keep the approved revision and puts the edit into review again. Non-medical fields (tags, OG image, internal links added by auto-link) do not require re-review.
- **Editing a published item never takes it offline**: the public keeps seeing the last published revision until the new one is published.
- **Unpublish** returns 404 immediately (cache tags invalidated) and keeps the content as a draft; **archive** returns 410 or a 301 to a replacement.

### 4.2 Roles and permissions (new keys in the Phase 1 RBAC catalog)
| Permission | Allows |
|---|---|
| `content.read` | admin lists and previews |
| `content.write` | create/edit drafts, upload media, manage own drafts |
| `content.publish` | schedule, publish, unpublish non-medical content; publish approved medical content |
| `content.review` | approve / request changes on medical content (must have a `content_people` reviewer profile) |
| `content.manage` | categories, tags, people, redirects, settings, delete drafts, archive |
| `content.api_keys` | create/rotate/revoke publishing API keys (fresh auth, 2FA, Phase 1 re-auth) |
| `seo.read` / `seo.write` | SEO dashboard, keyword map, SEO settings |

A user cannot approve a revision they authored (four-eyes for medical content). The owner role gets everything.

### 4.3 Scheduling
- `scheduled_at` in the admin's local time zone (stored UTC, shown in Africa/Cairo by default from `locale` settings).
- The worker publishes due items every minute (`content:publish-due`, idempotent, row lock). Missed schedules (worker down) publish on the next run and log the delay.
- On publish/unpublish/update: revalidate cache tags, regenerate affected sitemap chunks, enqueue IndexNow, recompute related content for neighbours, send `content.published` webhook (PUBLISHING-API §9).
- **Publishing rate guard:** `content.maxPublishesPerDay` (default 25) across all sources. Items beyond the cap stay `scheduled` and roll into the next day in order. Protects against accidental mass publishing and Google's scaled-content patterns.

### 4.4 Previews
- Every draft and revision has a preview URL `/preview/<token>` rendering the **real public template** with a "Preview, not published" bar. Tokens are signed, expire after 24 h (setting), `noindex`, never cached, never in sitemaps.
- Previews show mobile and desktop widths side by side on desktop admin; on mobile the preview opens full-screen.
- Social preview card (Facebook/WhatsApp/X look-alikes) and Google result snippet preview (title/description truncation in Arabic) in the SEO panel.

### 4.5 Revisions and conflicts
- Autosave every 10 s while typing (draft only, local + server), a revision on each explicit Save, Submit, Approve and Publish. Autosaves collapse into the next explicit revision.
- Revision history panel: list (author, time, note), side-by-side diff (word-level, RTL-aware), **restore** creates a new revision (never rewrites history).
- Optimistic locking with `lock_version`: saving over someone else's newer revision shows "تم تعديل المقال بواسطة … منذ دقيقتين" with options to view the diff, overwrite (creates a revision) or copy your text.

---

## 5. Media library and image pipeline

### 5.1 Storage
- A **separate public bucket** (`R2_PUBLIC_MEDIA_*`, served at a media origin such as `media.wasfa.online` through Cloudflare's cache) holds published media. It is never the private uploads bucket (prescription images live there and must stay private; ARCHITECTURE decision log).
- Keys are content-addressed: `m/<sha256-prefix>/<seo-filename>-<width>.<ext>`; immutable, `Cache-Control: public, max-age=31536000, immutable`.
- CSP `img-src` gains the media origin from configuration (not hard-coded).

### 5.2 Upload paths
1. Admin upload (drag-drop, camera on mobile, paste from clipboard) → presigned PUT to a **staging** prefix → worker job validates and processes → `ready`.
2. API upload: multipart (≤ 10 MB) or `source_url` fetch (PUBLISHING-API §6), same pipeline.
3. Dedupe by `sha256` of the original: re-uploading the same image reuses the asset.

### 5.3 Processing (worker, `media:process`; reuses the Phase 2 image pipeline guards)
- Magic-byte check (JPEG, PNG, WebP, AVIF, GIF static; SVG **not accepted** for content images, XSS risk); decompression-bomb guard (max 40 megapixels); EXIF/XMP/GPS stripped; colour profile converted to sRGB; orientation applied.
- Variants: widths 320, 480, 640, 960, 1280, 1600 (never upscaled) in **AVIF** (quality 50) and **WebP** (quality 72), plus a JPEG at 1200 px for crawlers and social cards; a 16-px blurred placeholder (base64, ≤ 600 bytes) for `placeholder="blur"`.
- Crops for structured data and social: 16:9 (1200×675 minimum), 4:3, 1:1, and OG 1200×630, using the editor-set **focal point**.
- Budgets: a 1600 px AVIF article image ≤ 180 KB; the OG card ≤ 300 KB. Failures above budget lower quality one step and retry, then mark a warning in the library.

### 5.4 Delivery
- A `<ContentImage>` server component renders `<picture>` with AVIF/WebP `srcset`, exact `sizes` from the layout, explicit `width`/`height` (no CLS), `loading="lazy"` and `decoding="async"` for all but the first image in the article (that one gets `fetchpriority="high"` when it is the LCP candidate).
- No `next/image` optimisation server for these (variants are pre-built, so the web container does no image work and the CDN serves everything).

### 5.5 Metadata rules (enforced on publish)
- Alt text required for every non-decorative image in the published locale; the library prompts for it on upload and the API requires it (`alt` field).
- SEO filename generated from the alt/title (transliterated) and editable.
- Licence required: `ai-generated` images are allowed for illustrations only (never as a photo of a real medicine, person or place) and are labelled in the caption credit.
- Medication photos only with `own` or `licensed` licence and a `licence_ref`.

### 5.6 Open Graph and social cards
- Per item: explicit OG image (any library asset, cropped 1200×630) **or** an auto-generated branded card.
- **Generated cards** (worker `og:render`): a fixed set of templates (article, guide, glossary, drug ingredient, drug brand, author, category), rendered from SVG templates with the bundled IBM Plex Sans Arabic font through sharp/libvips (Pango text shaping handles Arabic joining and RTL). Task 4.2 starts with a spike proving correct Arabic shaping; if it fails, the fallback is the existing Playwright renderer moved to a small on-demand job (never in the web container).
- Cards are cached by a hash of (template version, title, subtitle, image) so re-renders happen only on change.
- Twitter/X: `summary_large_image` with the same 1200×630 (2:1-safe composition: key text inside the central 1100×550 area).
- Defaults per section live in `content` settings; page-level overrides win.

---

## 6. Medical review and quality gates

### 6.1 Medical review
- Reviewer inbox: items `in_review` sorted by age, filter by category, with the diff since the last approved revision, sources list, and checks (§6.2) shown inline.
- Actions: **Approve** (fresh auth not required; audited), **Request changes** (comment required, item back to `draft`), **Approve with minor edits** (reviewer edits then approves; the edit is attributed to the reviewer and still recorded as a revision).
- Review comments are internal (never public).
- Monographs use the same inbox with section-by-section approval.

### 6.2 Quality gates (computed on every save, blocking only on publish)
| Gate | Blocks publish? | Rule |
|---|---|---|
| Required fields | yes | title, excerpt, slug, category, author, featured image with alt (articles/guides), meta description |
| Medical review | yes (medical categories) | approved revision equals the one being published |
| Minimum substance | yes | articles ≥ 600 words, guides ≥ 1,200, glossary ≥ 80 (settings) |
| Duplicate content | yes above threshold | 5-word shingle Jaccard similarity vs all published items in the same locale; ≥ 0.6 blocks, 0.4–0.6 warns with the matching URL (settings) |
| Title / description uniqueness | yes | exact or near-exact (trigram ≥ 0.9) duplicate of another published item |
| Keyword ownership | warn | focus keyword owned by another URL (SEO-GEO §4.4) |
| Headings | warn | single H1 (the title; body starts at H2), no skipped levels |
| Links | warn | ≥ 2 internal links (articles), 0 broken links, external medical claims have a source link |
| Images | yes for alt, warn for size | alt present; image dimensions ≥ 1200 px for the featured image |
| Forbidden claims | yes | configurable phrase list («يشفي نهائيًا», «بدون أي آثار جانبية», «بديل عن الطبيب», ...) |
| Personalised dosing | warn → reviewer | patterns like «خذ X مجم» addressed to the reader flagged for the reviewer |
| Readability | info | sentence length and paragraph length hints |

The same gates run for API submissions; the API returns them in `quality` (PUBLISHING-API §7).

---

## 7. Rendering and public pages

- Markdown dialect: CommonMark + GFM tables, task lists off, footnotes on (used for references), plus directives: `:::note`, `:::warning` (medical caution box), `:::tip`, `{{drug:<slug>}}` (link + inline facts tooltip rendered server-side as a link with `title`), `{{glossary:<slug>}}`, `![alt](media:<id> "caption")` (library image by id), `{{cta:analyze}}` (the single product block). Raw HTML in Markdown is **not** allowed; HTML pasted into the editor is converted to Markdown on paste.
- Pipeline at save time (API, not per request): parse (remark) → validate directives → resolve media and entity links → auto-link (SEO-GEO §7.2) → heading ids (stable, transliterated) → TOC → sanitise (allow-list of elements and attributes; external links get `rel="noopener"` and, unless allow-listed, `nofollow`) → `body_html`. The public page injects stored `body_html`; no Markdown or sanitiser code ships to the browser.
- Public templates (RSC, no client JS for content): article (breadcrumbs, title, excerpt, author+reviewer line, dates, reading time, cover, TOC on guides, body, sources/footnotes, corrections, CTA block, related, share links), category, tag, author, glossary hub (A–Z, both scripts) and entry, blog home (featured + latest + categories), guides hub.
- **Share buttons** are plain links (WhatsApp, Facebook, X, Telegram, copy link): no third-party scripts, no tracking pixels from social widgets.
- Article **ad slots** follow `docs/ADS.md` (never inside medical warnings, never more than the placement rules allow).
- RSS/Atom feeds per locale (SEO-GEO §5.4).

---

## 8. The editor (admin UX)

Design principles: one screen, no modal mazes, everything reachable with a thumb on a phone, nothing lost.

### 8.1 Layout
- **Desktop:** three zones. Left: the writing area (title, excerpt, body). Right: a collapsible side panel with tabs **Publish**, **SEO**, **Media**, **Review**, **History**. Top bar: status chip, autosave indicator («تم الحفظ قبل ثوانٍ»), Preview, primary action (Save draft / Submit for review / Publish / Update), overflow menu (schedule, unpublish, archive, duplicate, translate to EN).
- **Mobile:** the writing area full-width; the panel tabs become a bottom sheet opened from a sticky bottom bar (Publish · SEO · Media · Preview); the formatting toolbar sits **above the keyboard** (visualViewport-aware) and scrolls horizontally; 44 px touch targets; no hover-only actions.

### 8.2 Writing area
- Markdown source with a formatting toolbar (H2, H3, bold, italic, link, bullet list, numbered list, quote, table, image, note/warning box, drug link, glossary link, footnote/reference, CTA block). Keyboard shortcuts on desktop.
- **Live preview** toggle (mobile) or split view (desktop ≥ 1280 px) using the same server renderer through a debounced preview endpoint, so what you see is exactly what publishes.
- Paste from Google Docs/Word converts to clean Markdown (headings, lists, links, tables); images in pasted content are uploaded to the library automatically with an alt-text prompt.
- RTL editing correct: `dir="auto"` per paragraph so English drug names inside Arabic lines behave; the toolbar mirrors.
- Slash commands (`/` at line start) for the same actions as the toolbar.
- Word count, reading time, and a heading outline navigator.

### 8.3 SEO panel (live, as you type)
- Focus keyword (with suggestions from `seo_keywords` and an ownership check), secondary keywords.
- Title and meta description fields with live character counters and a Google-style snippet preview (Arabic truncation), uniqueness check.
- Slug editor (transliteration suggestion, uniqueness, change-after-publish warning: creates a 301 automatically).
- Checklist with scores: keyword in title / first 100 words / an H2 / slug / meta description; heading structure; internal links (with **suggested links** to insert); image alts; length; duplicate similarity; readability. Each item explains why it matters in one line. **No single "SEO score" number is shown as a target** (it encourages stuffing); items are pass / improve.
- Canonical override (admin only, for syndicated content), robots (index/noindex), OG/X overrides with preview.
- Structured data preview (the JSON-LD the page will emit, read-only).

### 8.4 Lists and search (admin)
- Content list with filters: type, status, locale, category, author, reviewer, source (editor/api/key name), date ranges, SEO issues, review overdue; full-text search on title/slug/body (Postgres `tsvector` with an Arabic-normalised `simple` config + trigram on titles).
- Bulk actions: assign category/tags, assign reviewer, schedule series (spread N items over days at times), unpublish, archive, export CSV.
- Saved views ("بانتظار المراجعة", "مجدولة هذا الأسبوع", "مقالات API اليوم").
- Calendar view of scheduled and published items.

### 8.5 Other admin screens
Categories (tree, drag to reorder), Tags (merge, rename with redirects), People (author/reviewer profiles with preview of the public profile), Media library (grid, filters, usage "used in 3 articles", replace file keeps id), Redirects (list, add, test, chain detection), Content settings, Medicines SEO (SEO-GEO §6.3 blockers per page, monograph queue), SEO dashboard (SEO-GEO §12), Publishing API keys and logs (PUBLISHING-API §3, §10).

Admin navigation gains two groups: **المحتوى** (Articles, Guides, Glossary, Pages, Medicines content, Media, Categories & tags, People, Redirects) and **البحث والظهور** (SEO dashboard, Keywords, SEO inbox, Search Console, Settings). Groups and items are permission-filtered like today (`apps/web/src/lib/admin-nav.ts`).

---

## 9. Settings (registry key `content`, admin-editable, defaults in code)
`maxPublishesPerDay`, `previewTokenHours`, minimum word counts per type, duplicate thresholds, forbidden phrase list, auto-link limits, default OG templates per type, default author, review intervals (general, high-risk classes), image budgets, external link allow-list (dofollow domains: regulators, WHO, journals), `autoTranslateDrafts` (off: an EN draft can be created by AI from an AR article, but it is a draft and is reviewed like any other).

---

## 10. Tests (minimum; phase4.md lists them per task)
- State machine: every transition allowed/forbidden per role; approval binds to revision; editing approved medical content re-enters review; scheduled publishing idempotent; daily cap rollover.
- Renderer: directive parsing, sanitiser allow-list (XSS corpus), auto-link limits, heading ids stable, TOC, `body_html` snapshot per fixture.
- Quality gates: each gate with passing/failing fixtures (Arabic and English), duplicate detection thresholds.
- Media: magic bytes, bomb guard, EXIF stripped, variants and budgets, dedupe, alt required on publish.
- Public pages: 200/301/404/410 matrix, canonical, hreflang pairs, JSON-LD snapshots, sitemap membership only for indexable items, preview pages `noindex` and uncached.
- E2E (Playwright, mobile and desktop projects): write → preview → submit → review → schedule → auto-publish → visible on public page with correct metadata; unpublish → 404; mobile editor toolbar above keyboard; revision restore; conflict warning.
- Accessibility: axe on editor and public templates; keyboard-only flow for publishing.

---

## 11. Implementation decisions (WP3, decided in the main session; builders do not change them)

The vocabulary lives in `packages/shared/src/content/constants.ts` and the HTTP contract in `packages/shared/src/schemas/content.ts`. Additive changes to the contract are allowed when a consumer needs a field; renames and removals are not.

### 11.1 Item vs revision (resolves §3 for the "published stays live" rule)
- `content_items` holds identity, metadata and three revision pointers: `current_revision_id` (latest edit), `reviewed_revision_id` (approved), `published_revision_id` (what the public sees; NULL = not live). Item-level metadata applies live at once and never needs review: slug, category, tags, author, reviewer, featured media, `seo`, `flags`.
- `content_revisions` is append-only and holds the REVIEWED payload (`title`, `excerpt`, `definition`, `body_md`) plus what the renderer derived from it (`body_html`, `toc`, `word_count`, `reading_minutes`, `minhash`, `quality`). A trigger forbids changing the source columns and deleting rows; derived columns may be re-rendered. `content_items.title` mirrors the current revision's title for lists and search.
- `status` is the state of the WORKING copy; `live = published_revision_id IS NOT NULL`. Any new revision moves an `in_review`/`approved`/`scheduled`/`published` item back to `draft` and clears `scheduled_at`; `published_revision_id` is untouched, so the public keeps the last published revision. `status = 'published'` means the working copy equals the live one.
- Autosave is NOT a revision: one mutable row per (item, user) in `content_autosaves`, deleted by the next explicit save.
- Public pages read `items ⨝ published revision`. Unpublish: `published_revision_id = NULL`, status `draft`. Archive: status `archived`, pointer NULL, `archived_redirect_to` (301) else 410 if the item was ever published (`first_published_at` set), else 404. Slug change on a live item writes a `slug_redirects` row (chains collapsed) in the same transaction.

### 11.2 Workflow rules (pure state machine in `packages/shared/src/content/workflow.ts`)
- Review is required when the category `requires_medical_review`, or the type is `guide` or `glossary`; `page` never; an item without a category follows its type (article: required). Items that do not require review go `draft → publish|schedule` directly; `submit` is refused for them.
- `submit` (content.write): draft → in_review, records `submitted_revision_id` and `submitted_by`. `approve` (content.review): in_review → approved; the actor must own an active `content_people` reviewer profile (`user_id`) and must differ from `submitted_by` and from the author of the submitted revision (four-eyes). `approve` with `edits` creates a reviewer-authored revision first and approves THAT revision. `request_changes` requires a comment, in_review → draft.
- `schedule`/`publish` (content.publish): from `approved` (or `draft` when review is not required); all `block` gates must pass; for reviewed items `reviewed_revision_id` must equal `current_revision_id`. `schedule.at` must be in the future. `unschedule`: scheduled → `approved` (review required) or `draft`. `unpublish`: published(or draft-with-live) → draft, pointer NULL. `archive`/`unarchive` need content.manage.
- Daily cap: `content.maxPublishesPerDay` counts `content_publish_log` rows with `to_status = 'published'` since local midnight (settings time zone, default Africa/Cairo); overflow stays `scheduled` and publishes the next day in `scheduled_at` order.
- Quality gates (§6.2) are pure (`content/quality.ts`); database-wide facts (similarity, duplicate title/description, broken internal links, keyword owner) are gathered by the API and passed in. `keyword_ownership` is a no-op `ok` until `seo_keywords` exists (WP5).

### 11.3 Renderer (`@wasfa/shared/content/render`, imported by the API only)
unified + remark-parse + remark-gfm (tables, footnotes; task lists off) + remark-directive (`:::note|warning|tip`) + a micro-syntax plugin for `{{drug:slug}}`, `{{glossary:slug}}`, `{{cta:analyze}}`, `{{nolink:term}}` + `![alt](media:<id> "caption")` + remark-rehype WITHOUT raw HTML + rehype-sanitize with a custom allow-list (no clobber prefix: heading ids and TOC anchors must match) + rehype-stringify. Raw HTML in Markdown is dropped. External images are refused; only `media:<id>` images render (as `<figure><picture>` with AVIF/WebP `srcset` from the variants and the media origin). Link policy: only `http(s)`, site-relative `/…` and `#…`; external links get `rel="noopener noreferrer nofollow"` unless the host (or a parent domain) is in `dofollowDomains`; Unicode bidi control characters are stripped. `#` in a body renders as `h2` with warning `h1_in_body`. Resolvers (media, drug, glossary, auto-link targets) are injected, so the renderer is pure and unit-testable.

### 11.4 API surface (all inputs through the zod schemas of `schemas/content.ts`)
Admin, under `/admin/content`: `GET|POST items`, `GET|PATCH items/:id`, `PUT items/:id/autosave`, `POST render-preview`, `POST items/:id/actions/:action`, `POST items/:id/preview-token`, `GET items/:id/revisions[/:revisionId]`, `POST items/:id/revisions/:revisionId/restore`, `POST items/:id/corrections`, `POST bulk`, `GET review-inbox`, `GET link-suggestions`, `GET options` (compact categories/tags/people for pickers), CRUD `categories` (+ `reorder`), `tags` (+ `merge`), `people`, `redirects` (+ `test`). Permissions: reads `content.read`; create/edit/submit/autosave/restore/preview `content.write`; approve/request-changes/review inbox `content.review`; schedule/publish/unschedule/unpublish/corrections `content.publish`; archive/unarchive/bulk/taxonomy/people/redirects `content.manage`. Every write is audited (`@Audited` or `AuditService.record`); archive, unpublish and bulk use `@RequireFreshAuth(10)`.
Public, under `/public/content` (`@Public`, `@RateLimit`, `Cache-Control: public, max-age=30, stale-while-revalidate=300`): `resolve`, `list`, `taxonomy-page`, `taxonomy-list`, `glossary-index`, `path-state`, `sitemap`, and `preview/:token` (`no-store`, `X-Robots-Tag: noindex`). Preview tokens are stateless HMAC tokens (`itemId`, optional `revisionId`, `exp`), lifetime `content.previewTokenHours`.

### 11.5 Web cache and status codes
- The web app reads public content with `fetch(..., { next: { tags, revalidate: 3600 } })` using `CONTENT_CACHE_TAGS`. Publishing changes call `POST {WEB_INTERNAL_URL}/api/revalidate` signed with HMAC-SHA256 over `"<timestamp>.<body>"` (header `x-revalidate-signature: sha256=<hex>`), 300 s window, in-memory replay cache, tags validated by `revalidateRequestSchema`. The sign/verify helpers live in `packages/shared/src/content/revalidate.ts` and are used by the API, the worker and the web route. Env: `WEB_INTERNAL_URL` (api, worker) and `REVALIDATE_SECRET` (api, worker, web; ≥ 32 chars; unset in dev = revalidation skipped and the web route answers 404). Revalidation is best effort and never fails a publish (an outbox job retries it).
- App Router pages cannot answer 410 or 301-by-data, so the web `proxy.ts` answers them for content prefixes only (`/blog`, `/guides`, `/glossary`, `/authors`, `/en/…` twins) from `GET /public/content/path-state`, cached in-process for 60 s: redirect map → 301, gone list → 410 (small HTML body, `noindex`). Everything else uses `notFound()`.
- Content fan-out after a state change is one outbox topic, `content.changed` `{ itemId, kind, paths, oldPaths }`, drained by the worker: revalidate tags, enqueue IndexNow for the public paths. `content.publish-due` runs every minute on a new `content` queue. Related content is computed at read time in the API (shared entities, category, tags, recency) and cached by the web data cache; there is no related job.

### 11.6 Default role grants (data migration for existing databases + seed for new ones)
`admin`: all five `content.*` keys. `marketing`: `content.read`, `content.write`, `content.publish`. `super_admin` is a wildcard. Reviewers are ordinary roles that the owner grants `content.review` to; the permission alone is not enough, the account must also be linked to an active reviewer profile.

### 11.7 The owner (`super_admin`) decides (added 2026-10-25, owner's decision)
The platform owner needs no reviewer profile and no second reviewer: `WorkflowActor.isOwner` (set from `isSuperAdmin`) lets them approve and request changes without a profile or four-eyes, and publish or schedule from any working state (draft, in review, approved). Quality gates and the daily publish cap advise instead of blocking for the owner; the editor shows failing gates as advice and still offers the button. Scheduling or publishing a revision nobody reviewed approves it (the approval pointer moves to that revision, so the scheduler's re-check passes). Every overridden gate id (and `daily_cap`) is written to the audit row as `after.ownerOverride`. Everyone else is unchanged: gates block, review is required, four-eyes applies. Permission, schedule-in-the-past and archived-item rules still apply to the owner.

### 11.8 Permanent delete (owner only, added 2026-10-25, owner's decision)
`DELETE /admin/content/items/:id` with `{ confirmTitle }` (the exact current title) lets the super admin remove an item for good: `purgeItemTx` (packages/db/src/content-purge.ts) sets the transaction-local `wasfa.content_purge = 'on'` (migration 0024 lets the revision guard accept DELETE only under that flag), nulls the item's revision pointers, deletes its revisions and the item (autosaves, tags, links, entities, media refs, corrections, publish log and review comments go by ON DELETE CASCADE) and the slug redirects from or to its path. Media assets are never deleted. A once-live item emits `content.changed` `{ itemId: null, kind: "unpublished", oldPaths: [path] }` so caches are purged; the path then answers 404. The audit row `content.item.purged` keeps type, locale, slug and wasLive, never the text.
