/*
 * The links of the floating contact hub, built from the public `contact` setting. Each channel
 * exists only when the admin set it; the values are already validated by the settings schema
 * (E.164 phone numbers, a Telegram username), and are rebuilt here so no raw text becomes a URL.
 */

export interface ContactSettings {
  whatsapp: string | null;
  telegram: string | null;
  phone: string | null;
}

export interface ContactLink {
  channel: "whatsapp" | "telegram" | "phone";
  href: string;
  /** Opens another site or app: new tab. `tel:` stays in place. */
  external: boolean;
}

export function contactLinks(contact: ContactSettings): ContactLink[] {
  const links: ContactLink[] = [];
  const whatsapp = contact.whatsapp?.replace(/\D/g, "");
  if (whatsapp)
    links.push({ channel: "whatsapp", href: `https://wa.me/${whatsapp}`, external: true });
  const telegram = contact.telegram?.replace(/^@/, "").trim();
  if (telegram)
    links.push({ channel: "telegram", href: `https://t.me/${telegram}`, external: true });
  const phone = contact.phone?.replace(/[^\d+]/g, "");
  if (phone) links.push({ channel: "phone", href: `tel:${phone}`, external: false });
  return links;
}
