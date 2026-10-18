import { PAYMENT_REJECT_REASONS } from "@wasfa/shared/billing";
import { formatMoney } from "@wasfa/shared/money";

import { assertWebLink, renderLayout, tr, type Rendered } from "./layout.js";

import type { WithdrawalMailEvent } from "@wasfa/shared/email";
import type { GrowthMailKind } from "@wasfa/shared/growth";
import type { MessageKey, Locale } from "@wasfa/shared/i18n";
import type { SubscriptionReminderSlot } from "@wasfa/shared/subscriptions";

export type { Rendered } from "./layout.js";

/** What a template needs once the link has been decrypted. */
export type TemplateInput =
  | { template: "verify_email" | "reset_password"; locale: Locale; name: string; link: string }
  | {
      template: "org_invite";
      locale: Locale;
      name: string;
      link: string;
      orgName: string;
      inviterName: string;
    }
  | { template: "account_suspended"; locale: Locale; name: string }
  | {
      template: "payment_receipt";
      locale: Locale;
      name: string;
      link: string;
      orderNumber: string;
      totalMinor: number;
      currency: string;
      taxAndFeesMinor: number;
    }
  | {
      template: "admin_alert";
      locale: Locale;
      name: string;
      summary: string;
      link: string;
    }
  | {
      template: "subscription_reminder";
      locale: Locale;
      name: string;
      slot: SubscriptionReminderSlot;
      planName: string;
      endsAt: string;
      link: string;
    }
  | {
      template: "alert_digest";
      locale: Locale;
      name: string;
      count: number;
      summaries: string[];
      link: string;
    }
  | {
      template: "billing_payment_rejected";
      locale: Locale;
      name: string;
      orderNumber: string;
      reason: string;
      note?: string | null;
      link: string;
    }
  | {
      template: "billing_payment_resubmit";
      locale: Locale;
      name: string;
      orderNumber: string;
      note?: string | null;
      link: string;
    }
  | {
      template: "withdrawal_update";
      locale: Locale;
      name: string;
      event: WithdrawalMailEvent;
      points: number;
      amountMinor: number;
      currency: string;
      reference?: string | null;
      reason?: string | null;
      note?: string | null;
      link: string;
    }
  | {
      template: "lifecycle_mail";
      locale: Locale;
      name: string;
      kind: GrowthMailKind;
      params: Record<string, string | number>;
      link: string;
      unsubscribeUrl: string;
      oneClickUrl: string;
    };

