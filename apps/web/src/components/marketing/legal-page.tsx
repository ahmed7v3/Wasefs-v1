import { t } from "@wasfa/shared/i18n";
import { Container } from "@wasfa/ui";

import { DATA_LIST_LABELS, type LegalBlock, type LegalDoc } from "../../content/legal/types";
import { Notice } from "../notice";

/** UTC, Gregorian, Western digits (DESIGN-SYSTEM §4.6); the date is a content constant, not a timestamp. */
const updatedFormat = new Intl.DateTimeFormat("ar-EG", {
  numberingSystem: "latn",
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

function Block({ block }: { block: LegalBlock }) {
  switch (block.type) {
    case "p":
      return <p className="mt-3 text-base">{block.text}</p>;
    case "ul":
      return (
        <ul className="mt-3 list-disc space-y-1.5 ps-6 text-base marker:text-primary">
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );
    case "dataList":
      return (
        <ul className="mt-4 flex flex-col gap-4">
          {block.items.map((item) => (
            <li key={item.title} className="rounded-xl border border-border bg-surface p-4">
              <h3 className="font-heading text-lg font-semibold text-text">{item.title}</h3>
              <dl className="mt-2 flex flex-col gap-2 text-base">
                {(["what", "why", "retention"] as const).map((field) => (
                  <div key={field}>
                    <dt className="text-sm font-semibold text-text-muted">
                      {DATA_LIST_LABELS[field]}
                    </dt>
                    <dd>{item[field]}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      );
  }
}

/**
 * Layout of the three legal pages: one `h1`, the last-updated date, the "draft pending the owner's
 * final text" notice (always first, always visible), a table of contents and the sections.
 */
export function LegalPage({ doc }: { doc: LegalDoc }) {
  return (
    <Container width="reading" className="py-10 sm:py-14">
      <article>
        <h1 className="font-heading text-3xl font-bold text-primary sm:text-4xl">{doc.title}</h1>
        <p className="mt-2 text-sm text-text-muted">
          {t("marketing.legal.updated", { date: updatedFormat.format(new Date(doc.updated)) })}
        </p>
        <Notice tone="warning" className="mt-6">
          {t("marketing.legal.draft")}
        </Notice>
        <p className="mt-6 text-lg text-text-muted">{doc.intro}</p>

        <nav
          aria-labelledby="legal-toc"
          className="mt-8 rounded-xl border border-border bg-surface p-5"
        >
          <h2 id="legal-toc" className="font-heading text-lg font-semibold text-text">
            {t("marketing.legal.toc")}
          </h2>
          <ol className="mt-2 list-decimal ps-6 marker:text-text-muted">
            {doc.sections.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="inline-flex min-h-11 items-center rounded-sm text-base text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                >
                  {section.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {doc.sections.map((section) => (
          <section
            key={section.id}
            id={section.id}
            aria-labelledby={`${section.id}-title`}
            className="mt-10 scroll-mt-4"
          >
            <h2
              id={`${section.id}-title`}
              className="font-heading text-2xl font-semibold text-text"
            >
              {section.title}
            </h2>
            {section.blocks.map((block, index) => (
              <Block key={`${section.id}-${index}`} block={block} />
            ))}
          </section>
        ))}
      </article>
    </Container>
  );
}
