import { PUBLISHING_API_BASE } from "./publishing.js";

/*
 * The agent guide (`GET /publishing/v1/guide`): the sheet an AI agent reads FIRST to write and publish an
 * article correctly given only a base URL and a key. English instructions with the Arabic writing rules.
 * It is generated (the base URL is filled in) and kept short on purpose: every line is a rule or a call.
 * A test checks that it names every route of the API and every error code the API returns.
 */

export function buildPublishingGuide(options: { apiBase: string }): string {
  const base = `${options.apiBase.replace(/\/+$/, "")}${PUBLISHING_API_BASE}`;
  return `# Wasfa Publishing API: agent guide

You are writing for Wasfa AI, an Arabic-first medication and health site. Read this once, then follow the workflow.
Base URL: \`${base}\`. JSON in and out, \`snake_case\`. Machine-readable spec: \`GET /openapi.json\` (this guide: \`GET /guide\`, both public).

## 1. Authentication
Send \`Authorization: Bearer <key>\` on every call except \`GET /openapi.json\` and \`GET /guide\`. Bodies are JSON with \`Content-Type: application/json\`; when you send that header on a POST that has no payload (publish, submit, unpublish), send \`{}\` as the body (an empty body with that header is a 400); send no Content-Type on GET and DELETE.
First call \`GET /me\`: it shows your scopes, whether the key may publish (\`can_publish\`), the daily publish cap and what is left today.
\`\`\`bash
curl -s ${base}/me -H "Authorization: Bearer $WASFA_KEY"
\`\`\`

## 2. The workflow (follow it exactly)
1. Once per session: \`GET /me\`, \`GET /categories\`, \`GET /people\`, \`GET /tags\`. Use the category and person slugs exactly as listed.
2. Write the article following sections 3 and 4.
3. Featured image: use the key's default image if \`/me\` shows one, otherwise \`POST /media/fetch\` (or \`POST /media\`) with real alt text, then poll \`GET /media/{id}\` until \`status\` is \`ready\`. If you have no legitimate image, ask the human.
4. \`POST /articles/validate\` with the full article. FIX EVERY item in \`quality.blocking\`, validate again until \`valid\` is true. Warnings: fix what you can.
5. Save with \`PUT /articles/by-external-id/<stable-id>\` and \`"desired_status": "draft"\` (the default). Use one stable id per article (e.g. your source row id); repeating the call updates the same article, it never duplicates.
6. Give the human the \`preview_url\` and a short summary of \`quality.warnings\`. STOP. Do not publish on your own.
7. Publish ONLY when the human explicitly asks: \`POST /articles/{id}/publish\` (or the PUT with \`"desired_status": "published"\`), or \`POST /articles/{id}/schedule\` with a \`scheduled_at\`. Then report the result honestly:
   - \`status: "published"\` and a \`url\`: it is live. Only then may you say so.
   - \`status: "in_review"\`: a human medical reviewer must approve this exact revision first. With \`publish_on_approval: true\` it publishes automatically after approval; otherwise call \`POST /articles/{id}/publish\` after approval. Say it is waiting for review.
   - \`status: "draft"\` with \`notes\`: it was NOT published; read \`notes\` and tell the human why (for example the key cannot publish).
   - Never claim an article is live unless the response says \`published\` and gives a \`url\`. \`notes\` always explain a difference between what was asked and what happened.
8. Use \`POST /articles/{id}/submit\` to send a medical draft to review without asking to publish, \`POST /articles/{id}/unpublish\` to take it down, \`DELETE /articles/{id}\` to delete a never-published draft (published ones are archived), \`PATCH /articles/{id}\` for a partial update, \`GET /articles/{id}\`, \`GET /articles\` and \`GET /articles/{id}/revisions\` to read.

\`\`\`bash
# validate (writes nothing)
curl -s -X POST ${base}/articles/validate -H "Authorization: Bearer $WASFA_KEY" -H "Content-Type: application/json" -d @article.json
# save as draft, safe to repeat
curl -s -X PUT ${base}/articles/by-external-id/kb-1042 -H "Authorization: Bearer $WASFA_KEY" -H "Content-Type: application/json" -d @article.json
# publish only when the human asked
curl -s -X POST ${base}/articles/$ID/publish -H "Authorization: Bearer $WASFA_KEY" -H "Content-Type: application/json" -d '{}'
# image from a URL (Idempotency-Key is required on every POST that creates)
curl -s -X POST ${base}/media/fetch -H "Authorization: Bearer $WASFA_KEY" -H "Content-Type: application/json" -H "Idempotency-Key: cover-kb-1042-v1" \\
  -d '{"source_url":"https://images.example.com/cover.jpg","alt":"علبة دواء وكوب ماء على طاولة","licence":"licensed","licence_ref":"Example Images 8812"}'
\`\`\`
\`article.json\` (required: \`type\`, \`locale\`, \`title\`, \`excerpt\`, \`body_markdown\`; \`slug\` required for Arabic titles):
\`\`\`json
{ "type": "article", "locale": "ar", "title": "كيف تتناول المضاد الحيوي بطريقة صحيحة", "slug": "taking-antibiotics-correctly",
  "excerpt": "خطوات بسيطة تساعدك على الالتزام بمواعيد المضاد الحيوي ومدته كما وصفها الطبيب.",
  "body_markdown": "## لماذا تهم المدة الكاملة؟\\n\\n...", "category": "medicines-basics", "tags": ["مضادات حيوية"],
  "author": "dr-sara-ahmed", "featured_media_id": "<media uuid>",
  "seo": { "description": "متى تأخذ المضاد الحيوي وماذا تفعل إذا نسيت جرعة.", "focus_keyword": "طريقة استخدام المضاد الحيوي" },
  "sources": [{ "title": "WHO: Antimicrobial resistance", "url": "https://www.who.int/news-room/fact-sheets/detail/antimicrobial-resistance" }],
  "ai_assisted": true, "desired_status": "draft" }
\`\`\`

## 3. Content rules
- Arabic first: clear Modern Standard Arabic that an Egyptian reader finds natural; one language per article (\`locale\` \`ar\` or \`en\`); RTL, no Latin punctuation inside Arabic sentences. English articles are separate items linked with \`translation_of\`.
- Structure: the \`title\` is the only H1 (do NOT put \`# \` in the body); sections with \`##\`, sub-sections \`###\`, never skip a level; short paragraphs (under about 120 words, sentences under about 25); a short summary first; lists and tables where they help; a Q&A section (\`## أسئلة شائعة\`) when useful; link to related Wasfa pages (\`/blog/<slug>\`, \`/guides/<slug>\`, \`/glossary/<slug>\`) at least twice, only to pages that exist.
- Length (quality gates): article at least 600 words, guide at least 1200, glossary entry a definition of up to 300 characters plus at least 80 words. No filler, no repeated text: near-duplicates of existing pages are refused.
- \`title\` 10-110 characters. \`excerpt\` 50-300 characters. \`seo.description\` up to 320 characters (aim for 140-160) and it must contain the focus keyword; every description is unique. \`slug\`: \`a-z\`, \`0-9\` and hyphens, 3-80 characters; Arabic titles REQUIRE an explicit English slug (the API does not transliterate); a slug cannot change once the article was published.
- A featured image with alt text is required to publish articles and guides. Every body image needs alt text too. Use only images you may legally use and state the \`licence\` (\`own\`, \`licensed\`, \`cc-by\` with \`credit\`, \`public-domain\` with \`licence_ref\`, \`ai-generated\`).
- Sources are rendered as a "المصادر / Sources" list at the end by the API: send them in \`sources\`, do not write that section yourself.

## 4. Medical safety (non-negotiable)
- Educational information only. Never diagnose, never prescribe, never give personal dosing ("take 2 tablets"). Explain what a medicine class is for and general facts, and tell the reader to ask their doctor or pharmacist.
- Never invent drug names, brands, claims, statistics, studies or sources. If you are not sure of a fact, leave it out.
- Sources: at least one real, reachable \`https\` source in \`sources\` (WHO, NIH or MedlinePlus, FDA, EMA, Egyptian Drug Authority, a peer-reviewed paper). A made-up or unreachable source is a policy violation. Medical categories reject an article without sources.
- Set \`"ai_assisted": true\` when you wrote or drafted the text: the site shows an AI-assistance note and the text gets the same human review as any other.
- Include a clear note to consult a doctor or pharmacist (a \`:::warning\` block near the top or end).
- Forbidden claims (blocking gate): cure or guarantee wording such as "guaranteed cure", "cures all", "no side effects", "replaces your doctor", "100% safe", "شفاء تام", "علاج مضمون", "بدون أي آثار جانبية", "بديل عن الطبيب". No miracle language.
- Never recommend swapping one brand for another or suggest a substitute medicine.
- Medical categories (and every guide and glossary entry) ALWAYS go through human review, whatever your key can do. Nothing medical is public until a reviewer approves that exact revision.

## 5. Errors, limits, idempotency
Errors are \`{"code","message","details","ref"}\`; read \`details.fields\`/\`details.messages\` (they name the field and the rule). Send \`Accept-Language: en\` for English messages.
| Code | HTTP | What to do |
|---|---|---|
| VALIDATION_FAILED | 400 | fix the fields in \`details.fields\`; \`details.messages\` says why |
| AUTH_REQUIRED, INVALID_SIGNATURE | 401 | the key is missing, wrong, expired or revoked: stop and tell the human |
| FORBIDDEN, SCOPE_REQUIRED | 403 | the key lacks a scope, or the type, category or action is not allowed for it: do not retry, tell the human |
| NOT_FOUND | 404 | wrong id, or not visible to this key |
| CONFLICT | 409 | \`details.code\` DUPLICATE_CONTENT: the text is too similar to \`matching_item_id\` (use its \`matching_external_id\` if it is yours, else rewrite); \`details.reason\` external_id_exists: use PUT; idempotent_request_in_progress: wait and retry |
| CONTENT_SLUG_TAKEN | 409 | choose another slug |
| IDEMPOTENCY_MISMATCH | 409 | that Idempotency-Key was used with a different body: use a new key |
| CONTENT_ILLEGAL_TRANSITION | 409 | the action does not apply to the current status (for example the item is archived) |
| CONTENT_CONFLICT | 412 | \`If-Match\` revision is stale: GET the article, merge, retry |
| PAYLOAD_TOO_LARGE | 413 | body over 1 MB, markdown over 200 KB, image over 10 MB |
| UNSUPPORTED_MEDIA | 415 | only JPEG, PNG, WebP, AVIF still images (no GIF, SVG, HEIC, animated, PDF) |
| CONTENT_GATES_BLOCK | 422 | the article was SAVED as a draft; fix \`details.blocking\`/\`details.messages\` and send again |
| CONTENT_PUBLISH_CAP | 429 | the daily publish cap (key or site) is reached: schedule for another day |
| RATE_LIMITED | 429 | wait \`Retry-After\` seconds |
| UPSTREAM_UNAVAILABLE | 503 | storage or a dependency is down: retry with backoff |
- Every response has \`RateLimit-Limit\`, \`RateLimit-Remaining\`, \`RateLimit-Reset\`; on 429 wait \`Retry-After\`.
- \`POST /articles\`, \`POST /media\`, \`POST /media/fetch\`, \`POST /categories\` and \`POST /tags\` REQUIRE an \`Idempotency-Key\` header (8-128 characters). The same key with the same body returns the first answer for 24 h; with a different body it is an error. Prefer \`PUT /articles/by-external-id/{external_id}\`, which needs none.
- \`ETag: "<revision>"\` is on article answers; send \`If-Match: "<revision>"\` on \`PUT\`, \`PATCH\` and the action calls to avoid overwriting a human's edit.
- \`PATCH\` is JSON Merge Patch: a present field replaces, \`null\` clears, an absent field is untouched. \`PUT\` leaves omitted optional fields unchanged.
- Reads: \`GET /articles?status=&type=&locale=&category=&updated_since=&external_id=&limit=&cursor=\`; follow \`next_cursor\` until it is null.
- Media: \`POST /media\` (multipart \`file\` plus fields), \`GET /media/{id}\`, \`PATCH /media/{id}\` for alt text and credit. A new category made by \`POST /categories\` always requires medical review; \`POST /tags\` creates tags (both need the taxonomy:write scope).

## 6. Routes
${routeList()}
`;
}

