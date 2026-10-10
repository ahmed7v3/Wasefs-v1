import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { encryptSecret } from "@wasfa/shared/crypto";
import {
  emailSecretContext,
  emailSendPayloadSchema,
  type EmailSendInput,
  type EmailTemplate,
} from "@wasfa/shared/email";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

import { REDIS } from "../common/redis.js";
import { API_ENV } from "../config/config.module.js";
import { encryptionKey, type ApiEnv } from "../config/env.js";

import type { Locale } from "@wasfa/shared/i18n";

/** Mail is worth more patience than the default 3 tries: a provider blip must not lose a verification link. */
const EMAIL_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: "exponential", delay: 10_000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 1_000 },
} as const;

interface Recipient {
  to: string;
  name?: string;
  locale?: Locale;
}

/**
 * The api's only way to send mail: it puts an `email.send` job on the `notifications` queue and the
 * worker does the rest. Links that carry a token are encrypted here (AAD `email:<template>`) so the
 * token never sits in Redis in clear. The payload is validated before it is queued, so a bad call
 * fails in the caller, not silently in the worker.
 */
@Injectable()
export class EmailQueue implements OnApplicationShutdown {
  private readonly queue: Queue;
  private readonly key: Buffer;

  constructor(@Inject(REDIS) redis: Redis, @Inject(API_ENV) env: ApiEnv) {
    this.queue = new Queue("notifications", { connection: redis });
    this.key = encryptionKey(env);
  }

  /** Verify, reset and invite mail: one button, one link. */
  async sendWithLink(
    template: Extract<EmailTemplate, "verify_email" | "reset_password">,
    recipient: Recipient,
    link: string,
  ): Promise<void> {
    await this.enqueue({
      template,
      ...recipient,
      encryptedLink: encryptSecret(link, this.key, emailSecretContext(template)),
    });
  }

  async sendOrgInvite(
    recipient: Recipient,
    invite: { link: string; orgName: string; inviterName?: string },
  ): Promise<void> {
    await this.enqueue({
      template: "org_invite",
      ...recipient,
      orgName: invite.orgName,
      ...(invite.inviterName === undefined ? {} : { inviterName: invite.inviterName }),
      encryptedLink: encryptSecret(invite.link, this.key, emailSecretContext("org_invite")),
    });
  }

  async sendAccountSuspended(recipient: Recipient): Promise<void> {
    await this.enqueue({ template: "account_suspended", ...recipient });
  }

  private async enqueue(input: EmailSendInput): Promise<void> {
    // Throws a ZodError naming the bad field if a caller built a wrong payload.
    const payload = emailSendPayloadSchema.parse(input);
    await this.queue.add("email.send", payload, EMAIL_JOB_OPTIONS);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}
