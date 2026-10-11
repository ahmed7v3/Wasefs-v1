import { Container } from "@wasfa/ui";
import { ChevronDown } from "lucide-react";

import { landing } from "../../content/landing";

import { SectionHeading } from "./section-heading";

const { faq } = landing;

/**
 * Native disclosure widgets: keyboard and screen-reader support for free, and no client JavaScript.
 * The same `faq.items` feed the `FAQPage` JSON-LD, so the markup and the structured data cannot differ.
 */
export function FaqSection() {
  return (
    <section id={faq.id} aria-labelledby="faq-title" className="scroll-mt-4 py-12 sm:py-20">
      <Container width="reading">
        <SectionHeading id="faq-title" title={faq.title} lead={faq.lead} />
        <div className="mt-10 flex flex-col gap-3">
          {faq.items.map((item) => (
            <details
              key={item.question}
              className="group rounded-xl border border-border bg-surface shadow-card"
            >
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 rounded-xl px-5 py-3 font-heading text-lg font-semibold text-text focus-visible:outline-none focus-visible:shadow-focus [&::-webkit-details-marker]:hidden">
                {item.question}
                {/* Points down; turns up when open (transform only, so no layout shift). */}
                <ChevronDown
                  aria-hidden="true"
                  className="size-5 shrink-0 text-primary transition-transform duration-200 ease-standard group-open:rotate-180"
                />
              </summary>
              <p className="px-5 pb-5 text-base text-text-muted">{item.answer}</p>
            </details>
          ))}
        </div>
      </Container>
    </section>
  );
}
