import { contact } from "./contact";
import { contactEn } from "./contact.en";
import { landing } from "./landing";
import { landingEn } from "./landing.en";

import type { Locale } from "../lib/locale";

/** The landing copy in `locale`; both objects have the same shape, so components stay locale-agnostic. */
export function landingFor(locale: Locale): typeof landing {
  return locale === "en" ? landingEn : landing;
}

/** The contact page copy in `locale`. */
export function contactFor(locale: Locale): { [K in keyof typeof contact]: string } {
  return locale === "en" ? contactEn : contact;
}