/** Arabic-first RTL HTML plus a plain-text alternative for every template. */
export function renderEmail(input: TemplateInput): Rendered {
  const { locale, name } = input;
  switch (input.template) {
    case "verify_email":
      return renderLayout({
        locale,
        name,
        subject: tr(locale, "email.verify.subject"),
        block: {
          paragraphs: [tr(locale, "email.verify.intro")],
          action: { label: tr(locale, "email.verify.button"), link: assertWebLink(input.link) },
          note: tr(locale, "email.verify.expires"),
          ignoreNote: true,
        },
      });
    case "reset_password":
      return renderLayout({
        locale,
        name,
        subject: tr(locale, "email.reset.subject"),
        block: {
          paragraphs: [tr(locale, "email.reset.intro")],
          action: { label: tr(locale, "email.reset.button"), link: assertWebLink(input.link) },
          note: tr(locale, "email.reset.expires"),
          ignoreNote: true,
        },
      });
    case "org_invite":
      return renderLayout({
        locale,
        name,
        subject: tr(locale, "email.invite.subject", { org: input.orgName }),
        block: {
          paragraphs: [
            input.inviterName === ""
              ? tr(locale, "email.invite.intro", { org: input.orgName })
              : tr(locale, "email.invite.introWithInviter", {
                  org: input.orgName,
                  inviter: input.inviterName,
                }),
          ],
          action: { label: tr(locale, "email.invite.button"), link: assertWebLink(input.link) },
          note: tr(locale, "email.invite.expires"),
          ignoreNote: true,
        },
      });
    case "account_suspended":
      return renderLayout({
        locale,
        name,
        subject: tr(locale, "email.suspended.subject"),
        block: {
          paragraphs: [tr(locale, "email.suspended.intro"), tr(locale, "email.suspended.contact")],
          ignoreNote: false,
        },
      });
    case "payment_receipt": {
      const money = (minor: number) => formatMoney(minor, input.currency, locale);
      const paragraphs = [
        tr(locale, "email.receipt.intro", { number: input.orderNumber }),
        tr(locale, "email.receipt.total", { total: money(input.totalMinor) }),
      ];
      if (input.taxAndFeesMinor > 0) {
        paragraphs.push(
          tr(locale, "email.receipt.taxAndFees", { amount: money(input.taxAndFeesMinor) }),
        );
      }
      return renderLayout({
        locale,
        name,
        subject: tr(locale, "email.receipt.subject", { number: input.orderNumber }),
        block: {
          paragraphs,
          action: { label: tr(locale, "email.receipt.button"), link: assertWebLink(input.link) },
          ignoreNote: false,
        },
      });
    }
    case "admin_alert":
      return renderLayout({
        locale,
        name,
        subject: tr(locale, "email.adminAlert.subject"),
        block: {
          paragraphs: [tr(locale, "email.adminAlert.body", { summary: input.summary })],
          action: { label: tr(locale, "email.adminAlert.button"), link: assertWebLink(input.link) },
          ignoreNote: false,
        },
      });
    case "alert_digest":
      return renderLayout({
        locale,
        name,
        subject: tr(locale, "email.alertDigest.subject", { count: String(input.count) }),
        block: {
          paragraphs: [
            tr(locale, "email.alertDigest.body", { count: String(input.count) }),
            ...input.summaries,
          ],
          action: { label: tr(locale, "email.adminAlert.button"), link: assertWebLink(input.link) },
          ignoreNote: false,
        },
      });
    case "billing_payment_rejected": {
      const reasonKey = `email.paymentRejected.reason.${input.reason}` as MessageKey;
      const reason = (PAYMENT_REJECT_REASONS as readonly string[]).includes(input.reason)
        ? tr(locale, reasonKey)
        : tr(locale, "email.paymentRejected.reason.other");
      return renderLayout({
        locale,
        name,
        subject: tr(locale, "email.paymentRejected.subject", { number: input.orderNumber }),
        block: {
          paragraphs: [
            tr(locale, "email.paymentRejected.body", { number: input.orderNumber, reason }),
            ...(input.note ? [tr(locale, "email.paymentRejected.note", { note: input.note })] : []),
          ],
          action: {
            label: tr(locale, "email.paymentRejected.button"),
            link: assertWebLink(input.link),
          },
          ignoreNote: false,
        },
      });
    }
    case "subscription_reminder": {
      // d7/d3/d1: before the end; g1-g3: in grace; expired: after it.
      const stage =
        input.slot === "expired" ? "expired" : input.slot.startsWith("g") ? "grace" : "ending";
      const params = { plan: input.planName, date: input.endsAt.slice(0, 10) };
      return renderLayout({
        locale,
        name,
        subject: tr(locale, `email.subscriptionReminder.${stage}.subject` as MessageKey, params),
        block: {
          paragraphs: [
            tr(locale, `email.subscriptionReminder.${stage}.body` as MessageKey, params),
          ],
          action: {
            label: tr(locale, "email.subscriptionReminder.button"),
            link: assertWebLink(input.link),
          },
          ignoreNote: false,
        },
      });
    }
    case "billing_payment_resubmit":
      return renderLayout({
        locale,
        name,
        subject: tr(locale, "email.paymentResubmit.subject", { number: input.orderNumber }),
        block: {
          paragraphs: [
            tr(locale, "email.paymentResubmit.body", { number: input.orderNumber }),
            ...(input.note ? [tr(locale, "email.paymentResubmit.note", { note: input.note })] : []),
          ],
          action: {
            label: tr(locale, "email.paymentResubmit.button"),
            link: assertWebLink(input.link),
          },
          ignoreNote: false,
        },
      });
    case "withdrawal_update": {
      const reasonKey = `rewards.withdrawal.reject.${input.reason ?? "other"}` as MessageKey;
      const params = {
        points: String(input.points),
        amount: formatMoney(input.amountMinor, input.currency, locale),
        reference: input.reference ?? "",
        reason: input.reason ? tr(locale, reasonKey) : "",
      };
      return renderLayout({
        locale,
        name,
        subject: tr(locale, `email.withdrawal.${input.event}.subject` as MessageKey),
        block: {
          paragraphs: [
            tr(locale, `email.withdrawal.${input.event}.body` as MessageKey, params),
            ...(input.note ? [tr(locale, "email.withdrawal.note", { note: input.note })] : []),
          ],
          action: { label: tr(locale, "email.withdrawal.button"), link: assertWebLink(input.link) },
          ignoreNote: false,
        },
      });
    }
    case "lifecycle_mail": {
      // Copy is keyed by kind; the numbers are the person's own (counts, a date, a percent), never health data.
      const params = Object.fromEntries(
        Object.entries(input.params).map(([key, value]) => [key, String(value)]),
      );
      return renderLayout({
        locale,
        name,
        subject: tr(locale, `email.lifecycle.${input.kind}.subject` as MessageKey, params),
        block: {
          paragraphs: [tr(locale, `email.lifecycle.${input.kind}.body` as MessageKey, params)],
          action: {
            label: tr(locale, `email.lifecycle.${input.kind}.button` as MessageKey),
            link: assertWebLink(input.link),
          },
          ignoreNote: false,
          unsubscribe: {
            label: tr(locale, "email.lifecycle.unsubscribe"),
            link: assertWebLink(input.unsubscribeUrl),
            oneClick: assertWebLink(input.oneClickUrl),
          },
        },
      });
    }
  }
}
