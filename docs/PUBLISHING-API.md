# PUBLISHING-API.md — Publishing API for AI agents and automation

> Phase 4, Task 4.4. A stable, versioned HTTP API that lets an AI agent, n8n, Make, Zapier or a custom script create, update, illustrate, schedule and publish content in Wasfa AI, safely and at volume.
> The editorial rules (states, medical review, quality gates, media pipeline) are the same as in the admin editor: `docs/CONTENT-PLATFORM.md`. This file is the contract an integrator reads.

---

## 1. Overview

- **Base URL:** `https://<API_DOMAIN>/publishing/v1` (production `API_DOMAIN` from deployment settings, e.g. `api.wasfa.online`). Staging has its own keys and base URL.
- **Format:** JSON (UTF-8) requests and responses; `multipart/form-data` only for media upload. Field names are `snake_case`.
- **Auth:** API key in `Authorization: Bearer <key>` (§3). Optional request signing per key.
- **Content body:** Markdown with Wasfa directives (CONTENT-PLATFORM §7). HTML is accepted only in `body_html_import` and is converted to Markdown and sanitised; scripts, iframes, styles and event handlers are dropped.
- **Safety by design:** a key can be limited to drafts. Medical categories always pass through human review before anything is public, whatever the key's scopes (§8).
- **Machine-readable spec:** `GET /publishing/v1/openapi.json` (OpenAPI 3.1, generated from the same zod schemas the server validates with, so the spec cannot drift from the code). A human-readable reference renders from it at `/admin/content/api/docs`.

---

## 2. Quick start

```bash
# 1. Check the key
curl -s https://api.wasfa.online/publishing/v1/me \
  -H "Authorization: Bearer $WASFA_KEY"

# 2. Upload the cover image from a URL (processed asynchronously)
curl -s https://api.wasfa.online/publishing/v1/media/fetch \
  -H "Authorization: Bearer $WASFA_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: cover-amoxicillin-guide-2026-10" \
  -d '{"source_url":"https://images.example.com/amoxicillin-cover.jpg",
       "alt":"علبة دواء وكوب ماء على طاولة","licence":"licensed","licence_ref":"Example Images #8812"}'

# 3. Create or update the article by YOUR id (safe to repeat)
curl -s -X PUT https://api.wasfa.online/publishing/v1/articles/by-external-id/kb-1042 \
  -H "Authorization: Bearer $WASFA_KEY" \
  -H "Content-Type: application/json" \
  -d @article.json
```

`article.json`:
```json
{
  "type": "article",
  "locale": "ar",
  "title": "كيف تتناول المضاد الحيوي بطريقة صحيحة",
  "slug": "taking-antibiotics-correctly-tips",
  "excerpt": "خطوات بسيطة تساعدك على الالتزام بمواعيد المضاد الحيوي ومدته كما وصفها الطبيب.",
  "body_markdown": "## لماذا تهم المدة الكاملة؟\n\nالالتزام بالمدة التي حددها الطبيب ...\n\n:::warning\nلا تتوقف عن الدواء من تلقاء نفسك قبل استشارة الطبيب.\n:::\n",
  "category": "medicines-basics",
  "tags": ["مضادات حيوية", "نصائح للمريض"],
  "author": "dr-sara-ahmed",
  "featured_media_id": "med_01JD3W...",
  "seo": {
    "title": "طريقة استخدام المضاد الحيوي الصحيحة",
    "description": "متى تأخذ المضاد الحيوي وماذا تفعل إذا نسيت جرعة، ولماذا لا تتوقف قبل نهاية المدة.",
    "focus_keyword": "طريقة استخدام المضاد الحيوي الصحيحة"
  },
  "sources": [
    { "title": "WHO — Antimicrobial resistance fact sheet", "url": "https://www.who.int/news-room/fact-sheets/detail/antimicrobial-resistance" }
  ],
  "ai_assisted": true,
  "desired_status": "in_review"
}
```

