import { Inject, Injectable } from "@nestjs/common";
import { users } from "@wasfa/db";
import { eq } from "drizzle-orm";

import { DB, type DbHandle } from "../common/database.js";

import { EmailQueue } from "./email-queue.js";

import type { AuthMailer } from "../auth/mailer.js";
import type { Locale } from "@wasfa/shared/i18n";

/** The real `AuthMailer`: verification and reset links go to the worker through the email queue. */
@Injectable()
export class QueueMailer implements AuthMailer {
  constructor(
    private readonly emails: EmailQueue,
    @Inject(DB) private readonly handle: DbHandle,
  ) {}

  async sendVerificationEmail(message: { to: string; name: string; url: string }): Promise<void> {
    await this.emails.sendWithLink(
      "verify_email",
      { to: message.to, name: message.name, locale: await this.localeOf(message.to) },
      message.url,
    );
  }

  async sendPasswordResetEmail(message: { to: string; name: string; url: string }): Promise<void> {
    await this.emails.sendWithLink(
      "reset_password",
      { to: message.to, name: message.name, locale: await this.localeOf(message.to) },
      message.url,
    );
  }

  /** The account's language; a brand-new sign-up has the column default (Arabic). */
  private async localeOf(email: string): Promise<Locale> {
    const [row] = await this.handle.db
      .select({ locale: users.locale })
      .from(users)
      .where(eq(users.email, email));
    return row?.locale ?? "ar";
  }
}
