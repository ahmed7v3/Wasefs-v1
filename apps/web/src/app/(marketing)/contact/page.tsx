import { t } from "@wasfa/shared/i18n";
import { Card, Container } from "@wasfa/ui";
import Link from "next/link";

import { ContactChannels } from "../../../components/marketing/contact-channels";
import { ContactForm } from "../../../components/marketing/contact-form";
import { contact } from "../../../content/contact";
import { getNonce } from "../../../lib/nonce";
import { getPublicSettings } from "../../../lib/public-settings";
import { pageMetadata } from "../../../lib/seo";

import type { Metadata } from "next";

export const metadata: Metadata = pageMetadata("contact", {
  title: contact.title,
  description: contact.description,
});

export default async function ContactPage() {
  const [settings, nonce] = await Promise.all([getPublicSettings(), getNonce()]);
  return (
    <Container width="reading" className="py-10 sm:py-14">
      <h1 className="font-heading text-3xl font-bold text-primary sm:text-4xl">{contact.title}</h1>
      <p className="mt-3 text-lg text-text-muted">{contact.lead}</p>

      <ContactChannels contact={settings.contact} />

      <Card elevation="raised" className="mt-8">
        <h2 className="font-heading text-2xl font-semibold text-text">{contact.formTitle}</h2>
        <div className="mt-6">
          <ContactForm nonce={nonce} />
        </div>
      </Card>

      <p className="mt-6 text-sm text-text-muted">
        {contact.privacyNote}{" "}
        <Link
          href="/privacy"
          className="inline-flex min-h-11 items-center rounded-sm font-semibold text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:shadow-focus"
        >
          {t("marketing.link.privacy")}
        </Link>
      </p>
      <p className="mt-1 text-sm text-text-muted">{contact.emergencyNote}</p>
    </Container>
  );
}
