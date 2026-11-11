/* Admin > API keys and connecting an AI agent (Publishing API). */
import type { arAdminPublishing } from "./ar.admin-publishing.js";

export const enAdminPublishing = {
  "admin.nav.content.apiKeys": "API keys",
  "admin.nav.content.apiKeys.description": "AI agent keys to create and publish content.",
  "admin.nav.content.apiConnect": "Connect an AI agent",
  "admin.nav.content.apiConnect.description":
    "Endpoint, quick start and instructions ready to copy to Claude.",
  "admin.nav.content.apiDocs": "Publishing API reference",
  "admin.nav.content.apiDocs.description": "Browse Publishing API routes and requirements.",

  "admin.pub.docs.title": "Publishing API reference",
  "admin.pub.docs.intro": "A live reference loaded from the published OpenAPI specification.",
  "admin.pub.docs.baseUrl": "API base URL",
  "admin.pub.docs.connectLink": "Connection setup",
  "admin.pub.docs.keysLink": "Manage API keys",
  "admin.pub.docs.searchLabel": "Search routes",
  "admin.pub.docs.searchPlaceholder": "Search by method, path, summary or scope",
  "admin.pub.docs.methodFilter": "Filter by method",
  "admin.pub.docs.methodAll": "All methods",
  "admin.pub.docs.scopeFilter": "Filter by scope",
  "admin.pub.docs.scopeAll": "All scopes",
  "admin.pub.docs.routesCount": "{count} routes",
  "admin.pub.docs.noResults": "No routes match your search.",
  "admin.pub.docs.loading": "Loading the API reference…",
  "admin.pub.docs.error": "The Publishing API reference could not be loaded. Try again.",
  "admin.pub.docs.retry": "Retry",
  "admin.pub.docs.auth": "Authentication",
  "admin.pub.docs.authRequired": "API key required",
  "admin.pub.docs.authPublic": "Public, no authentication",
  "admin.pub.docs.scope": "Required scope",
  "admin.pub.docs.noScope": "No specific scope",
  "admin.pub.docs.parameters": "Parameters",
  "admin.pub.docs.requestBody": "Request body",
  "admin.pub.docs.successResponses": "Success responses",
  "admin.pub.docs.required": "Required",
  "admin.pub.docs.optional": "Optional",
  "admin.pub.docs.noParameters": "No parameters.",
  "admin.pub.docs.noRequestBody": "This route does not require a request body.",
  "admin.pub.docs.noSuccessResponses": "No success responses are described.",
  "admin.pub.docs.version": "Specification version {version}",
  "admin.pub.docs.method.get": "Read",
  "admin.pub.docs.method.post": "Create or execute",
  "admin.pub.docs.method.put": "Replace or create",
  "admin.pub.docs.method.patch": "Update",
  "admin.pub.docs.method.delete": "Delete",
  "admin.pub.docs.method.options": "Options",
  "admin.pub.docs.method.head": "Response headers",
  "admin.pub.docs.method.trace": "Trace",

  "admin.pub.keys.title": "API keys",
  "admin.pub.keys.intro":
    "A key is what an AI agent (such as Claude) uses to write content, upload images and publish on your behalf. Give each agent its own key with the fewest permissions it needs.",
  "admin.pub.keys.connectLink": "How do I connect Claude?",
  "admin.pub.keys.create": "New key",
  "admin.pub.keys.table": "API keys",
  "admin.pub.keys.empty.title": "No keys yet",
  "admin.pub.keys.empty.description":
    "Create a key, then give it to your agent with the guide link.",
  "admin.pub.col.name": "Name",
  "admin.pub.col.key": "Key",
  "admin.pub.col.scopes": "Permissions",
  "admin.pub.col.publish": "Publishing",
  "admin.pub.col.status": "Status",
  "admin.pub.col.lastUsed": "Last used",
  "admin.pub.col.today": "Today",
  "admin.pub.col.owner": "Owner",
  "admin.pub.neverUsed": "Never used",
  "admin.pub.env.live": "Live",
  "admin.pub.env.test": "Test",
  "admin.pub.canPublish.yes": "Can publish",
  "admin.pub.canPublish.no": "Drafts only",
  "admin.pub.status.active": "Active",
  "admin.pub.status.expiring": "Expiring soon",
  "admin.pub.status.expired": "Expired",
  "admin.pub.status.revoked": "Revoked",
  "admin.pub.status.grace": "The old key works until {date}",
  "admin.pub.usage.today": "{requests} requests, {errors} errors, {published} published",
  "admin.pub.expiresOn": "Expires {date}",

  "admin.pub.scope.content:read": "Read content",
  "admin.pub.scope.content:read.description":
    "Reads existing articles and drafts and validates text before saving.",
  "admin.pub.scope.content:write": "Write content",
  "admin.pub.scope.content:write.description":
    "Creates and edits drafts and submits them for review. Cannot publish with this alone.",
  "admin.pub.scope.content:publish": "Publish content",
  "admin.pub.scope.content:publish.description":
    'Schedules and publishes approved content. Also needs "Can publish" switched on.',
  "admin.pub.scope.media:write": "Upload images",
  "admin.pub.scope.media:write.description":
    "Uploads images to the media library and uses them in content.",
  "admin.pub.scope.taxonomy:write": "Manage taxonomy",
  "admin.pub.scope.taxonomy:write.description": "Creates new categories and tags.",
  "admin.pub.scope.people:read": "Read authors and reviewers",
  "admin.pub.scope.people:read.description":
    "Reads the list of authors and reviewers to pick from.",

  "admin.pub.type.article": "Articles",
  "admin.pub.type.guide": "Guides",
  "admin.pub.type.glossary": "Glossary terms",

  "admin.pub.form.createTitle": "Create an API key",
  "admin.pub.form.editTitle": "Edit the key",
  "admin.pub.form.editHint":
    'The environment and expiry do not change. To change the secret use "Rotate key".',
  "admin.pub.form.name": "Key name",
  "admin.pub.form.name.hint": 'A name that tells which agent it is, like "Claude for articles".',
  "admin.pub.form.environment": "Environment",
  "admin.pub.form.scopes": "Permissions",
  "admin.pub.form.canPublish": "This key can publish directly",
  "admin.pub.form.canPublish.warning":
    "Medical categories always need a human reviewer, whatever this says. When off, the key can only create drafts and submit them for review.",
  "admin.pub.form.requireSignature": "Require signed requests",
  "admin.pub.form.requireSignature.hint":
    "Requests must include X-Wasfa-Timestamp and X-Wasfa-Signature (HMAC-SHA256). Signatures expire after five minutes and replayed requests are rejected.",
  "admin.pub.form.webhookUrl": "Webhook URL",
  "admin.pub.form.webhookUrl.hint": "Optional; must be public HTTPS. Content and media events are sent here.",
  "admin.pub.form.webhookSecret": "Webhook secret",
  "admin.pub.form.webhookSecret.hint": "At least 16 characters; used to sign each delivery and never shown again.",
  "admin.pub.signature.required": "Signed requests",
  "admin.pub.form.allowedTypes": "Allowed types",
  "admin.pub.form.allowedTypes.hint": "Select none to allow every type.",
  "admin.pub.form.categories": "Allowed categories (slugs)",
  "admin.pub.form.categories.hint": "Type a category slug and add it. Empty = any category.",
  "admin.pub.form.categories.add": "Add",
  "admin.pub.form.categories.remove": "Remove {slug}",
  "admin.pub.form.defaultAuthor": "Default author",
  "admin.pub.form.defaultAuthor.none": "No default author",
  "admin.pub.form.defaultAuthor.hint": "Used when a request names no author.",
  "admin.pub.form.defaultImage": "Default featured image",
  "admin.pub.form.defaultImage.hint":
    "Used when a request names no image, so the agent can publish without looking for one.",
  "admin.pub.form.defaultImage.choose": "Choose an image",
  "admin.pub.form.defaultImage.change": "Change the image",
  "admin.pub.form.defaultImage.clear": "Remove the image",
  "admin.pub.form.defaultImage.none": "No image chosen",
  "admin.pub.form.dailyCap": "Daily publish cap for this key",
  "admin.pub.form.dailyCap.globalOnly": "Global cap only",
  "admin.pub.form.dailyCap.hint":
    "Applies together with the global daily publish cap; the smaller one wins.",
  "admin.pub.form.rpm": "Requests per minute",
  "admin.pub.form.ipAllowList": "Allowed IP addresses",
  "admin.pub.form.ipAllowList.hint": "One address or CIDR range per line. Empty = any address.",
  "admin.pub.form.expiresInDays": "Key lifetime in days",
  "admin.pub.form.submitCreate": "Create the key",
  "admin.pub.form.submitEdit": "Save changes",
  "admin.pub.form.invalid":
    "Check the fields: the name needs 2 characters, at least one permission, and numbers within their limits.",
  "admin.pub.form.created": "Key created",
  "admin.pub.form.saved": "Changes saved",

  "admin.pub.secret.title": "Save the key now",
  "admin.pub.secret.warning":
    "This is the only time the full key is shown. It cannot be shown again; if it is lost you must rotate it or create a new key.",
  "admin.pub.secret.keyLabel": "Full key",
  "admin.pub.secret.endpointLabel": "API endpoint",
  "admin.pub.secret.messageLabel": "Ready-made message for Claude",
  "admin.pub.secret.messageHint": "It contains the full key, so share it only with your agent.",
  "admin.pub.secret.copy": "Copy",
  "admin.pub.secret.copied": "Copied",
  "admin.pub.secret.saved": "I saved it",
  "admin.pub.claudeMessage":
    "Use the Wasfa publishing API at {base}. Key: {key}. First read the guide at {base}/guide and follow it exactly. Write content as a draft and send me the preview link; only publish when I ask you to.",
  "admin.pub.claudeMessage.template":
    "Use the Wasfa publishing API at {base}. Key: (the key you created). First read the guide at {base}/guide and follow it exactly. Write content as a draft and send me the preview link; only publish when I ask you to.",

  "admin.pub.action.edit": "Edit",
  "admin.pub.action.rotate": "Rotate key",
  "admin.pub.action.revoke": "Revoke key",
  "admin.pub.action.requests": "Recent requests",
  "admin.pub.action.menu": "Actions for key {name}",
  "admin.pub.rotate.title": "Rotate the key {name}",
  "admin.pub.rotate.description":
    "Issues a new secret, shown once. The old one keeps working during the grace period so you can update your agent without downtime.",
  "admin.pub.rotate.graceHours": "Grace period (hours)",
  "admin.pub.rotate.graceHint": "0 = the old key stops immediately. Maximum {max} hours.",
  "admin.pub.rotate.confirm": "Rotate",
  "admin.pub.revoke.title": "Revoke the key {name}?",
  "admin.pub.revoke.description":
    "The key stops immediately and cannot be reactivated. Any agent using it will get a 401 error.",
  "admin.pub.revoke.confirm": "Revoke the key",
  "admin.pub.revoke.done": "Key revoked",

  "admin.pub.requests.title": "Recent requests of {name}",
  "admin.pub.requests.table": "Recent requests of the key",
  "admin.pub.requests.empty": "No requests from this key yet.",
  "admin.pub.requests.time": "Time",
  "admin.pub.requests.method": "Method",
  "admin.pub.requests.route": "Route",
  "admin.pub.requests.status": "Status",
  "admin.pub.requests.latency": "Latency",
  "admin.pub.requests.error": "Error code",
  "admin.pub.requests.ms": "{ms} ms",

  "admin.pub.connect.title": "Connect an AI agent",
  "admin.pub.connect.intro":
    "Let Claude or any other agent write Wasfa articles, upload their images and publish them through a dedicated API, with a key you control.",
  "admin.pub.connect.endpoint.title": "Endpoint and links",
  "admin.pub.connect.endpoint.base": "API endpoint (Base URL)",
  "admin.pub.connect.endpoint.openapi": "OpenAPI specification",
  "admin.pub.connect.endpoint.guide": "Agent guide",
  "admin.pub.connect.endpoint.copy": "Copy the endpoint",
  "admin.pub.connect.steps.title": "Quick start in four steps",
  "admin.pub.connect.step1.title": "Create a key",
  "admin.pub.connect.step1.body":
    "On the API keys page create a key named after the agent. Start with the basic permissions and without direct publishing. Copy the key as soon as it appears; it will not be shown again.",
  "admin.pub.connect.step2.title": "Give Claude the endpoint, the key and the guide link",
  "admin.pub.connect.step2.body":
    "Paste into the chat the ready-made message shown with the key, or copy the guide text below. The guide teaches the agent everything on its own.",
  "admin.pub.connect.step3.title": "Ask it to write",
  "admin.pub.connect.step3.body":
    'For example "write an article about migraines". The content stays a draft and the agent sends you a preview link to review before any publishing.',
  "admin.pub.connect.step4.title": 'Say "publish it"',
  "admin.pub.connect.step4.body":
    "Then the agent publishes or schedules, provided its key is allowed to publish. Content in medical categories always goes through a human reviewer: the agent requests review, and if it sends publish_on_approval the system publishes the article automatically the moment the reviewer approves.",
  "admin.pub.connect.guide.title": "Guide text to copy",
  "admin.pub.connect.guide.hint":
    "This is the current guide as the agent reads it. Copy it if your agent cannot open links.",
  "admin.pub.connect.guide.copy": "Copy the guide",
  "admin.pub.connect.guide.loading": "Loading the guide…",
  "admin.pub.connect.guide.error":
    "The guide text could not be loaded now. You can open it from the link directly.",
  "admin.pub.connect.guide.retry": "Try again",
  "admin.pub.connect.guide.open": "Open the guide",
  "admin.pub.connect.prompts.title": "Examples of what to tell Claude",
  "admin.pub.connect.prompt.1":
    "اقرأ الدليل ثم اكتب مقالًا شاملًا عن أعراض نقص فيتامين د، واحفظه كمسودة وأرسل لي رابط المعاينة.",
  "admin.pub.connect.prompt.2":
    "راجع المسودة التي كتبتها وتحقق من النص قبل الحفظ، ثم أصلح أي مشاكل تظهر في التحقق.",
  "admin.pub.connect.prompt.3":
    "انشر المقال الأخير الآن. إن كان تصنيفه طبيًا فأرسله للمراجعة وانشره تلقائيًا عند الاعتماد.",
  "admin.pub.connect.prompt.4":
    "اكتب ثلاثة مصطلحات جديدة للقاموس الطبي كمسودات مع صورة بارزة من المكتبة.",
  "admin.pub.connect.prompt.en1":
    "Read the guide, then write a thorough article about vitamin D deficiency symptoms. Save it as a draft and send me the preview link.",
  "admin.pub.connect.prompt.en2":
    "Publish the latest article now. If its category is medical, submit it for review and publish on approval.",
  "admin.pub.connect.prompt.copy": "Copy the example",
  "admin.pub.connect.trouble.title": "If it does not work",
  "admin.pub.connect.trouble.401":
    "401: the key is wrong, expired or revoked. Check it was copied in full or create another.",
  "admin.pub.connect.trouble.403":
    "403: the key lacks this permission, the IP address is not allowed, or the category is not allowed. Edit the key on the keys page.",
  "admin.pub.connect.trouble.429":
    "429: the key exceeded its requests per minute or the daily publish cap. Ask the agent to wait or raise the limit.",
  "admin.pub.connect.trouble.422":
    "422: the content failed validation (a missing field or an invalid link). Ask the agent to read the error message and fix it.",
  "admin.pub.connect.keysLink": "Manage API keys",
} satisfies Record<keyof typeof arAdminPublishing, string>;