Response `200` (or `201` on first creation):
```json
{
  "id": "cnt_01JD3X...",
  "external_id": "kb-1042",
  "status": "in_review",
  "revision": 1,
  "url": null,
  "preview_url": "https://wasfa.online/preview/eyJ...",
  "quality": { "blocking": [], "warnings": [{ "code": "FEW_INTERNAL_LINKS", "message": "..." }] },
  "created": true
}
```

---

## 3. Authentication, keys and signing

### 3.1 Keys
- Created in **Admin › المحتوى › مفاتيح API** by a user with `content.api_keys` (fresh authentication and 2FA required). The secret is shown **once**.
- Format: `wsk_live_<key_id>_<secret>` (staging: `wsk_test_...`). The server stores the `key_id`, a keyed hash (HMAC-SHA256 with a server pepper) of the secret, the last 4 characters for display, and never the secret itself. Comparison is constant-time.
- Per-key settings: name, owner (an admin user), scopes (§3.2), `can_publish` (false = the key can only create drafts or submit for review), allowed content types and categories, default author, daily publish cap, rate limit tier, optional IP allow-list (CIDR), optional `require_signature`, expiry date (default 365 days, max 730), webhook URL and secret.
- **Rotation:** "Rotate" issues a new secret and keeps the old one valid for a grace period (default 24 h, max 7 days) so automations can switch without downtime. **Revocation** is immediate (cached key state is invalidated through the existing invalidation bus).
- Keys expiring within 14 days, unused for 60 days, or showing error spikes raise admin alerts (Phase 3 `AdminAlertService`).

### 3.2 Scopes
| Scope | Grants |
|---|---|
| `content:read` | read own items and their status (and published items of others) |
| `content:write` | create and update items, submit for review |
| `content:publish` | publish, schedule, unpublish (still subject to medical review and `can_publish`) |
| `media:write` | upload and fetch media, set alt/caption |
| `taxonomy:write` | create categories and tags (otherwise unknown tags are rejected or mapped, per key setting) |
| `people:read` | list authors and reviewers (ids and slugs) |

### 3.3 Optional request signing (per key, recommended for server-to-server)
Headers: `X-Wasfa-Timestamp: <unix seconds>` and `X-Wasfa-Signature: v1=<hex>` where
`hex = HMAC_SHA256(secret, timestamp + "\n" + METHOD + "\n" + path_with_query + "\n" + hex(SHA256(raw_body)))`.
The server rejects timestamps more than 300 s from its clock and a repeated signature within that window (replay cache in Redis). Keys with `require_signature` reject unsigned requests with `401 INVALID_SIGNATURE`.

---

## 4. Conventions

### 4.1 Idempotency and duplicates (three layers)
1. **`PUT /articles/by-external-id/{external_id}`** is the recommended write: your own stable id (≤ 128 chars, `[A-Za-z0-9._:-]`), unique per key. Repeating it updates the same item; it never creates a second one.
2. **`Idempotency-Key` header** is **required** on every `POST` that creates something (`/articles`, `/media`, `/media/fetch`, `/articles/batch`). The server stores the key with a hash of the request body for 24 h: the same key + same body returns the original response; the same key + a different body returns `409 IDEMPOTENCY_MISMATCH`.
3. **Content-level duplicate guard:** slug uniqueness, title near-duplicate check and body similarity (CONTENT-PLATFORM §6.2). A near-duplicate of another item returns `409 DUPLICATE_CONTENT` with the matching item's id and URL (when it belongs to the same key, the response suggests using its `external_id` instead).

### 4.2 Concurrency
Responses carry `ETag: "<revision>"`. Send `If-Match` on `PATCH`/`PUT` to avoid overwriting an editor's change; a mismatch returns `412 REVISION_CONFLICT` with the current revision number. Without `If-Match` the write creates a new revision on top (nothing is lost; history keeps both).

