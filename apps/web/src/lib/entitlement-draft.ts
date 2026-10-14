import { AI_MODES, AI_TASKS, type AiMode, type AiTask } from "@wasfa/shared/ai";
import { t } from "@wasfa/shared/i18n";
import { RX_MAX_PAGES } from "@wasfa/shared/rx";
import {
  putEntitlementsSchema,
  type PlanEntitlementInput,
  type PlanEntitlementView,
} from "@wasfa/shared/schemas/plans";

import { isRxTask } from "./admin-billing";

/*
 * The entitlement editor's working copy (Task 2.5): one row per task, numbers typed as text. The
 * whole set is sent at once (`PUT /admin/plans/:id/entitlements` replaces it), so every task is
 * listed, allowed or not.
 */

export interface EntitlementDraft {
  task: AiTask;
  allowed: boolean;
  modes: AiMode[];
  /** Empty = unlimited. */
  dailyCap: string;
  monthlyCap: string;
  /** Rx tasks only; empty = the global limit. */
  maxPages: string;
  webSearch: boolean;
}

export function draftEntitlements(views: readonly PlanEntitlementView[]): EntitlementDraft[] {
  const byTask = new Map(views.map((view) => [view.task, view]));
  return AI_TASKS.map((task) => {
    const view = byTask.get(task);
    return {
      task,
      allowed: view?.allowed ?? false,
      modes: view ? AI_MODES.filter((mode) => view.modes.includes(mode)) : [],
      dailyCap: view?.dailyCap == null ? "" : String(view.dailyCap),
      monthlyCap: view?.monthlyCap == null ? "" : String(view.monthlyCap),
      maxPages: view && isRxTask(task) ? String(view.maxPagesPerRx) : "",
      webSearch: view?.webSearch ?? false,
    };
  });
}

const optionalNumber = (text: string): number | null => (text.trim() === "" ? null : Number(text));

export function entitlementsBody(drafts: readonly EntitlementDraft[]): unknown[] {
  return drafts.map((draft) => ({
    task: draft.task,
    allowed: draft.allowed,
    modes: AI_MODES.filter((mode) => draft.modes.includes(mode)),
    dailyCap: optionalNumber(draft.dailyCap),
    monthlyCap: optionalNumber(draft.monthlyCap),
    maxPagesPerRx: isRxTask(draft.task) ? optionalNumber(draft.maxPages) : null,
    webSearch: draft.webSearch,
  }));
}

export interface EntitlementValidation {
  body: PlanEntitlementInput[] | null;
  /** One message per task (the first problem of its row). */
  errors: Partial<Record<AiTask, string>>;
}

export function validateEntitlements(drafts: readonly EntitlementDraft[]): EntitlementValidation {
  const result = putEntitlementsSchema.safeParse(entitlementsBody(drafts));
  if (result.success) return { body: result.data, errors: {} };
  const errors: Partial<Record<AiTask, string>> = {};
  for (const issue of result.error.issues) {
    const [index, field] = issue.path;
    const draft = typeof index === "number" ? drafts[index] : undefined;
    if (!draft || Object.hasOwn(errors, draft.task)) continue;
    errors[draft.task] =
      field === "modes"
        ? t("admin.plans.error.needMode")
        : field === "maxPagesPerRx"
          ? t("admin.plans.error.pages", { max: RX_MAX_PAGES })
          : t("admin.plans.error.cap");
  }
  return { body: null, errors };
}
