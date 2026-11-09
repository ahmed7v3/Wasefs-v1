import { PUBLISHING_API_BASE } from "@wasfa/shared/publishing";
import {
  publishingKeyInputSchema,
  publishingKeyUpdatableFields,
  type PublishingKey,
  type PublishingKeyInput,
} from "@wasfa/shared/schemas/admin-publishing-keys";

import { publicEnv } from "./env";

/* Pure helpers of the Publishing API admin pages (keys list, create/edit form, connect page). */

/** A key within this many days of its expiry is "expiring soon". */
export const EXPIRING_SOON_DAYS = 14;

export type PublishingKeyStatus = "active" | "expiring" | "expired" | "revoked";

export function keyStatus(key: PublishingKey, now: Date = new Date()): PublishingKeyStatus {
  if (key.revokedAt) return "revoked";
  const left = new Date(key.expiresAt).getTime() - now.getTime();
  if (left <= 0) return "expired";
  return left <= EXPIRING_SOON_DAYS * 86_400_000 ? "expiring" : "active";
}

/** `wsk_live_xxxx…last4`: recognisable, never usable. */
export function maskedKey(key: Pick<PublishingKey, "prefix" | "last4">): string {
  return `${key.prefix}…${key.last4}`;
}

/** Base URL of the Publishing API, from the same API URL the web app uses. */
export function publishingBaseUrl(): string {
  return `${publicEnv.NEXT_PUBLIC_API_URL.replace(/\/+$/, "")}${PUBLISHING_API_BASE}`;
}

/** The form keeps numbers as text so a half-typed value is not coerced. */
export interface PublishingKeyFormValues {
  name: string;
  environment: PublishingKeyInput["environment"];
  scopes: PublishingKeyInput["scopes"];
  canPublish: boolean;
  allowedTypes: PublishingKeyInput["allowedTypes"];
  allowedCategorySlugs: string[];
  defaultAuthorId: string | null;
  defaultFeaturedMediaId: string | null;
  /** Label of the chosen image (file name or id): the schema only keeps the id. */
  defaultFeaturedMediaLabel: string | null;
  globalCapOnly: boolean;
  dailyPublishCap: string;
  requestsPerMinute: string;
  ipAllowList: string;
  expiresInDays: string;
}

export const emptyKeyForm = (): PublishingKeyFormValues => ({
  name: "",
  environment: "live",
  scopes: ["content:read", "content:write"],
  canPublish: false,
  allowedTypes: [],
  allowedCategorySlugs: [],
  defaultAuthorId: null,
  defaultFeaturedMediaId: null,
  defaultFeaturedMediaLabel: null,
  globalCapOnly: true,
  dailyPublishCap: "25",
  requestsPerMinute: "60",
  ipAllowList: "",
  expiresInDays: "365",
});

export function formFromKey(key: PublishingKey): PublishingKeyFormValues {
  return {
    ...emptyKeyForm(),
    name: key.name,
    environment: key.environment,
    scopes: key.scopes,
    canPublish: key.canPublish,
    allowedTypes: key.allowedTypes,
    allowedCategorySlugs: key.allowedCategorySlugs,
    defaultAuthorId: key.defaultAuthorId,
    defaultFeaturedMediaId: key.defaultFeaturedMediaId,
    defaultFeaturedMediaLabel: key.defaultFeaturedMediaId,
    globalCapOnly: key.dailyPublishCap === null,
    dailyPublishCap: key.dailyPublishCap === null ? "25" : String(key.dailyPublishCap),
    requestsPerMinute: String(key.requestsPerMinute),
    ipAllowList: key.ipAllowList.join("\n"),
  };
}

const splitLines = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");

const toNumber = (text: string): number => (text.trim() === "" ? Number.NaN : Number(text));

/** The create payload, checked with the shared schema; `null` when a field is out of its limits. */
export function parseKeyForm(values: PublishingKeyFormValues): PublishingKeyInput | null {
  const parsed = publishingKeyInputSchema.safeParse({
    name: values.name,
    environment: values.environment,
    scopes: values.scopes,
    canPublish: values.canPublish,
    allowedTypes: values.allowedTypes,
    allowedCategorySlugs: values.allowedCategorySlugs,
    defaultAuthorId: values.defaultAuthorId,
    defaultFeaturedMediaId: values.defaultFeaturedMediaId,
    dailyPublishCap: values.globalCapOnly ? null : toNumber(values.dailyPublishCap),
    requestsPerMinute: toNumber(values.requestsPerMinute),
    ipAllowList: splitLines(values.ipAllowList),
    expiresInDays: toNumber(values.expiresInDays),
  });
  return parsed.success ? parsed.data : null;
}

/** The PATCH body: only the updatable fields (the environment and expiry never change). */
export function patchBody(
  input: PublishingKeyInput,
): Pick<PublishingKeyInput, (typeof publishingKeyUpdatableFields)[number]> {
  return {
    name: input.name,
    scopes: input.scopes,
    canPublish: input.canPublish,
    allowedTypes: input.allowedTypes,
    allowedCategorySlugs: input.allowedCategorySlugs,
    defaultAuthorId: input.defaultAuthorId,
    defaultFeaturedMediaId: input.defaultFeaturedMediaId,
    dailyPublishCap: input.dailyPublishCap,
    requestsPerMinute: input.requestsPerMinute,
    ipAllowList: input.ipAllowList,
  };
}
