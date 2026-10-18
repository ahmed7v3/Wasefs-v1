import nodemailer from "nodemailer";

import type { WorkerEnv } from "../config/env.js";
import type { Redis } from "ioredis";

export interface OutgoingMail {
  /** `"Name" <address>` as the SMTP envelope sender. */
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Extra headers (only `List-Unsubscribe` / `List-Unsubscribe-Post` for marketing mail). */
  headers?: Record<string, string>;
}

export interface SentMail {
  messageId: string | null;
}

export interface EmailTransport {
  readonly kind: "smtp" | "capture";
  send: (mail: OutgoingMail) => Promise<SentMail>;
  close: () => void;
}

/** An SMTP answer of 5xx means this message will never be accepted; retrying cannot help. */
export class PermanentMailError extends Error {
  constructor(
    readonly smtpCode: number | null,
    message: string,
  ) {
    super(message);
    this.name = "PermanentMailError";
  }
}

/** SMTP relay (Brevo by default). TLS is required: a relay that offers no STARTTLS is refused. */
export class SmtpTransport implements EmailTransport {
  readonly kind = "smtp";
  private readonly transporter;

  constructor(options: {
    host: string;
    port: number;
    user: string | undefined;
    pass: string | undefined;
  }) {
    const implicitTls = options.port === 465;
    this.transporter = nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: implicitTls,
      requireTLS: !implicitTls,
      tls: { minVersion: "TLSv1.2" },
      ...(options.user !== undefined && options.pass !== undefined
        ? { auth: { user: options.user, pass: options.pass } }
        : {}),
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  }

  async send(mail: OutgoingMail): Promise<SentMail> {
    try {
      const info = await this.transporter.sendMail({
        from: mail.from,
        to: mail.to,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        ...(mail.headers ? { headers: mail.headers } : {}),
      });
      return { messageId: typeof info.messageId === "string" ? info.messageId : null };
    } catch (error) {
      throw classifySmtpError(error);
    }
  }

  close(): void {
    this.transporter.close();
  }
}

/**
 * Maps a nodemailer failure to a message that is safe to log and store. The upstream text can
 * contain the recipient address, so it is replaced by the code, never copied.
 */
export function classifySmtpError(error: unknown): Error {
  const code =
    typeof error === "object" && error !== null && "responseCode" in error
      ? Number((error as { responseCode: unknown }).responseCode)
      : Number.NaN;
  const kind =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "UNKNOWN";
  if (Number.isInteger(code) && code >= 500 && code < 600) {
    return new PermanentMailError(code, `SMTP rejected the message (${String(code)})`);
  }
  if (kind === "EAUTH") {
    // Wrong SMTP credentials: an operator problem, retrying the job will not fix it.
    return new PermanentMailError(null, "SMTP authentication failed");
  }
  return new Error(`SMTP delivery failed (${Number.isInteger(code) ? String(code) : kind})`);
}

export const CAPTURE_KEY = "mail:capture";
const CAPTURE_MAX = 50;
const CAPTURE_TTL_SECONDS = 600;

export interface CapturedMail extends OutgoingMail {
  capturedAt: string;
}

/**
 * Development and tests: keeps the last messages in Redis for 10 minutes instead of sending them,
 * so the verification link can be read from there. It refuses to exist in production.
 */
export class CaptureTransport implements EmailTransport {
  readonly kind = "capture";

  constructor(
    private readonly redis: Redis,
    nodeEnv: WorkerEnv["NODE_ENV"],
  ) {
    if (nodeEnv === "production") {
      throw new Error("CaptureTransport must not be used in production: configure SMTP_*");
    }
  }

  async send(mail: OutgoingMail): Promise<SentMail> {
    const captured: CapturedMail = { ...mail, capturedAt: new Date().toISOString() };
    await this.redis
      .multi()
      .lpush(CAPTURE_KEY, JSON.stringify(captured))
      .ltrim(CAPTURE_KEY, 0, CAPTURE_MAX - 1)
      .expire(CAPTURE_KEY, CAPTURE_TTL_SECONDS)
      .exec();
    return { messageId: null };
  }

  close(): void {
    // Nothing to release: the Redis connection belongs to the worker.
  }
}

/** Newest first. */
export async function readCapturedMail(redis: Redis): Promise<CapturedMail[]> {
  const rows = await redis.lrange(CAPTURE_KEY, 0, CAPTURE_MAX - 1);
  return rows.map((row) => JSON.parse(row) as CapturedMail);
}

export function createTransport(env: WorkerEnv, redis: Redis): EmailTransport {
  if (env.SMTP_HOST !== undefined) {
    return new SmtpTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    });
  }
  return new CaptureTransport(redis, env.NODE_ENV);
}
