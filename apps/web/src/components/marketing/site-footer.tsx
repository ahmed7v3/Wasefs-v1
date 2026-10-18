import { t, type MessageKey } from "@wasfa/shared/i18n";
import { Container } from "@wasfa/ui";
import Link from "next/link";

import { landing } from "../../content/landing";
import { contactLinks } from "../../lib/contact-links";
import { BrandMark } from "../brand-mark";

import type { PublicSettings } from "@wasfa/shared/settings";

/** Product links: the landing sections and the two account entries. */
const PRODUCT = [
  { href: "/#how-it-works", label: "marketing.nav.how" },
  { href: "/#features", label: "marketing.nav.features" },
  { href: "/pricing", label: "billing.nav.pricing" },
  { href: "/#faq", label: "marketing.nav.faq" },
  { href: "/login", label: "marketing.nav.signIn" },
  { href: "/register", label: "marketing.nav.register" },
] as const;

const LEGAL = [
  { href: "/privacy", label: "marketing.link.privacy" },
  { href: "/terms", label: "marketing.link.terms" },
  { href: "/disclaimer", label: "marketing.link.disclaimer" },
  { href: "/contact", label: "marketing.link.contact" },
] as const;

const SOCIAL_LABELS: Record<keyof PublicSettings["socials"], MessageKey> = {
  facebook: "marketing.social.facebook",
  instagram: "marketing.social.instagram",
  tiktok: "marketing.social.tiktok",
  x: "marketing.social.x",
  youtube: "marketing.social.youtube",
};

const CHANNEL_LABELS = {
  whatsapp: "contactHub.whatsapp",
  telegram: "contactHub.telegram",
  phone: "contactHub.phone",
} as const satisfies Record<string, MessageKey>;

const footerLink =
  "inline-flex min-h-11 items-center rounded-sm text-base text-text underline-offset-4 hover:text-primary hover:underline focus-visible:outline-none focus-visible:shadow-focus";

const headingClass = "text-base font-bold text-text";

export interface SiteFooterProps {
  settings: PublicSettings;
}

/** Legal links, the contact channels and social profiles the admin set (each hidden when empty), and the disclaimer line. */
export function SiteFooter({ settings }: SiteFooterProps) {
  const channels = contactLinks(settings.contact);
  const email = settings.contact.email;
  const socials = (Object.keys(SOCIAL_LABELS) as (keyof typeof SOCIAL_LABELS)[]).flatMap((key) => {
    const url = settings.socials[key];
    return url ? [{ key, url }] : [];
  });

  return (
    <footer className="border-t border-border bg-surface">
      <Container className="py-12">
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-[1.6fr_1fr_1fr_1fr_1fr]">
          <div className="col-span-2 lg:col-span-1">
            <BrandMark />
            <p className="mt-3 max-w-xs text-base text-text-muted">{landing.footer.tagline}</p>
          </div>

          <nav aria-labelledby="footer-product">
            <h2 id="footer-product" className={headingClass}>
              {landing.footer.product}
            </h2>
            <ul className="mt-2">
              {PRODUCT.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className={footerLink}>
                    {t(item.label)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-labelledby="footer-legal">
            <h2 id="footer-legal" className={headingClass}>
              {t("marketing.footer.legal")}
            </h2>
            <ul className="mt-2">
              {LEGAL.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className={footerLink}>
                    {t(item.label)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {channels.length > 0 || email ? (
            <section aria-labelledby="footer-contact">
              <h2 id="footer-contact" className={headingClass}>
                {t("marketing.footer.contact")}
              </h2>
              <ul className="mt-2">
                {channels.map((link) => (
                  <li key={link.channel}>
                    <a
                      href={link.href}
                      {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                      className={footerLink}
                    >
                      {t(CHANNEL_LABELS[link.channel])}
                    </a>
                  </li>
                ))}
                {email ? (
                  <li>
                    <a href={`mailto:${email}`} dir="ltr" className={footerLink}>
                      {email}
                    </a>
                  </li>
                ) : null}
              </ul>
            </section>
          ) : null}

          {socials.length > 0 ? (
            <section aria-labelledby="footer-social">
              <h2 id="footer-social" className={headingClass}>
                {t("marketing.footer.social")}
              </h2>
              <ul className="mt-2">
                {socials.map(({ key, url }) => (
                  <li key={key}>
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer me"
                      className={footerLink}
                    >
                      {t(SOCIAL_LABELS[key])}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <div className="mt-10 border-t border-border pt-6 text-sm text-text-muted">
          <p>{t("home.disclaimer")}</p>
          <p className="mt-2">
            {t("marketing.footer.rights", {
              year: new Date().getFullYear(),
              brand: t("brand.name"),
            })}
          </p>
        </div>
      </Container>
    </footer>
  );
}