### 4.3 Errors
The API uses the platform's standard error body (`packages/shared/src/errors`):
```json
{ "code": "VALIDATION_FAILED", "message": "…", "details": { "fields": { "seo.description": "too_long" } }, "ref": "E-7KQ2…" }
```
`message` is Arabic by default; send `Accept-Language: en` for English. `ref` appears on unexpected errors and is what support needs. New codes added for this API (registered in `ErrorCode` with HTTP status and both languages):

| HTTP | Code | When |
|---|---|---|
| 400 | `VALIDATION_FAILED` | schema errors (`details.fields`) |
| 401 | `AUTH_REQUIRED` / `INVALID_SIGNATURE` | missing, unknown, expired or revoked key; bad signature |
| 403 | `FORBIDDEN` / `SCOPE_REQUIRED` | key lacks a scope, category or type not allowed, IP not allowed |
| 404 | `NOT_FOUND` | unknown id (or not visible to this key) |
| 409 | `IDEMPOTENCY_MISMATCH`, `DUPLICATE_CONTENT`, `SLUG_TAKEN` | §4.1 |
| 412 | `REVISION_CONFLICT` | §4.2 |
| 413 | `PAYLOAD_TOO_LARGE` | body > 1 MB or media > 10 MB |
| 415 | `UNSUPPORTED_MEDIA` | wrong media type or failed magic-byte check |
| 422 | `QUALITY_GATE_FAILED` | publish requested but blocking gates fail (`details.blocking[]`) |
| 422 | `REVIEW_REQUIRED` | publish requested for medical content without an approved revision |
| 429 | `RATE_LIMITED` / `PUBLISH_CAP_REACHED` | §5 |
| 503 | `UPSTREAM_UNAVAILABLE` | maintenance or storage down (retry with backoff) |

### 4.4 Pagination and filtering
Cursor pagination: `?limit=50&cursor=<opaque>`; responses include `next_cursor` (null at the end). Filters: `status`, `type`, `locale`, `category`, `updated_since` (ISO 8601), `external_id`.

### 4.5 Time
All timestamps are ISO 8601 UTC (`2026-11-02T07:00:00Z`). `scheduled_at` must be ≥ 5 minutes in the future and ≤ 365 days ahead.

---

## 5. Limits and abuse prevention

| Limit | Default (per key, admin-adjustable) |
|---|---|
| Requests | 60/min sustained, burst 20 (token bucket in Redis) |
| Media uploads/fetches | 20/min, 500/day |
| Batch size | 25 items per `/articles/batch` call (each counts as one write) |
| Body size | 1 MB JSON; Markdown body ≤ 200 KB |
| Created items | 1,000/day |
| Publishes (incl. scheduled ones going live) | per-key cap (default 25/day) and the global `content.maxPublishesPerDay` |
| Concurrent requests | 4 |

Every response carries `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` and, on `429`, `Retry-After`. Repeated auth failures from one IP are throttled by the existing rate-limit layer; Cloudflare WAF rules for the publishing path are part of the deployment checklist.

---

## 6. Media

- `POST /media` — multipart field `file` + JSON fields `alt` (required unless `decorative=true`), `alt_en`, `caption`, `credit`, `licence` (`own`, `licensed`, `cc-by`, `public-domain`, `ai-generated`), `licence_ref`, `filename_hint`, `focal_point` (`{x,y}` 0–1).
- `POST /media/fetch` — `{ "source_url": "https://…", …same fields }`. The server fetches with an SSRF guard: `https` only, DNS resolved and checked against private, loopback, link-local and metadata ranges (re-checked after redirects; max 3 redirects), 10 s timeout, 10 MB cap, magic-byte check. The URL is not stored in public output.
- Both return `202` with `{ "id": "med_…", "status": "processing" }`; poll `GET /media/{id}` or receive the `media.ready` / `media.failed` webhook. Articles may reference a media id that is still processing; publishing waits for `ready` (blocking gate) or fails with a clear message after 10 minutes.
- Accepted: JPEG, PNG, WebP, AVIF, static GIF. Not accepted: SVG, HEIC, animated images, PDFs.
- Same bytes uploaded again return the existing asset (`"deduplicated": true`).
- Inline images in Markdown: `![alt](media:med_01JD… "caption")`.

