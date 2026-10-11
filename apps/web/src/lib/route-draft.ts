import { t, type MessageKey } from "@wasfa/shared/i18n";
import {
  routeModelsSchema,
  type RouteModelParams,
  type RouteView,
} from "@wasfa/shared/schemas/admin-ai";

import { describeIssue } from "./forms";

/*
 * The route editor's working copy (Task 2.5). Inputs are strings while the admin types; `validateRoute`
 * turns them into the body the API accepts, running the SAME shared schema, and reports problems per
 * item (the API names an offending item by `details.index` the same way).
 */

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high"] as const;
export const MEDIA_RESOLUTIONS = ["low", "medium", "high", "ultra_high"] as const;

export interface RouteItemDraft {
  /** Stable identity across reordering, so the focused control survives a move. */
  key: string;
  /** `ai_models.id`; empty until a model is picked. */
  modelId: string;
  /** Empty = the provider default. */
  thinking: string;
  mediaResolution: string;
  temperature: string;
  maxOutputTokens: string;
  search: boolean;
  jsonSchema: boolean;
}

let sequence = 0;
const nextKey = () => `item-${String(++sequence)}`;

export function emptyItem(): RouteItemDraft {
  return {
    key: nextKey(),
    modelId: "",
    thinking: "",
    mediaResolution: "",
    temperature: "",
    maxOutputTokens: "",
    search: false,
    jsonSchema: false,
  };
}

export function draftFromRoute(models: RouteView["models"]): RouteItemDraft[] {
  if (models.length === 0) return [emptyItem()];
  return models.map((entry) => ({
    key: nextKey(),
    modelId: entry.modelId,
    thinking: entry.params.thinking ?? "",
    mediaResolution: entry.params.mediaResolution ?? "",
    temperature: entry.params.temperature === undefined ? "" : String(entry.params.temperature),
    maxOutputTokens:
      entry.params.maxOutputTokens === undefined ? "" : String(entry.params.maxOutputTokens),
    search: entry.params.search === true,
    jsonSchema: entry.params.jsonSchema === true,
  }));
}

/** A copy of the list with the item at `from` moved to `to`. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return next;
  next.splice(to, 0, moved);
  return next;
}

/** Only what was set: an unset control means "the provider default", so it is left out of the params. */
function paramsOf(item: RouteItemDraft, rx: boolean): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  if (item.thinking !== "") params["thinking"] = item.thinking;
  if (rx && item.mediaResolution !== "") params["mediaResolution"] = item.mediaResolution;
  if (item.temperature.trim() !== "") params["temperature"] = Number(item.temperature);
  if (item.maxOutputTokens.trim() !== "") params["maxOutputTokens"] = Number(item.maxOutputTokens);
  if (item.search) params["search"] = true;
  if (item.jsonSchema) params["jsonSchema"] = true;
  return params;
}

export function routeBody(
  items: readonly RouteItemDraft[],
  rx: boolean,
): { modelId: string; params: Record<string, unknown> }[] {
  return items.map((item) => ({ modelId: item.modelId, params: paramsOf(item, rx) }));
}

export interface RouteValidation {
  /** The accepted `models` array; `null` when something is wrong. */
  models: { modelId: string; params: RouteModelParams }[] | null;
  /** Message per item key. */
  itemErrors: Record<string, string>;
  /** A problem of the list as a whole (a model used twice). */
  listError: string | null;
}

const PARAM_MESSAGES: Record<string, MessageKey> = {
  temperature: "admin.routes.error.temperature",
  maxOutputTokens: "admin.routes.error.maxOutputTokens",
};

export function validateRoute(items: readonly RouteItemDraft[], rx: boolean): RouteValidation {
  const result = routeModelsSchema.safeParse(routeBody(items, rx));
  if (result.success) return { models: result.data, itemErrors: {}, listError: null };

  const itemErrors: Record<string, string> = {};
  let listError: string | null = null;
  for (const issue of result.error.issues) {
    const [index, field, param] = issue.path;
    const item = typeof index === "number" ? items[index] : undefined;
    if (!item) {
      listError ??= t("admin.routes.error.duplicate");
      continue;
    }
    if (Object.hasOwn(itemErrors, item.key)) continue;
    if (field === "modelId") {
      itemErrors[item.key] = describeIssue(issue, item.modelId);
    } else {
      const key = typeof param === "string" ? PARAM_MESSAGES[param] : undefined;
      itemErrors[item.key] = key ? t(key) : t("form.invalid");
    }
  }
  // `Number("abc")` is NaN, which the schema reports as a type error: same message as a bad range.
  return { models: null, itemErrors, listError };
}

/** The message of an API reason that points at one item (`details.index`). */
export const ROUTE_ITEM_REASONS: Record<string, MessageKey> = {
  unknown_model: "admin.routes.reason.unknown_model",
  primary_disabled: "admin.routes.reason.primary_disabled",
  missing_capability: "admin.routes.reason.missing_capability",
  free_tier_medical: "admin.routes.reason.free_tier_medical",
  preview_not_allowed: "admin.routes.reason.preview_not_allowed",
};
