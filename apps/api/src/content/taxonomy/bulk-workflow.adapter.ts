import type { ContentBulkPort } from "./bulk.port.js";
import type { AuthenticatedUser } from "../../common/current-user.js";
import type { ContentActorCtx } from "../items.service.js";
import type { ContentAction } from "@wasfa/shared/content/constants";
import type { ContentActionBody } from "@wasfa/shared/schemas/content";

/** The part of `ContentWorkflowService` the bulk actions use. */
export interface WorkflowActing {
  act(
    itemId: string,
    action: ContentAction,
    body: ContentActionBody,
    actor: ContentActorCtx,
  ): Promise<unknown>;
}

/** The part of `ContentItemsService` that turns the signed-in user into a workflow actor. */
export interface ActorResolving {
  actorFor(user: AuthenticatedUser): Promise<ContentActorCtx>;
}

/**
 * `ContentBulkPort` on top of the workflow's `act`: bulk schedule/unpublish/archive are the normal
 * actions, so every state rule, quality gate, publish cap and permission check applies per item.
 */
export class WorkflowBulkAdapter implements ContentBulkPort {
  constructor(
    private readonly workflow: WorkflowActing,
    private readonly actors: ActorResolving,
  ) {}

  async schedule(itemId: string, at: Date, user: AuthenticatedUser): Promise<void> {
    await this.workflow.act(
      itemId,
      "schedule",
      { at: at.toISOString() },
      await this.actors.actorFor(user),
    );
  }

  async unpublish(itemId: string, user: AuthenticatedUser): Promise<void> {
    await this.workflow.act(itemId, "unpublish", {}, await this.actors.actorFor(user));
  }

  async archive(
    itemId: string,
    redirectTo: string | undefined,
    user: AuthenticatedUser,
  ): Promise<void> {
    await this.workflow.act(
      itemId,
      "archive",
      redirectTo === undefined ? {} : { redirectTo },
      await this.actors.actorFor(user),
    );
  }
}