---

## 7. Articles and other content

### 7.1 Object
| Field | Type | Notes |
|---|---|---|
| `type` | `article` \| `guide` \| `glossary` | `page` and `monograph` are not writable through the API in Phase 4 |
| `locale` | `ar` \| `en` | |
| `translation_of` | id or `external_id` | links AR↔EN versions (hreflang) |
| `title` | 10–110 chars | H1 |
| `slug` | `[a-z0-9-]{3,80}` | optional: generated from the title by transliteration |
| `excerpt` | 50–300 chars | |
| `body_markdown` | string | see CONTENT-PLATFORM §7 for directives |
| `body_html_import` | string | alternative input: converted + sanitised; the stored body is Markdown |
| `definition` | string | glossary only |
| `category` | slug | must exist (or `taxonomy:write`) |
| `tags` | string[] ≤ 10 | names or slugs |
| `author` / `reviewer` | person slug | reviewer is a **request**; approval is always done by that person in the admin |
| `featured_media_id` | media id | required to publish articles and guides |
| `seo` | object | `title`, `description`, `focus_keyword`, `secondary_keywords[]`, `canonical_url` (only for keys allowed to set it), `robots` (`index`/`noindex`), `og_title`, `og_description`, `og_media_id` |
| `sources` | `{title,url,publisher?,accessed_at?}[]` | rendered as references; required for medical categories (≥ 1) |
| `ai_assisted` | boolean | shown in the editorial note when true |
| `flags` | object | `auto_link`, `show_toc`, `show_related` |
| `desired_status` | `draft` \| `in_review` \| `published` \| `scheduled` | the server applies the workflow (§8) and returns the resulting `status` |
| `scheduled_at` | timestamp | with `desired_status = scheduled` |

Read-only fields returned: `id`, `status`, `revision`, `url` (when published), `preview_url`, `published_at`, `updated_at`, `content_updated_at`, `reviewed_by`, `reviewed_at`, `quality`, `word_count`.

### 7.2 Endpoints
| Method | Path | Scope | Purpose |
|---|---|---|---|
| GET | `/me` | any | key name, scopes, limits, remaining caps today |
| GET | `/openapi.json` | none (public, cached) | the spec |
| POST | `/articles` | `content:write` | create (requires `Idempotency-Key`) |
| PUT | `/articles/by-external-id/{external_id}` | `content:write` | create or replace by your id (**recommended**) |
| PATCH | `/articles/{id}` | `content:write` | partial update (JSON Merge Patch) |
| GET | `/articles/{id}` · `/articles` | `content:read` | read, list with filters |
| POST | `/articles/validate` | `content:write` | dry run: schema + quality gates + rendered HTML preview; writes nothing |
| POST | `/articles/{id}/submit` | `content:write` | send to medical review |
| POST | `/articles/{id}/publish` | `content:publish` | publish now (respects review and caps) |
| POST | `/articles/{id}/schedule` | `content:publish` | `{ "scheduled_at": "…" }` |
| POST | `/articles/{id}/unpublish` | `content:publish` | back to draft, URL returns 404 |
| DELETE | `/articles/{id}` | `content:write` | drafts: delete; published: archive (410) unless `redirect_to` is given (301) |
| GET | `/articles/{id}/revisions` | `content:read` | revision list (no restore through the API) |
| POST | `/articles/batch` | `content:write` | ≤ 25 upserts by `external_id`, per-item results, partial success allowed (`207`) |
| POST | `/media` · `/media/fetch` · GET `/media/{id}` · PATCH `/media/{id}` | `media:write` | §6 |
| GET/POST | `/categories` · `/tags` | read: `content:read`; create: `taxonomy:write` | taxonomy |
| GET | `/people` | `people:read` | authors and reviewers |

