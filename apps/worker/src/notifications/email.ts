import { createHmac } from "node:crypto";

import { SecretDecryptionError, decodeEncryptionKey, decryptSecret } from "@wasfa/shared/crypto";
import { emailSecretContext, isCriticalEmail } from "@wasfa/shared/email";
import { UnrecoverableError } from "bullmq";

import { DeferJob } from "../defer.js";

import { MailCapGuard } from "./cap-guard.js";
import { renderEmail, type TemplateInput } from "./templates/index.js";
import { PermanentMailError, createTransport, type EmailTransport } from "./transport.js";

import type { WorkerEnv } from "../config/env.js";
import type { JobContext } from "../queues.js";
import type { EmailSendPayload } from "@wasfa/shared/email";
import type { Redis } from "ioredis";
import type { Logger } from "pino";

/** Everything the email job needs besides the payload, built once at start-up. */
export interface EmailRuntime {
  transport: EmailTransport;
  from: string;
  cap: MailCapGuard;
  /** Decrypts job links and keys the recipient hash used in logs. */
  key: Buffer;
}

export function createEmailRuntime(env: WorkerEnv, redis: Redis, logger: Logger): EmailRuntime {
  const key = decodeEncryptionKey(env.ENCRYPTION_KEY);
  return {
    transport: createTransport(env, redis),
    from: env.MAIL_FROM,
    cap: new MailCapGuard(redis, env.MAIL_DAILY_CAP, logger),
    key,
  };
}

/** Stable pseudonym for the log line: lets support correlate sends without storing the address. */
export function recipientHash(key: Buffer, to: string): string {
  return createHmac("sha256", key).update(`mail-recipient:${to}`).digest("hex").slice(0, 16);
}

function templateInput(payload: EmailSendPayload, key: Buffer): TemplateInput {
  if (payload.template === "account_suspended") {
    return { template: payload.template, locale: payload.locale, name: payload.name };
  }
  let link: string;
  try {
    link = decryptSecret(payload.encryptedLink, key, emailSecretContext(payload.template));
  } catch (error) {
    // Wrong key or tampered job: retrying cannot help. Say nothing about the content.
    if (error instanceof SecretDecryptionError) {
      throw new UnrecoverableError("Email link could not be decrypted");
    }
    throw error;
  }
  if (payload.template === "org_invite") {
    return {
      template: payload.template,
      locale: payload.locale,
      name: payload.name,
      link,
      orgName: payload.orgName,
      inviterName: payload.inviterName,
    };
  }
  return { template: payload.template, locale: payload.locale, name: payload.name, link };
}

/**
 * `email.send`: renders the template, takes a slot from the daily cap, and hands the message to the
 * transport. One log line per send, with the recipient hashed. Failures keep the SMTP code but never
 * the provider's text (it can echo the address), and a 5xx answer is permanent: no retries.
 */
export async function emailSendJob(
  payload: EmailSendPayload,
  { logger, email }: JobContext,
): Promise<void> {
  const rendered = renderEmail(templateInput(payload, email.key));
  const critical = isCriticalEmail(payload.template);
  const recipient = recipientHash(email.key, payload.to);

  const decision = await email.cap.reserve(critical);
  if (!decision.allowed) {
    logger.info(
      { template: payload.template, recipient, retryAt: new Date(decision.retryAt).toISOString() },
      "Email deferred: daily cap reached",
    );
    throw new DeferJob(decision.retryAt, "mail daily cap");
  }

  try {
    const sent = await email.transport.send({
      from: email.from,
      to: payload.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
    logger.info(
      {
        template: payload.template,
        locale: payload.locale,
        recipient,
        transport: email.transport.kind,
        messageId: sent.messageId,
      },
      "Email sent",
    );
  } catch (error) {
    await email.cap.release(decision);
    const permanent = error instanceof PermanentMailError;
    logger.warn(
      {
        template: payload.template,
        recipient,
        permanent,
        smtpCode: permanent ? error.smtpCode : null,
      },
      "Email send failed",
    );
    if (permanent) throw new UnrecoverableError(error.message);
    throw error instanceof Error ? new Error(error.message) : new Error("Email send failed");
  }
}
