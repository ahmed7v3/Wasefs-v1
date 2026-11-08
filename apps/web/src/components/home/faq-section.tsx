import { buttonStyles } from "@wasfa/ui";
import { ChevronDown } from "lucide-react";
import Link from "next/link";

import { landingFor } from "../../content/landing-locale";
import { localizedPath, type Locale } from "../../lib/locale";
import { Reveal } from "../visual/Reveal";
import { WasfaCharacter } from "../visual/WasfaCharacter";

import { HOME_CARD, HomeSection } from "./home-section";

/**
 * Native disclosure widgets: keyboard and screen-reader support for free, no client JavaScript of
 * its own. The same `faq.items` feed the `FAQPage` JSON-LD, so the markup and the structured data
 * cannot differ. With `faq.exclusive` the items share a `name`, so one stays open at a time.
 */
export function FaqSection({ locale = "ar" }: { locale?: Locale }) {
  const { faq } = landingFor(locale);
  return (
    <HomeSection id={faq.id} labelledBy="faq-title" className="border-t border-text/8">
      <div className="grid gap-10 lg:grid-cols-[1fr_1.9fr] lg:gap-14">
        <Reveal className="lg:sticky lg:top-24 lg:self-start">
          <p className="text-sm font-bold text-primary">{faq.eyebrow}</p>
          <h2
            id="faq-title"
            className="mt-3 text-[clamp(1.7rem,1.1rem+2.2vw,2.6rem)] font-bold leading-[1.35] text-text"
          >
            {faq.title}
          </h2>
          <p className="mt-4 text-lg leading-[1.85] text-text-muted">{faq.lead}</p>
          <div className={`${HOME_CARD} mt-6 flex items-center gap-4 p-4`}>
            <WasfaCharacter size={64} />
            <div>
              <p className="text-base font-bold text-text">{faq.moreTitle}</p>
              <Link
                href={localizedPath("/contact", locale)}
                className={buttonStyles({ variant: "ghost", className: "-ms-3 mt-1" })}
              >
                {faq.moreLink}
              </Link>
            </div>
          </div>
        </Reveal>
        <div className="faq-list flex flex-col gap-3">
          {faq.items.map((item) => (
            <details
              key={item.question}
              {...(faq.exclusive ? { name: "faq" } : {})}
              className={`faq-item group ${HOME_CARD} open:shadow-raised`}
            >
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 rounded-[26px] px-5 py-3 text-lg font-bold text-text focus-visible:outline-none focus-visible:shadow-focus [&::-webkit-details-marker]:hidden">
                {item.question}
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary-soft text-primary">
                  <ChevronDown
                    aria-hidden="true"
                    className="size-5 transition-transform duration-200 ease-standard group-open:rotate-180 motion-reduce:transition-none"
                  />
                </span>
              </summary>
              <p className="faq-answer px-5 pb-5 text-base leading-[1.8] text-text-muted">
                {item.answer}
              </p>
            </details>
          ))}
        </div>
      </div>
    </HomeSection>
  );
}