Updating a **published** item through the API creates a new revision; non-medical items publish it immediately only when `desired_status = published` and the key can publish; medical items go to review while the approved revision stays live (CONTENT-PLATFORM §4.1).

---

## 8. How the workflow applies to automated content

| Key `can_publish` | Category needs medical review | `desired_status = published` results in |
|---|---|---|
| false | any | `in_review` (if medical) or `draft`; response explains why |
| true | no | `published` if quality gates pass and caps allow, else `422`/`429` with the reason (the item is saved as draft) |
| true | yes | `in_review`; becomes publishable after a reviewer approves the exact revision; can be auto-published on approval if the request asked for `published` (`publish_on_approval: true` is stored) |

Recommended setup for high volume: one key per automation, `can_publish = false` for new automations until their output quality is proven, medical categories always reviewed, the global daily cap set to what the review team can check, and the `content.review_requested` webhook feeding the reviewers' channel.

**Search-engine policy guardrails** (enforced or surfaced): daily publish caps; duplicate and near-duplicate refusal; minimum substance gates; an "AI-assisted" disclosure flag; no auto-generated pages from keyword lists without editorial value (the API cannot create drug pages or arbitrary landing pages); keyword ownership warnings to avoid cannibalisation.

---

## 9. Webhooks (optional per key)

Events: `content.created`, `content.review_requested`, `content.changes_requested` (with the reviewer's comment), `content.approved`, `content.published`, `content.unpublished`, `content.archived`, `media.ready`, `media.failed`, `key.expiring`.
Delivery: `POST` JSON to the key's webhook URL with `X-Wasfa-Event`, `X-Wasfa-Delivery` (unique id), `X-Wasfa-Timestamp`, `X-Wasfa-Signature: v1=<HMAC_SHA256(webhook_secret, timestamp + "." + body)>`. Retries with exponential backoff for 24 h (8 attempts) through the outbox; deliveries visible in the admin log with response codes. The URL must be `https` and pass the same SSRF guard as media fetch.

---

## 10. Audit, monitoring and operations

- Every API call is logged in `publishing_api_requests` (key id, method, route template, status, latency, item id, idempotency key, error code; **no bodies**), retained 90 days. Every write is also an `audit_logs` entry with `actor = api_key:<id>`.
- Admin screen per key: requests over time, error rate by code, items created/published, last used, rate-limit hits, webhook health.
- Alerts: error rate > 20 % over 15 min, repeated `401` from a known key id (possible leaked/rotated key), publish cap reached, webhook failing for > 1 h.
- Metrics exported with the existing observability stack (latency histogram per route, 4xx/5xx counters per key).

---

## 11. Recipes

**AI agent writing a series (recommended pattern):**
1. `GET /people`, `GET /categories` once; cache ids.
2. For each topic: generate text and image → `POST /media/fetch` (or `/media`) with alt + licence → `POST /articles/validate` → fix blocking issues in the agent → `PUT /articles/by-external-id/{topic-id}` with `desired_status: "in_review"` (medical) or `"scheduled"` with spaced `scheduled_at` (non-medical).
3. Listen for `content.changes_requested` and revise with the same `external_id`.

**n8n / Make:** an HTTP Request node with header auth (`Authorization: Bearer …`), body JSON as above; use the item's stable id from your source (sheet row id, Notion page id) as `external_id`; enable "continue on fail" and route `429` to a wait node honouring `Retry-After`.

**Bulk import of existing articles:** `/articles/batch` with 25 items per call, `desired_status: "draft"`, then review and schedule from the admin calendar.

---

## 12. Versioning and stability
- Breaking changes only in a new major path (`/publishing/v2`); `v1` stays for at least 6 months after `v2` ships, with a `Deprecation` and `Sunset` header.
- Additive changes (new optional fields, new webhook events, new error codes) can happen in `v1`; clients must ignore unknown fields.
- The changelog is kept at the end of this file.

## Changelog
- v1.0 (Phase 4) — initial release.
