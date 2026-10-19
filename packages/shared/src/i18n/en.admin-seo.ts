/* Settings > Search and discoverability (the `seo` key, SEO-GEO §13). */
export const enAdminSeo = {
  "admin.settings.group.seo": "Search and discoverability",
  "admin.settings.group.seo.description":
    "What shows in search engines and AI assistants, which crawlers may visit, and telling engines about new pages.",
  "admin.settings.seo.title": "Search and discoverability",
  "admin.settings.seo.description":
    "Default page title and description, site verification, the AI crawler policy and IndexNow pings. These values are public.",
  "admin.settings.section.seo.snippets": "Titles and previews",
  "admin.settings.section.seo.snippets.description":
    "How pages look in search results and when shared.",
  "admin.settings.section.seo.verification": "Site verification",
  "admin.settings.section.seo.verification.description":
    "Webmaster tool verification tokens, added to the meta tags of the home page.",
  "admin.settings.section.seo.aiCrawlers": "AI crawlers",
  "admin.settings.section.seo.aiCrawlers.description":
    "Allow or block each crawler on public pages. Search engines are always allowed and app pages are closed to everyone.",
  "admin.settings.section.seo.indexNow": "IndexNow pings",
  "admin.settings.section.seo.indexNow.description":
    "Tell Bing, Yandex and others when a page is published or changed. Needs a key; its file is published automatically.",
  "admin.settings.section.seo.llms": "llms.txt",
  "admin.settings.section.seo.llms.description":
    "A site summary written for AI models. Experimental and harmless.",
  "admin.settings.section.seo.reports": "Search reports",
  "admin.settings.section.seo.reports.description":
    "How reports split brand searches from the rest, and which hosts count as AI-assistant referrals.",
  "admin.settings.field.seo.titleTemplate": "Page title template",
  "admin.settings.help.seo.titleTemplate":
    'Must contain %s, replaced by the page title, for example "%s | Wasfa AI". Empty keeps the built-in template.',
  "admin.settings.field.seo.defaultDescription": "Default description",
  "admin.settings.help.seo.defaultDescription":
    "Used when a page has no description of its own. Up to 300 characters.",
  "admin.settings.field.seo.defaultOgImage": "Default preview image",
  "admin.settings.help.seo.defaultOgImage":
    "URL of a 1200x630 image shown when pages without a picture are shared.",
  "admin.settings.field.seo.verification": "Verification tokens",
  "admin.settings.field.seo.verification.google": "Google (Search Console)",
  "admin.settings.field.seo.verification.bing": "Bing (Webmaster Tools)",
  "admin.settings.field.seo.verification.yandex": "Yandex (Webmaster)",
  "admin.settings.help.seo.verification.google":
    "Only the content value of the google-site-verification tag, not the whole tag.",
  "admin.settings.field.seo.aiCrawlers": "Crawler access",
  "admin.settings.field.seo.aiCrawlers.GPTBot": "GPTBot — OpenAI: model training",
  "admin.settings.field.seo.aiCrawlers.OAI-SearchBot":
    "OAI-SearchBot — OpenAI: ChatGPT search results",
  "admin.settings.field.seo.aiCrawlers.ChatGPT-User":
    "ChatGPT-User — OpenAI: fetches triggered by a user",
  "admin.settings.field.seo.aiCrawlers.ClaudeBot": "ClaudeBot — Anthropic: model training",
  "admin.settings.field.seo.aiCrawlers.Claude-SearchBot":
    "Claude-SearchBot — Anthropic: Claude search",
  "admin.settings.field.seo.aiCrawlers.Claude-User":
    "Claude-User — Anthropic: fetches triggered by a user",
  "admin.settings.field.seo.aiCrawlers.PerplexityBot": "PerplexityBot — Perplexity: search index",
  "admin.settings.field.seo.aiCrawlers.Perplexity-User":
    "Perplexity-User — Perplexity: fetches triggered by a user",
  "admin.settings.field.seo.aiCrawlers.Google-Extended":
    "Google-Extended — Google: Gemini training and grounding (does not affect Search)",
  "admin.settings.field.seo.aiCrawlers.Applebot-Extended":
    "Applebot-Extended — Apple: allow use in Apple model training",
  "admin.settings.field.seo.aiCrawlers.CCBot":
    "CCBot — Common Crawl: archive used by many model builders",
  "admin.settings.field.seo.indexNow": "IndexNow",
  "admin.settings.field.seo.indexNow.enabled": "Send pings",
  "admin.settings.field.seo.indexNow.key": "Key",
  "admin.settings.help.seo.indexNow.key":
    "8 to 128 letters, digits or dashes. 32 random hex characters is a good choice.",
  "admin.settings.field.seo.llmsTxt": "llms.txt",
  "admin.settings.field.seo.llmsTxt.enabled": "Publish the file",
  "admin.settings.field.seo.brandRegex": "Brand pattern",
  "admin.settings.help.seo.brandRegex":
    'A case-insensitive regular expression such as "wasfa|وصفة". Matching searches count as brand searches.',
  "admin.settings.field.seo.aiReferrerHosts": "AI assistant hosts",
  "admin.settings.help.seo.aiReferrerHosts":
    "Visits arriving from these hosts count as AI referrals.",
} as const;
