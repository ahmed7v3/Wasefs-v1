import { z } from "zod";

import { LOCALES } from "./i18n/index.js";

/*
 * Transactional email: what the api may ask the worker to send. Templates are keyed, never free
 * text, so a compromised producer cannot make the worker mail arbitrary content from our domain.
 */

export const EMAIL_TEMPLATES = [
  "verify_email",
  "reset_password",
  "org_invite",
  "account_suspended",
  "payment_receipt",
  "billing_payment_rejected",
  "billing_payment_resubmit",
  "admin_alert",
  "alert_digest",
] as const;
export type EmailTemplate = (typeof EMAIL_TEMPLATES)[number];

/**
 * Mail a person is waiting for right now. Under the daily provider cap these still go out, while the
 * rest (invites, notices) wait for the next day.
 */
export const CRITICAL_EMAIL_TEMPLATES: readonly EmailTemplate[] = [
  "verify_email",
  "reset_password",
];

export function isCriticalEmail(template: EmailTemplate): boolean {
  return CRITICAL_EMAIL_TEMPLATES.includes(template);
}

/** AAD for `encryptSecret`: a link encrypted for one template cannot be replayed into another. */
export function emailSecretContext(template: EmailTemplate): string {
  return `email:${template}`;
}

const recipient = {
  to: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  name: z.string().trim().max(100).default(""),
  locale: z.enum(LOCALES).default("ar"),
};

/**
 * Links carry a token (verify, reset, invite), so they travel encrypted with `ENCRYPTION_KEY`
 * (`encryptSecret`, context `email:<template>`): job data sits in Redis and in failed-job history.
 */
const encryptedLink = z.string().min(1).max(4_096);

export const emailSendPayloadSchema = z.discriminatedUnion("template", [
  z.object({ template: z.literal("verify_email"), ...recipient, encryptedLink }),
  z.object({ template: z.literal("reset_password"), ...recipient, encryptedLink }),
  z.object({
    template: z.literal("org_invite"),
    ...recipient,
    encryptedLink,
    orgName: z.string().trim().min(1).max(120),
    inviterName: z.string().trim().max(100).default(""),
  }),
  z.object({ template: z.literal("account_suspended"), ...recipient }),
  // No secret inside: the link opens the order page, which needs the owner's session anyway.
  z.object({
    template: z.literal("payment_receipt"),
    ...recipient,
    orderNumber: z.string().min(1).max(40),
    totalMinor: z.number().int().min(0),
    currency: z.string().regex(/^[A-Z]{3}$/),
    taxAndFeesMinor: z.number().int().min(0).default(0),
    link: z.url().max(2_048),
  }),
  z.object({
    template: z.literal("billing_payment_rejected"),
    ...recipient,
    orderNumber: z.string().min(1).max(40),
    reason: z.string().min(1).max(64),
    note: z.string().max(500).nullable().optional(),
    link: z.url().max(2_048),
  }),
  z.object({
    template: z.literal("billing_payment_resubmit"),
    ...recipient,
    orderNumber: z.string().min(1).max(40),
    note: z.string().max(500).nullable().optional(),
    link: z.url().max(2_048),
  }),
  z.object({
    template: z.literal("admin_alert"),
    ...recipient,
    summary: z.string().trim().min(1).max(500),
    link: z.url().max(2_048),
  }),
  z.object({
    template: z.literal("alert_digest"),
    ...recipient,
    count: z.number().int().min(1),
    summaries: z.array(z.string().trim().min(1).max(500)).max(5),
    link: z.url().max(2_048),
  }),
]);

export type EmailSendInput = z.input<typeof emailSendPayloadSchema>;
export type EmailSendPayload = z.output<typeof emailSendPayloadSchema>;
