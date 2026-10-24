import { t, type MessageKey } from "@wasfa/shared/i18n";
import { Container } from "@wasfa/ui";
import Link from "next/link";

import { landingFor } from "../../content/landing-locale";
import { contactLinks } from "../../lib/contact-links";
import { type Locale } from "../../lib/locale";
import { pagePath } from "../../lib/seo";
import { BrandMark } from "../brand-mark";
import { EmailOff } from "../email-off";

import { PlatformChips } from "./apps-band";
import { LanguageSwitch } from "./language-switch";

import type { PublicSettings } from "@wasfa/shared/settings";
import type { ReactNode } from "react";

type FooterLinkKey = keyof ReturnType<typeof landingFor>["footer"]["links"];

export interface FooterColumn {
  id: "product" | "company" | "legal";
  links: { href: string; label: FooterLinkKey }[];
}

/** English counterpart of a marketing path: every page below ships in both languages. */
function enPath(path: string): string {
  return `/en${path}`;
}

/**
 * The link columns. The product and company pages exist in both languages (English under `/en`);
 * the legal pages follow `PUBLIC_PAGES`, so English visitors get the Arabic original until a page
 * has an English version.
 */
export function footerColumns(locale: Locale): FooterColumn[] {
  const localized = (path: string) => (locale === "en" ? enPath(path) : path);
  return [
    {
      id: "product",
      links: [
        { href: localized("/features/prescription-reader"), label: "prescriptionReader" },
        {
          href: localized("/features/handwritten-prescriptions"),
          label: "handwrittenPrescriptions",
        },
        { href: localized("/features/medicine-explainer"), label: "medicineExplainer" },
        { href: localized("/features/ai-assistant"), label: "aiAssistant" },
        { href: localized("/pricing"), label: "pricing" },
        { href: localized("/for/pharmacists"), label: "pharmacists" },
        { href: localized("/for/clinics"), label: "clinics" },
      ],
    },
    // TODO(Release B): a "resources" column (blog, guides, medicines, glossary) joins once those sections exist.
    {
      id: "company",
      links: [
        { href: localized("/about"), label: "about" },
        { href: localized("/editorial-policy"), label: "editorialPolicy" },
        { href: localized("/medical-review"), label: "medicalReview" },
        { href: localized("/sources"), label: "sources" },
        { href: pagePath("contact", locale), label: "contact" },
      ],
    },
    // TODO(Release C): the "privacy settings" consent link joins this column.
    {
      id: "legal",
      links: [
        { href: pagePath("privacy", locale), label: "privacy" },
        { href: pagePath("terms", locale), label: "terms" },
        { href: pagePath("disclaimer", locale), label: "disclaimer" },
      ],
    },
  ];
}

const SOCIAL_LABELS: Record<keyof PublicSettings["socials"], MessageKey> = {
  facebook: "marketing.social.facebook",
  instagram: "marketing.social.instagram",
  tiktok: "marketing.social.tiktok",
  x: "marketing.social.x",
  youtube: "marketing.social.youtube",
};

/** 24 px glyphs, `currentColor`; the brand marks are drawn small and simple, the label carries the meaning. */
const SOCIAL_ICONS: Record<keyof PublicSettings["socials"], ReactNode> = {
  facebook: <path d="M14 8h3V4h-3a4 4 0 0 0-4 4v3H7v4h3v7h4v-7h3l1-4h-4V8.5a.5.5 0 0 1 .5-.5Z" />,
  instagram: (
    <>
      <rect
        x="3"
        y="3"
        width="18"
        height="18"
        rx="5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="17.2" cy="6.8" r="1.2" />
    </>
  ),
  tiktok: (
    <path d="M16.6 5.8A4.3 4.3 0 0 1 15.5 3h-3.1v12.4a2.6 2.6 0 1 1-2.6-2.6c.27 0 .53.04.78.12V9.7a5.7 5.7 0 1 0 4.9 5.7V9.1a7.4 7.4 0 0 0 4.3 1.4V7.4a4.3 4.3 0 0 1-3.2-1.6Z" />
  ),
  x: (
    <path d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.66l-5.21-6.82-5.97 6.82H1.68l7.73-8.84L1.25 2.25h6.83l4.71 6.23 5.45-6.23Zm-1.16 17.52h1.83L7.08 4.13H5.12l11.96 15.64Z" />
  ),
  youtube: (
    <path d="M21.6 7.2a2.5 2.5 0 0 0-1.76-1.77C18.27 5 12 5 12 5s-6.27 0-7.84.43A2.5 2.5 0 0 0 2.4 7.2C2 8.78 2 12 2 12s0 3.22.4 4.8a2.5 2.5 0 0 0 1.76 1.77C5.73 19 12 19 12 19s6.27 0 7.84-.43a2.5 2.5 0 0 0 1.76-1.77C22 15.22 22 12 22 12s0-3.22-.4-4.8ZM10 15V9l5.2 3L10 15Z" />
  ),
};

