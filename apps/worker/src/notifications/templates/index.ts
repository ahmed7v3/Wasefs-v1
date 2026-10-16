import { formatMoney } from "@wasfa/shared/money";

import { assertWebLink, renderLayout, tr, type Rendered } from "./layout.js";

import type { Locale } from "@wasfa/shared/i18n";

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
  }
}