/** One line per route, in the table order of the API; kept in step with the route table by a test. */
function routeList(): string {
  return ROUTE_LINES.map(([route, what]) => `- \`${route}\`: ${what}`).join("\n");
}

const ROUTE_LINES: readonly (readonly [string, string])[] = [
  ["GET /me", "your key, scopes, limits"],
  ["GET /openapi.json", "the OpenAPI 3.1 spec (public)"],
  ["GET /guide", "this guide (public)"],
  ["POST /articles", "create (Idempotency-Key required)"],
  ["POST /articles/validate", "dry run, writes nothing"],
  ["PUT /articles/by-external-id/{external_id}", "create or update by your own id (recommended)"],
  ["GET /articles", "list"],
  ["GET /articles/{id}", "read"],
  ["PATCH /articles/{id}", "partial update"],
  ["POST /articles/{id}/submit", "send to medical review"],
  ["POST /articles/{id}/publish", "publish (only when the human asked)"],
  ["POST /articles/{id}/schedule", "schedule"],
  ["POST /articles/{id}/unpublish", "take down"],
  ["DELETE /articles/{id}", "delete a draft / archive"],
  ["GET /articles/{id}/revisions", "history"],
  ["POST /media", "upload an image"],
  ["POST /media/fetch", "fetch an image from an https URL"],
  ["GET /media/{id}", "image status"],
  ["PATCH /media/{id}", "alt text, caption, credit, licence"],
  ["GET /categories", "categories"],
  ["POST /categories", "create a category"],
  ["GET /tags", "tags"],
  ["POST /tags", "create a tag"],
  ["GET /people", "authors and reviewers"],
];
