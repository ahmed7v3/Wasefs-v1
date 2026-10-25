# SEO-GEO.md — Organic search, AI discoverability and medical credibility

> Phase 4 strategy and rulebook. It decides **which pages exist, which queries each page owns, how pages are built, crawled, indexed and measured, and what makes them trustworthy enough to rank and be cited** for a health topic (Google's "Your Money or Your Life" class).
> Companion files: `docs/seo/keyword-map.csv` (the seed keyword universe and URL ownership), `docs/CONTENT-PLATFORM.md` (blog, editor, media), `docs/PUBLISHING-API.md` (automation), `docs/phases/phase4.md` (execution).
> Nothing here promises a ranking, an AI Overview appearance or an AI citation. Every tactic is either a documented search-engine requirement or a measurable bet with a metric attached.

---

## 1. Principles (the order wins when two collide)

1. **Medical accuracy and user trust first.** A page that could mislead a patient is not published, however much traffic it would bring. Medical pages are reviewed by a named, qualified person before they can be indexed (§9).
2. **One page owns one intent.** Every target query cluster maps to exactly one URL (`keyword-map.csv`). New content that would compete with an owner is merged into it or targets a different intent (§4.4).
3. **Index only what is genuinely useful.** Thin or unreviewed pages stay `noindex` until they meet the quality bar. Thousands of thin programmatic pages are a site-wide risk (Google's *scaled content abuse* policy), not an asset.
4. **Server-rendered, fast, stable.** Every indexable page is complete in the first HTML response, passes Core Web Vitals at p75 on mobile, and needs no client JavaScript to show its content.
5. **Arabic first, English where we can win.** Arabic medical content is thin on the web; that is our moat. English targets the product (AI prescription reading) and a curated set of articles, not a head-on fight with Drugs.com or WebMD for generic drug queries.
6. **Measure everything that can be measured honestly** (§12), and say plainly what cannot be (most AI-assistant visibility).

---

## 2. Site architecture and URL map

Arabic is the default locale with **no prefix**; English lives under `/en`. A page has an English URL only when an English version exists (no machine-translated stubs). Slugs are lower-case ASCII for drugs and ingredients (stable, shareable, no percent-encoding); article slugs are ASCII transliterations or short English keywords chosen by the editor (Arabic slugs percent-encode into unreadable links in most share surfaces).

| Section | Arabic URL | English URL | Owner of | Index rule |
|---|---|---|---|---|
| Home | `/` | `/en` | brand + "AI prescription reader" head terms | always |
| Product / feature pages | `/features/prescription-reader`, `/features/handwritten-prescriptions`, `/features/medicine-explainer`, `/features/ai-assistant` | `/en/features/...` | each feature's head + mid-tail cluster | always (feature must be live; a "soon" feature gets no page) |
| Audience pages | `/for/patients`, `/for/pharmacists`, `/for/doctors`, `/for/clinics` | `/en/for/...` | role-specific product intent | always |
| Pricing | `/pricing` | `/en/pricing` | price / plans / "free" intent | always |
| Medicines hub | `/drugs` | `/en/drugs` | "drug search", "دليل الأدوية" | always |
| Active ingredient page | `/drugs/ingredients/<slug>` | `/en/drugs/ingredients/<slug>` | the ingredient's clinical intents (uses, side effects, precautions, pregnancy, interactions overview) | only with an **approved monograph** (§6) |
| Brand (product) page | `/drugs/<slug>` | `/en/drugs/<slug>` | brand-name navigational and "what is X / X active ingredient / X alternatives" intents | only when its ingredient monograph is approved **and** the brand has unique facts (§6.3) |
| Therapeutic class pages | `/drugs/classes/<slug>` | `/en/drugs/classes/<slug>` | class intents ("مضادات حيوية", "antihistamines") | when ≥ 3 indexable members + reviewed intro |
| Drug search results | `/drugs/search?q=` | `/en/drugs/search?q=` | nothing | **never** (`noindex, follow`) |
| Blog home, category, tag | `/blog`, `/blog/c/<slug>`, `/blog/t/<slug>` | `/en/blog/...` | category intents | category: always; tag: only with ≥ 5 published posts + an intro |
| Article | `/blog/<slug>` | `/en/blog/<slug>` | one informational cluster each | published + quality gates passed (CONTENT-PLATFORM §7) |
| Author / reviewer profile | `/authors/<slug>` | `/en/authors/<slug>` | the person (E-E-A-T) | when the profile is complete |
| Guides (pillar pages) | `/guides/<slug>` | `/en/guides/<slug>` | broad educational topics ("كيف تقرأ الروشتة") | always (they are articles with `type = guide`) |
| Glossary | `/glossary/<slug>` | `/en/glossary/<slug>` | prescription abbreviations and terms ("معنى BID في الروشتة") | when the entry has an approved definition |
| Trust pages | `/about`, `/editorial-policy`, `/medical-review`, `/sources`, `/contact`, legal pages | `/en/...` | trust (not traffic) | always |
| App pages (`/dashboard`, `/analyze`, `/ai`, `/billing`, `/account`, `/admin`, `/checkout`, `/rewards`, `/org`) | | | nothing | `noindex, nofollow` header + robots disallow |

**Not built, by decision:** city/country doorway pages ("قراءة روشتة في القاهرة", "... في الرياض"). The product is identical everywhere, so such pages would be near-duplicates that Google's doorway-page policy targets. Regional language differences (روشتة in Egypt, وصفة طبية in the Gulf and Levant) are handled **inside** pages: synonyms in copy, headings and FAQs (§4.3). A regional page is allowed only when its content genuinely differs (e.g. a future "drug availability in Saudi Arabia" dataset).

**Breadcrumbs:** every page below the top level renders visible breadcrumbs and `BreadcrumbList` JSON-LD from the same data (Home › Medicines › Antibiotics › Amoxicillin).

**Depth rule:** every indexable page is reachable in ≤ 3 clicks from the home page through HTML links (hub → class → ingredient → brand; blog → category → article). Orphan detection runs in the SEO health job (§12.3).

---

## 3. Search intent model

Every query cluster is tagged with one intent and one funnel stage. The intent decides the page type, not the other way round.

| Intent | Example (AR / EN) | Page type that serves it | Conversion path |
|---|---|---|---|
| **Transactional / tool** | «برنامج قراءة الروشتة», "AI prescription reader" | feature page, home | sign up → first analysis |
| **Navigational (brand)** | «وصفة AI», "wasfa ai", "wasefa ai" | home, pricing, login | direct |
| **Problem-aware** | «مش فاهم خط الدكتور», "can't read doctor's handwriting" | feature page + supporting article | soft CTA to try a sample |
| **Informational (drug)** | «أموكسيسيلين دواعي الاستعمال», "amoxicillin side effects" | ingredient / brand page | "Scan your prescription to check all your medicines" |
| **Informational (how-to / education)** | «كيف أقرأ الروشتة», "what does BID mean on a prescription" | guide, glossary, article | in-content CTA |
| **Comparison / alternatives** | «بديل أوجمنتين», "augmentin vs amoxicillin" | brand page (alternatives block), comparison article | none forced |
| **Safety question** | «هل الباراسيتامول آمن للحامل» | ingredient page section + article | none forced; safety info is never gated |
| **Professional** | «برنامج للصيدليات لقراءة الروشتات» | `/for/pharmacists`, `/for/clinics` | org plan / contact sales |

---

## 4. Keyword strategy

### 4.1 Universe and how it reaches "thousands"

The keyword universe has three layers. Volumes in this document are **not** quoted because none were measured; the first job of Task 4.1 (phase4.md) is to pull real data (Google Keyword Planner, Google Search Console once pages exist, and one paid tool such as Ahrefs/Semrush for Arabic SERP difficulty) into the `seo_keywords` table and re-rank priorities.

| Layer | Source | Size | Owner pages |
|---|---|---|---|
| **A. Core product & brand** | hand-researched seed list (`keyword-map.csv`, ≈ 230 rows incl. 30 programmatic templates) incl. dialect, spelling and transliteration variants | hundreds | home, feature, audience, pricing pages |
| **B. Education & questions** | seed questions + "People also ask", Search Console queries, AI-answer prompts, pharmacist interviews | hundreds → low thousands | guides, glossary, articles |
| **C. Programmatic medicines** | drug DB × facet templates (§4.2) | thousands to tens of thousands of long-tail queries | ingredient, brand and class pages |

Layer C is where "thousands of keywords" comes from honestly: each approved ingredient page legitimately answers ≈ 10–15 distinct sub-questions (uses, side effects, precautions, pregnancy, breastfeeding, children, alcohol, food, missed dose, storage, overdose warning, interactions overview, brand names) in two languages, and each brand page answers brand-level questions. With *N* approved ingredients and *B* indexable brands the long-tail coverage is roughly `N × 12 × 2 + B × 6`. For example, 400 approved ingredients and 2,500 indexable brands target ≈ 9,600 + 15,000 ≈ 25,000 query variants. That is without a single doorway page, because each variant is answered by a **section** of one strong page, not by its own thin page.

### 4.2 Facet templates (programmatic layer)

| Facet | Arabic patterns | English patterns | Served by section |
|---|---|---|---|
| Uses | `{x} دواعي الاستعمال`، `{x} لماذا يستخدم`، `{x} يعالج ايه`، `استخدامات {x}` | `{x} uses`, `what is {x} used for` | ingredient: «يُستخدم في» |
| Side effects | `{x} الآثار الجانبية`، `أضرار {x}`، `{x} اعراض جانبية` | `{x} side effects` | «الآثار الجانبية» |
| Precautions / contraindications | `موانع استعمال {x}`، `{x} تحذيرات` | `{x} contraindications`, `{x} warnings` | «احتياطات وموانع» |
| Pregnancy / breastfeeding | `{x} للحامل`، `{x} للمرضع`، `{x} والرضاعة` | `{x} pregnancy`, `{x} breastfeeding` | «الحمل والرضاعة» |
| Children | `{x} للأطفال` | `{x} for children` | «الأطفال» (general label info only, no dose calculator) |
| How to take | `طريقة استخدام {x}`، `{x} قبل الأكل ولا بعده` | `how to take {x}`, `{x} with food` | «طريقة الاستخدام» |
| Missed dose / storage | `نسيت جرعة {x}`، `حفظ {x}` | `missed dose {x}`, `how to store {x}` | «إذا نسيت جرعة» / «الحفظ» |
| Alcohol / food | `{x} والكحول`، `{x} مع القهوة` | `{x} and alcohol` | «الطعام والشراب» |
| Interactions overview | `تداخلات {x}`، `{x} مع أدوية أخرى` | `{x} interactions` | «التداخلات المهمة» (class-level, sourced; pair pages are out of scope §14) |
| Active ingredient (brand) | `{brand} المادة الفعالة`، `الاسم العلمي ل{brand}` | `{brand} generic name`, `{brand} active ingredient` | brand: header facts |
| Alternatives (brand) | `بديل {brand}`، `{brand} البديل` | `{brand} alternatives`, `{brand} equivalent` | brand: «أدوية بنفس المادة الفعالة» (factual list from the DB, no recommendation) |
| Forms / strengths (brand) | `{brand} شراب`، `{brand} 1 جم` | `{brand} 500mg` | brand: forms and strengths table |

`{x}` is expanded with the ingredient's Arabic name, its common Arabic spellings (`باراسيتامول`، `براسيتامول`، `بارسيتامول`), the English INN and the best-known brands. Variants live in `drug_aliases` already (Phase 2) and in a new `seo_synonyms` list per ingredient; they are used in body copy, FAQ questions and `alternateName` naturally, never as hidden or repeated text.

**Not targeted on purpose:** `سعر {x}` / "{x} price" (we hold no reliable, current local prices; a wrong price misleads), pill-imprint identification ("pill identifier": we do not identify loose pills from photos), dosage calculators, and any query whose honest answer is "ask your doctor" in a way a page cannot add value to.

### 4.3 Dialect, spelling and script variants

Arabic search behaviour differs by country and keyboard. Every core cluster carries its variants:
- **Term:** روشتة (Egypt) / وصفة طبية (Gulf, Levant, formal) / وصفه / الروشته.
- **Hamza and taa marbuta loss:** «الاثار الجانبيه», «اضرار» (users skip diacritics and hamzas; Google partially normalises, copy should still use the correct form and keep common user spellings in FAQs).
- **Egyptian colloquial questions:** «الدوا ده بيعمل ايه»، «اقرا الروشته ازاي». Used verbatim as FAQ questions on relevant pages where natural.
- **Franco-Arabic / Arabizi:** «roshta», «rosheta», «wasfa» in Latin letters; brand variants «wasefa», «wasfah», «wasfa ai», «وصفة اي اي», «وصفه ai».
- **English inside Arabic queries:** «تطبيق AI لقراءة الروشتة», «Panadol للحامل». Pages include both scripts for drug names.

### 4.4 Ownership and anti-cannibalisation

- `seo_keywords` (cluster, primary keyword, variants, intent, language, priority, **owner URL**). The admin "Keywords" screen and the article editor read it.
- **One owner per cluster per language.** The article editor's SEO panel warns when the focus keyword belongs to another URL and offers: link to the owner instead, pick a different angle, or (admin only) transfer ownership with a 301 plan.
- **Drug pages vs blog:** ingredient/brand pages own the facet clusters of §4.2. Articles about a medicine must take a **different intent** (a story, a comparison, a condition guide) and link to the drug page with the drug's name as anchor.
- **Brand vs ingredient:** the ingredient page owns clinical facets; the brand page owns the brand's identity, forms, strengths and alternatives and links to the ingredient sections. The brand page shows a short summary of uses and the key warnings (users land there and need them), not a copy of the monograph.
- **Detection:** the nightly SEO job compares Search Console queries: when one query gets impressions on two or more of our URLs over 28 days with neither above 80 % share, it opens a "cannibalisation" item in the admin SEO inbox with both URLs and the query.

### 4.5 Priorities for the first 90 days after launch

1. Product pages (home, 4 feature pages, 4 audience pages) for layer A in Arabic and English.
2. Glossary of prescription abbreviations and Latin terms (≈ 80 entries: OD, BID, TID, QID, PRN, SOS, AC, PC, HS, STAT, ...), Arabic and English: high-intent, evergreen, directly related to the product and easy to keep accurate.
3. Ingredient monographs for the **top 200 ingredients** by frequency in our own (anonymised, aggregated) prescription analyses plus Egyptian/Saudi best-seller lists, reviewed in batches of 20.
4. 30 pillar guides ("how to read a prescription", "how to take antibiotics correctly", "questions to ask your pharmacist", "medicines in pregnancy: how to check", "chronic medication organisation"...) each linking to 5–20 drug pages.
5. Then scale articles through the Publishing API under the review workflow (CONTENT-PLATFORM §6).

---

## 5. Technical SEO

### 5.1 Rendering and caching
- All public pages are React Server Components with **no client JavaScript needed for content**. Interactive islands (search box, consent banner, share button) are small client components loaded after content.
- The site keeps the per-request **CSP nonce** (security baseline). Public content pages therefore render per request, but their data is cached: the web app reads published content from the API through Next's data cache with tags (`article:<id>`, `drug:<id>`, `sitemap:articles`), and publishing invalidates those tags through a signed revalidation call. Target: origin TTFB p75 ≤ 300 ms for a drug or article page under load (verified in the Task 4.1 spike; the fallback decision is recorded in phase4.md).
- Status codes are exact: 404 for unknown slugs (with a helpful search), **410** for deliberately removed content, 301 for renamed slugs (`slug_redirects` table, chains collapsed), never soft-404s. Unpublished articles return 404 to the public and to crawlers.

### 5.2 Indexation controls
- `robots` meta per page from one helper (`index|noindex`, `follow`, `max-image-preview:large`, `max-snippet:-1`). App and admin routes also get `X-Robots-Tag: noindex, nofollow` from the proxy.
- Non-production hosts are always `noindex` + `Disallow: /` (already in place; kept).
- Query-string variants (`?utm_*`, `?ref=`, `?sort=`) canonicalise to the clean URL; campaign parameters never create indexable URLs.
- Pagination: `/blog?page=2` is self-canonical and indexable; no `rel=prev/next` dependency.
- Faceted drug search is `noindex, follow`.

### 5.3 robots.txt (admin-managed policy, rendered by `app/robots.ts`)
```
User-agent: *
Allow: /
Disallow: /admin
Disallow: /api/
Disallow: /dashboard
Disallow: /analyze
Disallow: /ai
Disallow: /account
Disallow: /billing
Disallow: /checkout
Disallow: /rewards
Disallow: /org
Disallow: /capture
Disallow: /drugs/search
Sitemap: https://wasfa.online/sitemap.xml
```
AI crawler groups are generated from the `seo.aiCrawlers` setting (§10.4). **Cloudflare can override this file** ("Managed robots.txt" and "Block AI bots" / AI Crawl Control): the owner checklist in phase4.md includes aligning the Cloudflare zone with this policy, otherwise the published policy is fiction.

### 5.4 Sitemaps
- `/sitemap.xml` is a **sitemap index** pointing to: `sitemap-pages.xml`, `sitemap-articles-<n>.xml`, `sitemap-drugs-<locale>-<n>.xml`, `sitemap-ingredients-<locale>.xml`, `sitemap-classes.xml`, `sitemap-glossary.xml`, `sitemap-authors.xml`. Each file ≤ 50,000 URLs and ≤ 50 MB (protocol limits); we cap at 10,000 for fast regeneration.
- Only indexable URLs appear. `lastmod` is the **real content change time** (`content_updated_at`, not "now", not a cosmetic edit). Article entries include `<image:image>` for the featured image.
- Language alternates appear as `xhtml:link rel="alternate" hreflang` in the sitemap **and** in page `<head>` (both from the same helper).
- Sitemaps are generated from cached API queries and revalidated by tag on publish.
- **RSS/Atom:** `/blog/feed.xml` and `/en/blog/feed.xml` (last 50 articles, full summary, featured image). Feeds help discovery by aggregators and some AI tools.

### 5.5 Multilingual and RTL
- Separate **root layouts** per locale route group: Arabic `<html lang="ar" dir="rtl">`, English `<html lang="en" dir="ltr">`. Never a client-side language switch on the same URL.
- `hreflang`: `ar`, `en`, plus `x-default` → Arabic. Pairs only exist when both versions exist; each page lists itself (self-reference) and its counterpart, return links guaranteed by generating both from one `translation_group_id`.
- Regional hreflang (`ar-EG`, `ar-SA`) is **not** used: the content is the same; splitting it would create duplicates.
- Logical CSS properties only (AGENT §5.10); numbers, drug names and doses inside Arabic text are wrapped in `<bdi>`/`dir="ltr"` spans so "500 mg" never flips.
- Open Graph `og:locale` `ar_AR` / `en_US` with `og:locale:alternate`.

### 5.6 Performance (ranking signal and conversion lever)
Core Web Vitals targets at p75 on mobile (field data, CrUX / our RUM): **LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1** (target 0.05). Lab gates in CI: Lighthouse mobile performance ≥ 90 on home, pricing, a drug page, an article; JS per public route ≤ 100 KB compressed first load; no layout shift from ads, images or fonts (reserved boxes). Details and the live-site fixes are in phase4.md Task 4.1.

### 5.7 Verification and webmaster tools
- Google Search Console (Domain property via DNS) and Bing Webmaster Tools; verification tokens stored in `seo` settings and emitted as meta tags only on `/` (or DNS, preferred).
- **IndexNow** (Bing, Yandex, Seznam, Naver and others): on publish, update, unpublish and delete the worker posts the changed URLs (batched, ≤ 10,000 per call). The key file is served at `/<key>.txt` from settings. Google does not use IndexNow; Google discovery is through sitemaps and links.
- The Search Console API is integrated (§12.2). The deprecated Google "sitemap ping" is not used.

---

## 6. Programmatic medicine pages (the largest traffic lever, and the largest risk)

### 6.1 Data model additions (DATABASE.md is updated in Task 4.5)
- `drug_monographs` — one per **active ingredient** per locale: structured sections (uses, how to take, side effects common/serious, precautions, contraindications, pregnancy, breastfeeding, children, elderly, alcohol/food, missed dose, overdose warning, storage, interactions overview), each section with **source references**; plus `status` (`draft → in_review → approved → retired`), `reviewed_by` (content person), `reviewed_at`, `next_review_due`, `version`.
- `monograph_sources` — citation list: title, publisher, URL, accessed date, type (`regulator_label`, `smpc`, `guideline`, `peer_reviewed`, `reference_book`).
- `drug_seo` — per brand and per ingredient: slug, indexable flag (derived), synonyms, therapeutic class, short unique description, `content_updated_at`.
- `therapeutic_classes` — class tree with reviewed intros.

### 6.2 Where the clinical text comes from
1. **Primary sources only:** regulator-approved labels and leaflets (Egyptian Drug Authority, SFDA leaflets, EMA SmPC/PIL, US FDA labels via DailyMed (public domain)), WHO Model Formulary, national guidelines. Every claim on the page is traceable to a listed source.
2. **Drafting** can be assisted by the AI layer (`seo_monograph_draft` task route) **from the cited sources**, in plain Arabic at a reading level for patients; the draft is marked "AI-assisted draft" internally.
3. **Review is mandatory:** a pharmacist or physician reviewer approves each monograph (CONTENT-PLATFORM §6). Only approved monographs make pages indexable. The reviewer's name, credential and review date are shown on the page.
4. **Re-review:** `next_review_due` (default 12 months; 6 for high-risk classes such as anticoagulants, insulin, antiepileptics). Overdue monographs raise an admin alert; after a grace period the page drops to `noindex` until re-reviewed.
5. **Copyright:** we paraphrase and structure; we never copy leaflet or third-party monograph text verbatim beyond short quoted warnings with attribution.

### 6.3 Indexability rules (enforced in code, shown in admin)
A brand page is indexable only if: its active ingredient(s) have an approved monograph in that locale; the brand has a name in that locale and at least one of form/strength/manufacturer; it is `active` in the DB; and it is not a near-duplicate of another brand page (same ingredients + strengths + form + manufacturer → the duplicates point their canonical at the oldest one). Combination products need approved monographs for all ingredients. The admin "Medicines SEO" screen shows each blocker per page.

### 6.4 Page anatomy (ingredient page, Arabic)
1. H1: «أموكسيسيلين (Amoxicillin)» + one-sentence plain summary (≤ 160 chars, used as meta description).
2. Key facts card: class, prescription-only status, common forms, main uses (3 bullets), **the most important warning**. Visible above the fold; it is also the passage most likely to be quoted by AI answers.
3. Table of contents (anchor links, each section `id` stable).
4. Sections from the monograph, each starting with a direct answer sentence, then detail. Question-style H2/H3 where natural («هل يمكن تناول أموكسيسيلين أثناء الحمل؟»).
5. "Brands containing this ingredient" (links to brand pages, from the DB).
6. "Check your full prescription" product block (one, non-intrusive).
7. Sources list, "medically reviewed by … on …", "last updated", editorial-policy link, disclaimer (AGENT §5.11).
8. Related ingredients in the same class, related guides.

Brand pages: H1 brand + ingredient, facts table (ingredient(s), strengths, forms, manufacturer, country), summary of uses + key warning (from the monograph), link to full ingredient sections, alternatives list, sources, review line.

### 6.5 What programmatic pages must never do
- Generate clinical text at request time, or publish AI text without review.
- Show a dose recommendation for a specific person, or a calculator.
- Create a page per drug pair, per city or per misspelling.
- Hide text, stuff synonyms, or show crawlers content users do not see.

---

## 7. On-page SEO and internal linking

### 7.1 Per-page rules (validated by the editor's SEO panel and by tests for templates)
- One H1; logical H2/H3 hierarchy, no skipped levels; headings describe content, not "Section 1".
- **Title** ≤ 60 characters (Arabic counts the same), primary keyword near the start, brand at the end through the template (`%s | وصفة AI`). Unique across the site (checked).
- **Meta description** 120–160 characters, a real summary with the answer, unique (checked).
- First 100 words answer the main question directly.
- Images: descriptive Arabic alt text (not keyword lists), width/height set, `loading="lazy"` except the LCP image (`fetchpriority="high"`).
- Outbound links to primary sources (`rel="noopener"`; sponsored links `rel="sponsored"`; user-generated links `rel="ugc nofollow"`).
- Visible dates: published and updated (`<time datetime>`), the same values as in JSON-LD.

### 7.2 Internal linking engine
- **Automatic entity links:** when an article mentions an indexable drug or glossary term (matched against `drug_aliases` and glossary terms), the renderer links the **first** mention to its page (max 1 link per target per article, max 1 per 120 words overall, never inside headings). Editors can disable auto-linking per article or per mention.
- **Suggestions in the editor:** related articles and pages scored by shared entities, category and keyword cluster; one click inserts a link with the target's preferred anchor.
- **Hubs:** each category and therapeutic class page lists its members; pillar guides link to all their cluster articles and every cluster article links back to its pillar.
- **Related content blocks** at the end of articles and drug pages (same cluster first, then same category, then recency).
- **Health checks** (§12.3): orphans, broken internal links, redirect chains, pages with < 3 internal inlinks.

---

## 8. Structured data (JSON-LD, one builder library, unit-tested)

| Page | Types | Notes |
|---|---|---|
| All | `Organization` (logo PNG ≥ 112 px, `sameAs` social profiles, `contactPoint`), `WebSite` | already exist (`apps/web/src/lib/structured-data.ts`); extended, not rewritten |
| Home, feature pages | `SoftwareApplication` (`applicationCategory: HealthApplication`, offers from the catalog) | exists; feature pages add `featureList` |
| Pricing | `Product` + `Offer` per plan price | exists |
| Article | `Article` (or `BlogPosting`) with `author` → `Person` (with `url` to the author page), `datePublished`, `dateModified`, `image` (3 ratios), `publisher`, `inLanguage`; medical topics also `MedicalWebPage` with `reviewedBy`, `lastReviewed`, `about` | Google supports Article; `MedicalWebPage` adds meaning for other consumers |
| Ingredient / brand page | `MedicalWebPage` + `Drug` (`activeIngredient`, `nonProprietaryName`, `drugClass`, `prescriptionStatus`, `dosageForm`, `manufacturer`), `reviewedBy`, `citation` (sources) | no Google rich result exists for Drug; used for entity understanding |
| Author page | `ProfilePage` → `Person` (`jobTitle`, `hasCredential`, `sameAs`, `knowsAbout`) | |
| Glossary entry | `DefinedTerm` in a `DefinedTermSet` | |
| Breadcrumbs | `BreadcrumbList` | all non-top pages |
| FAQ blocks | `FAQPage` | allowed, but Google shows FAQ rich results only for well-known government and health sites; we keep it for meaning, not for a rich result |

Rules: JSON-LD only describes content visible on the page; it is serialised with the existing `serializeJsonLd` (script-safe) and nonce; every template has a snapshot test and a validation step against the schema.org vocabulary in CI; Google's Rich Results Test is run manually on one page per template before release.

---

## 9. E-E-A-T and medical credibility

Search engines cannot verify claims; they look for evidence that real, accountable experts stand behind the content. We make that evidence real:

1. **People:** `content_people` profiles for authors and medical reviewers (name, photo, role, qualification, licence/syndicate number where the person agrees, affiliations, `sameAs` to LinkedIn/ORCID/syndicate listing). No invented personas, no stock photos as people.
2. **Review workflow:** medical content (`category.requires_medical_review = true`, all drug pages, any article an automation flags as medical) cannot be published until a reviewer with `content.review` approves the exact revision. The page shows «راجعه طبيًا: د. … — صيدلي، بتاريخ …».
3. **Editorial policy page** (`/editorial-policy`): how topics are chosen, how AI assists drafting, sourcing standards, review cadence, corrections policy, conflicts of interest, advertising separation.
4. **Medical review page** (`/medical-review`): the board, criteria, how to report an error. **Corrections log** on each article when a substantive fix is made.
5. **Sources:** inline numbered references to primary sources; a sources section on every medical page.
6. **AI transparency:** articles drafted with AI assistance say so in the editorial note ("كُتب بمساعدة أدوات ذكاء اصطناعي وراجعه …"). Honesty is a trust signal for users and consistent with Google's guidance that AI-assisted content is acceptable when it is helpful and people-first.
7. **Experience:** pharmacist-authored tips, real (anonymised, consented) questions from users as article prompts, original data from our own aggregated analyses ("أكثر 20 مادة فعالة في الروشتات المصرية" from anonymised counts, k-anonymity ≥ 50) — **original data is the strongest citation magnet** for both journalists and AI answers.
8. **About and contact:** real company details, the team, the medical board, address/contact channels (already managed in settings).
9. **No-go list:** fear-based headlines, miracle claims, unverifiable statistics, health claims about products we sell, reviews or testimonials without consent (GROWTH-STRATEGY §8 applies).

---

## 10. GEO — Generative Engine Optimisation and AI search

### 10.1 How AI answers pick sources (what we can influence)
AI search experiences (Google AI Overviews and AI Mode, ChatGPT search, Perplexity, Microsoft Copilot, Claude, Gemini) retrieve pages from a search index or their own crawl, then quote or summarise passages. The levers that are documented or consistently observed:
1. **Being crawlable and indexed** by the engines they rely on (Google, Bing, their own bots). Google states AI Overviews use the normal Search index and ranking systems, and that no special markup is required.
2. **Clear, self-contained passages** that answer one question directly near the heading that asks it (retrieval works on chunks).
3. **Entity clarity**: the page states unambiguously what it is about (drug name in both scripts, INN, class), consistent naming of the brand across the web.
4. **Authority and corroboration**: cited by others, consistent with primary sources, reviewed by a named expert.
5. **Freshness signals** that are true: visible and structured update dates.

### 10.2 Content structure rules ("answer-first")
- Every H2 that is a question is followed immediately by a 1–2 sentence direct answer, then detail. The key-facts card on drug pages is written to be quotable on its own.
- Lists and tables for enumerations (side effects by frequency, forms and strengths).
- Definitions in the first sentence of glossary entries.
- No essential content in images, tabs that require JavaScript, or accordions without server-rendered text (native `<details>` is fine: text is in the HTML).
- Each page carries its own context (do not rely on "as mentioned above"); passages make sense when lifted out.

### 10.3 Entity and brand discoverability
- One canonical brand string per language: «وصفة AI» / "Wasfa AI", with consistent logo, description and links in Organization JSON-LD, social profiles, app store listings (when apps exist), directories and press.
- Build external corroboration: listings on reputable AI-tool directories and health-tech directories, Crunchbase/LinkedIn company pages, partnerships with pharmacies and syndicates (with links), press coverage of original data. A Wikidata item only when notability can be shown with independent sources (creating one without it gets deleted and looks spammy).
- An "About Wasfa AI" fact page (`/about`) written as a reference: what it is, who runs it, what it does not do, launch date, coverage. AI assistants frequently answer "what is X" from such pages.

### 10.4 AI crawler policy (admin-managed `seo.aiCrawlers`)
| Bot | Purpose | Default |
|---|---|---|
| Googlebot | Search, AI Overviews, AI Mode | allow |
| Google-Extended | Gemini model training and grounding in Gemini apps (does not affect Search) | **allow** (owner may change) |
| Bingbot | Bing search, Copilot | allow |
| OAI-SearchBot / ChatGPT-User | ChatGPT search results / user-triggered fetches | allow |
| GPTBot | OpenAI training | allow (owner choice) |
| Claude-SearchBot / Claude-User | Claude search / user fetches | allow |
| ClaudeBot | Anthropic training | allow (owner choice) |
| PerplexityBot / Perplexity-User | Perplexity index / user fetches | allow |
| Applebot / Applebot-Extended | Siri & Spotlight / Apple training opt-out | allow / owner choice |
| CCBot | Common Crawl (used by many model builders) | allow (owner choice) |

Recommendation recorded as a decision: **allow by default**. For a brand that wants to be known and cited, being in training data and retrieval indexes is a net benefit; app pages are already disallowed for everyone, and nothing private is publicly reachable. All public text is ours to publish. The owner can switch each training bot off without code.

### 10.5 `llms.txt` — evaluation and decision
- What it is: a 2024 community proposal (a Markdown file at `/llms.txt` listing a site's key pages for LLMs). No major search or AI provider has confirmed using it for retrieval or citation; Google has said it does not use it.
- Cost: near zero (generated from data we already have). Risk: none.
- **Decision:** ship `/llms.txt` (overview, product facts, key pages, guides index, medicines hub, editorial policy) and `/llms-full.txt` is **not** shipped (dumping thousands of drug pages into one file invites misuse and stale copies). Treat it as an experiment: log fetches by user agent (§12.4); if after 6 months no AI crawler fetches it meaningfully, it stays (harmless) but receives no further investment.

### 10.6 Snippet controls
- Default `max-snippet:-1, max-image-preview:large, max-video-preview:-1` on public pages, so search and AI surfaces can quote and show large images.
- `data-nosnippet` on UI chrome that should never be quoted (cookie banner, ad labels, "sponsored" blocks, navigation).

---

## 11. Images, social previews and favicons (SEO side; production pipeline in CONTENT-PLATFORM §5)

- Every indexable page has an Open Graph image 1200×630 (≤ 300 KB, PNG or JPEG for broad compatibility) and `twitter:card = summary_large_image`. Articles use their cover rendered to that size; drug pages use a generated branded card (name + ingredient, no pill photos unless licensed).
- Article featured images: one source uploaded once; the image pipeline stores AVIF/WebP/JPEG variants at 320–1600 px; pages use `<picture>`/`srcset` with exact `sizes`; three aspect ratios (16:9, 4:3, 1:1) are produced for Google Discover and Article structured data (≥ 1200 px wide for the 16:9).
- **Filenames** are descriptive ASCII (`amoxicillin-capsules-500mg.webp`), stable across edits (content-hash in the path for caching, not in the name).
- **Alt text** required on publish (editor blocks without it for content images; decorative images have empty alt).
- **Image sitemap** entries for featured images.
- **Medication photos:** only from licensed or own photography with stored licence metadata; otherwise neutral illustrations. Never an image that could be mistaken for a different product.
- **Favicons for search:** Google shows a favicon in results when the site has a square icon at a multiple of 48 px, crawlable at a stable URL; we ship SVG + 48/96/192 PNG + `apple-touch-icon` 180 + web manifest (BRAND-AND-HOMEPAGE §2).

---

## 12. Measurement, monitoring and reporting

### 12.1 KPIs (reported weekly in the admin SEO dashboard)
| KPI | Source | Target direction |
|---|---|---|
| Indexed pages vs submitted (per sitemap) | Search Console sitemaps + URL Inspection sampling | ≥ 90 % of submitted indexable pages indexed within 60 days |
| Organic clicks, impressions, CTR, avg position by section (home, features, drugs, blog, glossary) and by language | Search Console API | growth month over month |
| Non-brand share of organic clicks | Search Console (brand regex) | rising |
| Organic sign-ups and activations (first analysis) | our attribution (`TRACKING.md`) with `channel = organic_search` | rising; the business KPI |
| AI referral sessions (ChatGPT, Perplexity, Copilot, Gemini, Claude, ...) | referrer + `utm_source` classification (§12.4) | tracked, no target until baseline |
| AI crawler fetches by bot | server logs (§12.4) | tracked |
| Core Web Vitals pass rate | CrUX API + our RUM | ≥ 75 % "good" URLs per template |
| Content freshness | `next_review_due` | 0 overdue indexable pages |

### 12.2 Search Console integration
- A Google service account (owner adds it as a user on the property) with encrypted credentials in `seo` admin settings (the gateway-credential pattern from Phase 3).
- Worker job `seo:gsc-sync` daily: Search Analytics by date × page × query × country × device (last 3 days re-fetched because data settles late) into `seo_search_performance` (we keep more than Google's 16 months).
- `seo:url-inspect` samples newly published and recently changed URLs within the API quota (2,000/day per property) and stores coverage state, canonical chosen by Google, last crawl.
- Bing Webmaster API (optional, same pattern).

### 12.3 SEO health job (nightly) → admin SEO inbox
Broken internal links, redirect chains, orphans, duplicate titles/descriptions, missing alt text, indexable pages failing quality rules, monographs overdue, cannibalisation (§4.4), pages losing > 30 % clicks over 28 days, sitemap URLs returning non-200, hreflang pairs broken.

### 12.4 AI visibility measurement (what is reliably measurable)
- **Referrals:** classify sessions by referrer host and UTM: `chatgpt.com` / `chat.openai.com` (ChatGPT also appends `utm_source=chatgpt.com`), `perplexity.ai`, `copilot.microsoft.com`, `gemini.google.com`, `claude.ai`, `chat.deepseek.com`, `meta.ai` and others from an admin-editable list. Many AI apps send no referrer, so these numbers are a floor.
- **Crawler fetches:** the proxy (or Cloudflare logs) records bot hits by user agent for public pages, verified where providers publish IP ranges; counts per bot per day, no personal data.
- **AI Overviews:** Google reports them inside normal Search Console performance (no separate filter); we track it indirectly (impressions vs clicks shifts on informational queries).
- **Prompt panels (manual, monthly):** a fixed list of 50 prompts (Arabic and English) checked in major assistants, recording whether Wasfa AI is mentioned or cited. Stored in `seo_ai_checks` for trend, explicitly labelled as a sample, not a metric.

---

## 13. Admin SEO settings (no hard-coded values; registry key `seo`)
`titleTemplate`, `defaultDescription`, per-section index switches, `aiCrawlers` map, `verification` tokens (Google, Bing, Yandex), `indexNow.key` + enabled, `gsc` credentials (encrypted) + property, brand regex for brand/non-brand split, auto-link limits, monograph review intervals, AI referrer host list, `llmsTxt.enabled`, default OG image, organisation `sameAs` (already in `socials`).

---

## 14. Out of scope (with reason)
- Drug-pair interaction pages (needs a licensed, maintained interaction database and clinical review at a scale we cannot staff yet).
- Price pages, pharmacy-availability pages (no reliable data).
- Pill identification by imprint or photo (not a product capability; misidentification is dangerous).
- City/country doorway pages (§2).
- Paid link building, guest-post networks, expired-domain tactics, AI-spun mass content (policy violations and brand risk).
- French pages for the Maghreb (a later locale; the architecture supports adding `/fr`).
