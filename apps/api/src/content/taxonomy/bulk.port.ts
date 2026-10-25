import type { AuthenticatedUser } from "../../common/current-user.js";

/**
 * What the bulk actions need from the editorial workflow, as a narrow port so this module does not
 * depend on the item/revision services. Each call applies the full workflow rules (state machine,
 * quality gates, publish cap, permissions of `actor`) and throws an `AppError` the bulk runner turns
 * into that item's `code`.
 */
export interface ContentBulkPort {
  schedule(itemId: string, at: Date, actor: AuthenticatedUser): Promise<void>;
  unpublish(itemId: string, actor: AuthenticatedUser): Promise<void>;
  archive(itemId: string, redirectTo: string | undefined, actor: AuthenticatedUser): Promise<void>;
}

export const CONTENT_BULK_PORT = Symbol("CONTENT_BULK_PORT");
