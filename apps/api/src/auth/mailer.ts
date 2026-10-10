import type { PinoLogger } from "nestjs-pino";

/** What the auth module needs to send. The real implementation enqueues a job for the worker (Task 1.4). */
export interface AuthMailer {
  sendVerificationEmail: (message: { to: string; name: string; url: string }) => Promise<void>;
  sendPasswordResetEmail: (message: { to: string; name: string; url: string }) => Promise<void>;
}

export const AUTH_MAILER = Symbol("AUTH_MAILER");

/**
 * Used until the worker-backed mailer exists. It sends nothing and says so loudly, so a deployment
 * that forgot to wire mail shows up in the logs instead of silently dropping verification links.
 */
export class UnconfiguredMailer implements AuthMailer {
  constructor(private readonly logger: PinoLogger) {}

  sendVerificationEmail(): Promise<void> {
    this.logger.error("No AuthMailer is configured: a verification email was NOT sent");
    return Promise.resolve();
  }

  sendPasswordResetEmail(): Promise<void> {
    this.logger.error("No AuthMailer is configured: a password reset email was NOT sent");
    return Promise.resolve();
  }
}
