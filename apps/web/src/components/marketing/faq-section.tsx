import { Container, buttonStyles } from "@wasfa/ui";
import { ChevronDown } from "lucide-react";
import Link from "next/link";

import { landing } from "../../content/landing";

import { Mascot } from "./mascot";

const { faq } = landing;

/**
 * Native disclosure widgets: keyboard and screen-reader support for free, and no client JavaScript.
 * The same `faq.items` feed the `FAQPage` JSON-LD, so the markup and the structured data cannot differ.
 */
export function FaqSection() {
  return (
    <section
      id={faq.id}
      aria-labelledby="faq-title"
      className="border-t border-border/70 py-16 sm:py-24"
    >
      <Container className="grid gap-10 lg:grid-cols-[1fr_1.9fr] lg:gap-14">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <p className="inline-flex rounded-full border border-border bg-surface px-3 py-0.5 text-sm font-bold text-primary">
            {faq.eyebrow}
          </p>
          <h2 id="faq-title" className="mt-4 text-2xl font-bold text-text sm:text-4xl">
            {faq.title}
          </h2>
          <p className="mt-3 text-lg text-text-muted">{faq.lead}</p>
          <div className="mt-6 flex items-center gap-4 rounded-2xl border border-border bg-surface p-4 shadow-card">
            <Mascot name="tablet" className="size-14" />
            <div>
              <p className="text-base font-bold text-text">{faq.moreTitle}</p>
              <Link
                href="/contact"
                className={buttonStyles({ variant: "ghost", className: "-ms-3 mt-1" })}
              >
                {faq.moreLink}
              </Link>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          {faq.items.map((item) => (
            <details
              key={item.question}
              className="group rounded-2xl border border-border bg-surface shadow-card open:shadow-raised"
            >
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 rounded-2xl px-5 py-3 text-lg font-bold text-text focus-visible:outline-none focus-visible:shadow-focus [&::-webkit-details-marker]:hidden">
                {item.question}
                {/* Points down; turns up when open (transform only, so no layout shift). */}
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary-soft text-primary">
                  <ChevronDown
                    aria-hidden="true"
                    className="size-5 transition-transform duration-200 ease-standard group-open:rotate-180"
                  />
                </span>
              </summary>
              <p className="px-5 pb-5 text-base text-text-muted">{item.answer}</p>
            </details>
          ))}
        </div>
      </Container>
    </section>
  );
}
