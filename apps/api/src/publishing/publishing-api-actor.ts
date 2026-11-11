import type { PublishingPrincipal } from "./publishing-principal.js";
import type { ContentActorCtx } from "../content/items.service.js";

/*
 * The workflow actor an API key acts as. The key's scopes become content permissions; `content.review`
 * is never granted (a key cannot approve), `content.publish` only when the key may publish, and
 * `content.manage` only when a caller asks for it for the key's OWN item (archive). `isOwner` and
 * `isActiveReviewer` are always false: an API key is never the content owner, so none of the owner's
 * bypasses (review, four-eyes, blocking gates, daily cap) apply to it. `ContentWorkflowService.act`
 * re-enforces this for any machine actor.
 */

export function canPublishNow(principal: PublishingPrincipal): boolean {
  return principal.canPublish && principal.scopes.includes("content:publish");
}

export function apiActorFor(
  principal: PublishingPrincipal,
  extraPermissions: readonly string[] = [],
): ContentActorCtx {
  const permissions = new Set<string>(extraPermissions);
  if (principal.scopes.includes("content:read")) permissions.add("content.read");
  if (principal.scopes.includes("content:write")) {
    permissions.add("content.read");
    permissions.add("content.write");
  }
  if (canPublishNow(principal)) permissions.add("content.publish");
  return {
    // The owner's user id only satisfies the foreign keys of `submitted_by`; revisions carry the key id.
    userId: principal.ownerUserId,
    name: `API key: ${principal.keyName}`,
    permissions,
    isActiveReviewer: false,
    isOwner: false,
    machine: {
      type: "api_key",
      keyId: principal.keyId,
      dailyPublishCap: principal.dailyPublishCap,
    },
  };
}
