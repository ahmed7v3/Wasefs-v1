import type { ContentAction, ContentStatus } from "@wasfa/shared/content/constants";
import type { MessageKey } from "@wasfa/shared/i18n";

/*
 * Which button the top bar offers. The server computes `allowedActions` for THIS user with the
 * workflow state machine; the editor only decides which of them is the primary one and what the
 * unsaved state does to that: edits must be saved before anything else can act on them.
 */

export interface ActionContext {
  isNew: boolean;
  /** The draft differs from the loaded server copy. */
  dirty: boolean;
  status: ContentStatus;
  live: boolean;
  allowedActions: readonly ContentAction[];
  canWrite: boolean;
}

export type PrimaryAction =
  | { kind: "save"; label: MessageKey; disabled: boolean }
  | { kind: "action"; action: ContentAction; label: MessageKey };

/** Workflow actions that live in the overflow menu (the rest are Review-tab or primary buttons). */
export const OVERFLOW_ACTIONS = [
  "schedule",
  "unschedule",
  "unpublish",
  "archive",
  "unarchive",
] as const satisfies readonly ContentAction[];

export const ACTION_LABELS: Record<ContentAction, MessageKey> = {
  submit: "admin.editor.action.submit",
  approve: "admin.editor.action.approve",
  request_changes: "admin.editor.action.requestChanges",
  schedule: "admin.editor.action.schedule",
  unschedule: "admin.editor.action.unschedule",
  publish: "admin.editor.action.publish",
  unpublish: "admin.editor.action.unpublish",
  archive: "admin.editor.action.archive",
  unarchive: "admin.editor.action.unarchive",
};

export function derivePrimaryAction(ctx: ActionContext): PrimaryAction {
  if (ctx.isNew) return { kind: "save", label: "admin.editor.action.createDraft", disabled: false };
  if (ctx.dirty && ctx.canWrite) {
    return { kind: "save", label: "admin.editor.action.save", disabled: false };
  }
  const allowed = new Set(ctx.allowedActions);
  if (ctx.status === "in_review" && allowed.has("approve")) {
    return { kind: "action", action: "approve", label: "admin.editor.action.approve" };
  }
  if (ctx.status === "draft" && allowed.has("submit")) {
    return { kind: "action", action: "submit", label: "admin.editor.action.submit" };
  }
  if ((ctx.status === "draft" || ctx.status === "approved") && allowed.has("publish")) {
    return {
      kind: "action",
      action: "publish",
      label: ctx.live ? "admin.editor.action.update" : "admin.editor.action.publish",
    };
  }
  return { kind: "save", label: "admin.editor.action.save", disabled: true };
}

/** Overflow entries in menu order, only those the user may run now. */
export function overflowActions(allowed: readonly ContentAction[]): ContentAction[] {
  return OVERFLOW_ACTIONS.filter((action) => allowed.includes(action));
}

/** The reviewer controls need the permission AND a server-allowed action (a linked reviewer profile, a different person). */
export function canReviewNow(
  permissions: readonly string[],
  allowed: readonly ContentAction[],
): { approve: boolean; requestChanges: boolean } {
  const has = permissions.includes("content.review");
  return {
    approve: has && allowed.includes("approve"),
    requestChanges: has && allowed.includes("request_changes"),
  };
}
