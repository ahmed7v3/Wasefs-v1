/*
 * Constants of the Publishing API (docs/PUBLISHING-API.md): the machine interface AI agents and
 * automations use to create, validate, illustrate and publish content with a `wsk_` key.
 */

export const PUBLISHING_API_BASE = "/publishing/v1";

export const PUBLISHING_SCOPES = [
  "content:read",
  "content:write",
  "content:publish",
  "media:write",
  "taxonomy:write",
  "people:read",
] as const;
export type PublishingScope = (typeof PUBLISHING_SCOPES)[number];

/** Types a key may write (pages are not writable through the API). */
export const PUBLISHING_CONTENT_TYPES = ["article", "guide", "glossary"] as const;
export type PublishingContentType = (typeof PUBLISHING_CONTENT_TYPES)[number];

export const PUBLISHING_KEY_ENVIRONMENTS = ["live", "test"] as const;

export const PUBLISHING_DEFAULTS = {
  requestsPerMinute: 60,
  createdPerDay: 1_000,
  publishesPerDay: 25,
  keyTtlDays: 365,
  keyTtlMaxDays: 730,
  rotateGraceHours: 24,
  rotateGraceMaxHours: 168,
  idempotencyTtlHours: 24,
  maxBodyBytes: 1_000_000,
  maxMarkdownBytes: 200_000,
} as const;

/**
 * A key is `wsk_<live|test>_<keyId>_<secret>`: `keyId` is public (looked up), `secret` is shown once and
 * only a keyed hash of it is stored. The pieces never contain `_`.
 */
export const PUBLISHING_KEY_PATTERN = /^wsk_(live|test)_([A-Za-z0-9]{12})_([A-Za-z0-9]{40,64})$/;

export interface ParsedPublishingKey {
  environment: "live" | "test";
  keyId: string;
  secret: string;
}

export function parsePublishingKey(raw: string): ParsedPublishingKey | null {
  const match = PUBLISHING_KEY_PATTERN.exec(raw.trim());
  if (!match) return null;
  return { environment: match[1] as "live" | "test", keyId: match[2] ?? "", secret: match[3] ?? "" };
}

export function formatPublishingKey(
  environment: "live" | "test",
  keyId: string,
  secret: string,
): string {
  return `wsk_${environment}_${keyId}_${secret}`;
}
