/*
 * Content platform vocabulary (Phase 4, WP3; docs/CONTENT-PLATFORM.md). Pure constants and types: the DB
 * schema, the zod contracts, the workflow state machine and the UI all import from here, so a status or
 * permission can never drift between layers. Nothing in this file may import a runtime dependency.
 */

/** `monograph` is WP5 (its own table); the four below share `content_items`. */
export const CONTENT_TYPES = ["article", "guide", "glossary", "page"] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const CONTENT_LOCALES = ["ar", "en"] as const;
export type ContentLocale = (typeof CONTENT_LOCALES)[number];

/**
 * Status of the WORKING copy. Whether the public sees anything is a separate fact: an item is live
 * when `published_revision_id` is set. Editing a live item moves the working copy back to `draft`
 * while the public keeps seeing the published revision (CONTENT-PLATFORM §4.1).
 */
export const CONTENT_STATUSES = [
  "draft",
  "in_review",
  "approved",
  "scheduled",
  "published",
  "archived",
] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export const CONTENT_ACTIONS = [
  "submit",
  "approve",
  "request_changes",
  "schedule",
  "unschedule",
  "publish",
  "unpublish",
  "archive",
  "unarchive",
] as const;
export type ContentAction = (typeof CONTENT_ACTIONS)[number];

/** Where a revision came from; `autosave` never reaches `content_revisions` (see `content_autosaves`). */
export const REVISION_KINDS = [
  "create",
  "save",
  "submit",
  "approve",
  "publish",
  "restore",
  "api",
] as const;
export type RevisionKind = (typeof REVISION_KINDS)[number];

export const CONTENT_SOURCES = ["editor", "api"] as const;
export type ContentSource = (typeof CONTENT_SOURCES)[number];

export const PERSON_ROLES = ["author", "reviewer", "both"] as const;
export type PersonRole = (typeof PERSON_ROLES)[number];

export const REDIRECT_REASONS = ["slug_changed", "archived", "manual", "merged"] as const;
export type RedirectReason = (typeof REDIRECT_REASONS)[number];

/**
 * Permission keys WP3 adds to the RBAC catalog. `content.api_keys` ships with WP4 and `seo.*` with
 * WP5 (the catalog rule: a permission arrives in the phase that introduces the feature behind it).
 */
export const CONTENT_PERMISSIONS = [
  "content.read",
  "content.write",
  "content.publish",
  "content.review",
  "content.manage",
] as const;

/** Public URL prefix per type and locale: Arabic unprefixed, English under `/en` (SEO-GEO §2). */
export const CONTENT_PATH_PREFIX: Record<ContentType, string> = {
  article: "/blog",
  guide: "/guides",
  glossary: "/glossary",
  // Pages own arbitrary top-level paths (`/about`, `/features/x`); their slug IS the path below the root.
  page: "",
};

/** Gate ids of CONTENT-PLATFORM §6.2; the admin UI maps each to a message key `admin.content.gate.<id>`. */
export const QUALITY_GATE_IDS = [
  "required_fields",
  "medical_review",
  "min_words",
  "duplicate_content",
  "title_unique",
  "description_unique",
  "keyword_ownership",
  "headings",
  "internal_links",
  "broken_links",
  "external_sources",
  "image_alt",
  "image_size",
  "forbidden_claims",
  "personal_dosing",
  "readability",
] as const;
export type QualityGateId = (typeof QUALITY_GATE_IDS)[number];

/** `block` stops publish/schedule, `warn` is shown, `info` is a hint. Non-blocking gates never block. */
export type GateLevel = "block" | "warn" | "info";

/** Slug rule shared by API validation and the editor: lower-case ASCII words joined by single hyphens. */
export const CONTENT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const CONTENT_SLUG_MAX = 120;
/**
 * A `page` item owns a public path below the root (`about-us`, `features/new-feature`), so its slug is up
 * to three such words joined by `/`. Written with `[/]` (not `\/`) so the same source works inside a SQL
 * CHECK. Every other type keeps the single-segment `CONTENT_SLUG_PATTERN`.
 */
export const CONTENT_PAGE_SLUG_PATTERN =
  /^[a-z0-9]+(?:-[a-z0-9]+)*(?:[/][a-z0-9]+(?:-[a-z0-9]+)*){0,2}$/;
export const CONTENT_PAGE_SLUG_MAX = 250;

/**
 * First path segments a CMS page may never take: app and system routes, content sections with their own
 * templates, and the locale prefix. Static routes always win over the `[...slug]` catch-all, so a page
 * under one of these would be unreachable (or worse, look published while shadowed).
 */
export const CONTENT_RESERVED_ROOTS = [
  "admin",
  "api",
  "app",
  "dashboard",
  "analyze",
  "ai",
  "account",
  "billing",
  "checkout",
  "rewards",
  "org",
  "capture",
  "login",
  "register",
  "forgot-password",
  "reset-password",
  "verify-email",
  "onboarding",
  "blog",
  "guides",
  "glossary",
  "authors",
  "drugs",
  "preview",
  "en",
  "r",
  "c",
  "a",
  "assets",
  "healthz",
  "sitemap",
  "robots",
  "llms",
  "indexnow",
  "manifest",
  "favicon",
  "icon",
  "apple-touch-icon",
  "static",
  "public",
  "unsubscribe",
] as const;

/** Existing hand-written marketing pages: a CMS page cannot take their exact slug until they are migrated. */
export const CONTENT_RESERVED_PAGE_SLUGS = [
  "about",
  "pricing",
  "contact",
  "privacy",
  "terms",
  "disclaimer",
  "editorial-policy",
  "medical-review",
  "sources",
] as const;

/** Limits that bound a request before any rendering work (denial-of-wallet, AGENT §5.8). */
export const CONTENT_LIMITS = {
  titleMax: 200,
  excerptMax: 400,
  definitionMax: 300,
  bodyMdMax: 200_000,
  noteMax: 300,
  commentMax: 2_000,
  metaTitleMax: 120,
  metaDescriptionMax: 320,
  tagsPerItemMax: 12,
  secondaryKeywordsMax: 10,
  pageSizeMax: 24,
} as const;
