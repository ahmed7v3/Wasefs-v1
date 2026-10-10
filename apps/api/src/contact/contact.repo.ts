import { Inject, Injectable } from "@nestjs/common";
import { contactMessages, type NewContactMessage } from "@wasfa/db";

import { DB, type DbHandle } from "../common/database.js";

/** The only place the contact form touches the database. */
@Injectable()
export class ContactRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async insert(message: NewContactMessage): Promise<void> {
    await this.handle.db.insert(contactMessages).values(message);
  }
}
