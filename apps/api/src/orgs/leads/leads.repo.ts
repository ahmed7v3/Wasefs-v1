import { Inject, Injectable } from "@nestjs/common";
import { contactMessages, deals, type NewContactMessage } from "@wasfa/db";

import { DB, type DbHandle } from "../../common/database.js";

/** The only place institution leads touch the database. */
@Injectable()
export class LeadsRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /**
   * Stores the lead as a contact message (the admin inbox) and opens a draft deal for it in one
   * transaction, so a lead never exists without the deal admins will work on. The deal's `notes`
   * point back to the message.
   */
  async create(
    message: NewContactMessage,
    deal: { name: string; createdBy: string | null },
  ): Promise<{ messageId: string; dealId: string }> {
    return this.handle.db.transaction(async (tx) => {
      const [stored] = await tx
        .insert(contactMessages)
        .values(message)
        .returning({ id: contactMessages.id });
      if (!stored) throw new Error("lead message insert returned no row");
      const [draft] = await tx
        .insert(deals)
        .values({
          name: deal.name,
          status: "draft",
          terms: {},
          notes: `lead:${stored.id}`,
          createdBy: deal.createdBy,
        })
        .returning({ id: deals.id });
      if (!draft) throw new Error("lead deal insert returned no row");
      return { messageId: stored.id, dealId: draft.id };
    });
  }
}