const CHANNEL_LABELS = {
  whatsapp: "contactHub.whatsapp",
  telegram: "contactHub.telegram",
  phone: "contactHub.phone",
} as const satisfies Record<string, MessageKey>;

/** 48 px rows (DESIGN-SYSTEM touch target plus air) so the two-column phone grid stays easy to tap. */
const footerLink =
  "inline-flex min-h-12 items-center rounded-sm text-base text-text underline-offset-4 hover:text-primary hover:underline focus-visible:outline-none focus-visible:shadow-focus";

const headingClass = "text-base font-bold text-text";

export interface SiteFooterProps {
  settings: PublicSettings;
  locale?: Locale;
  /** The request path, for the language switch. */
  path?: string;
}

/**
 * Brand block (lockup, tagline, apps chips, socials), the link columns, the contact channels the
 * admin set (each hidden when empty) and the bottom bar. A server component, so the copyright year
 * is rendered once per request and cannot mismatch on hydration.
 */
export function SiteFooter({ settings, locale = "ar", path = "/" }: SiteFooterProps) {
  const { footer } = landingFor(locale);
  const tr = (key: MessageKey, params?: Record<string, string | number>) => t(key, params, locale);
  const channels = contactLinks(settings.contact);
  const email = settings.contact.email;
  const socials = (Object.keys(SOCIAL_LABELS) as (keyof typeof SOCIAL_LABELS)[]).flatMap((key) => {
    const url = settings.socials[key];
    return url ? [{ key, url }] : [];
  });

  return (
    <footer className="border-t border-border bg-surface">
      <Container className="py-12">
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-[1.5fr_1.2fr_1fr_1fr_1fr]">
          <div className="col-span-2 lg:col-span-1">
            <BrandMark branding={settings.branding} locale={locale} />
            <p className="mt-3 max-w-xs text-base text-text-muted">{footer.tagline}</p>
            <p className="mt-4 text-sm font-semibold text-text-muted">{footer.appsSoon}</p>
            <div className="mt-2">
              <PlatformChips apps={settings.landing.apps} locale={locale} compact />
            </div>
            {socials.length > 0 ? (
              <ul aria-label={tr("marketing.footer.social")} className="mt-4 flex flex-wrap gap-1">
                {socials.map(({ key, url }) => (
                  <li key={key}>
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer me"
                      aria-label={tr(SOCIAL_LABELS[key])}
                      className="grid size-12 place-items-center rounded-full text-text transition-colors duration-150 hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:shadow-focus"
                    >
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        className="size-5"
                      >
                        {SOCIAL_ICONS[key]}
                      </svg>
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {footerColumns(locale).map((column) => (
            <nav key={column.id} aria-labelledby={`footer-${column.id}`}>
              <h2 id={`footer-${column.id}`} className={headingClass}>
                {footer[column.id]}
              </h2>
              <ul className="mt-2">
                {column.links.map((item) => (
                  <li key={item.href}>
                    <Link href={item.href} className={footerLink}>
                      {footer.links[item.label]}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}

          {channels.length > 0 || email ? (
            <section aria-labelledby="footer-contact">
              <h2 id="footer-contact" className={headingClass}>
                {tr("marketing.footer.contact")}
              </h2>
              <ul className="mt-2">
                {channels.map((link) => (
                  <li key={link.channel}>
                    <a
                      href={link.href}
                      {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                      className={footerLink}
                    >
                      {tr(CHANNEL_LABELS[link.channel])}
                    </a>
                  </li>
                ))}
                {email ? (
                  <li>
                    <EmailOff>
                      <a href={`mailto:${email}`} dir="ltr" className={footerLink}>
                        {email}
                      </a>
                    </EmailOff>
                  </li>
                ) : null}
              </ul>
            </section>
          ) : null}
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-border pt-6 text-sm text-text-muted sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p>{tr("home.disclaimer")}</p>
            <p className="mt-1">
              {tr("marketing.footer.rights", {
                year: new Date().getFullYear(),
                brand: tr("brand.name"),
              })}
            </p>
          </div>
          <LanguageSwitch path={path} locale={locale} />
        </div>
      </Container>
    </footer>
  );
}
