import { landingFor } from "../../content/landing-locale";
import { WhatsAppGlyph } from "../marketing/chat-parts";
import { IsoIllustration } from "../visual/IsoIllustration";
import { Reveal } from "../visual/Reveal";

import { HOME_CARD, HomeHeading, HomeSection } from "./home-section";

import type { Locale } from "../../lib/locale";

/** The copy has no illustration of its own: the three steps map, in order, to the three iso scenes. */
const STEP_KINDS = ["capture", "understand", "schedule"] as const;

/** Three numbered steps, each with its isometric illustration, then the WhatsApp shortcut. */
export function HowSection({
  locale = "ar",
  whatsappHref = null,
}: {
  locale?: Locale;
  whatsappHref?: string | null;
}) {
  const { how } = landingFor(locale);
  return (
    <HomeSection id={how.id} labelledBy="how-title">
      <HomeHeading id="how-title" eyebrow={how.eyebrow} title={how.title} lead={how.lead} />
      <ol className="mt-12 grid gap-6 lg:grid-cols-3">
        {how.steps.map((step, index) => (
          <Reveal key={step.title} as="li" delay={index * 90}>
            <div className={`${HOME_CARD} h-full p-6 text-center sm:p-8`}>
              <div className="mx-auto grid h-40 place-items-center">
                <IsoIllustration kind={STEP_KINDS[index] ?? "capture"} className="h-full w-auto" />
              </div>
              <span className="mx-auto mt-4 grid size-8 place-items-center rounded-full bg-primary text-sm font-bold tabular-nums text-on-primary">
                {index + 1}
              </span>
              <h3 className="mt-3 text-xl font-bold text-text">{step.title}</h3>
              <p className="mx-auto mt-2 max-w-[30ch] text-base leading-[1.8] text-text-muted">
                {step.body}
              </p>
            </div>
          </Reveal>
        ))}
      </ol>
      <Reveal className="mt-10 flex justify-center">
        <p className="flex max-w-fit flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-full bg-[#25d366]/12 py-2 ps-5 pe-3 text-base font-bold text-[#075e54] ring-1 ring-[#25d366]/40">
          <WhatsAppGlyph className="size-5" />
          {how.whatsappNote}
          {whatsappHref ? (
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              data-wa-cta="how"
              className="inline-flex min-h-11 items-center rounded-full bg-[#075e54] px-4 text-white focus-visible:outline-none focus-visible:shadow-focus"
            >
              {how.whatsappLink}
            </a>
          ) : null}
        </p>
      </Reveal>
    </HomeSection>
  );
}
