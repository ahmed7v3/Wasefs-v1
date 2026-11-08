import { buttonStyles } from "@wasfa/ui";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { landingFor } from "../../content/landing-locale";
import { localizedPath, type Locale } from "../../lib/locale";
import { WhatsAppGlyph } from "../marketing/chat-parts";
import { HaloBackdrop } from "../visual/HaloBackdrop";
import { Reveal } from "../visual/Reveal";
import { WasfaCharacter } from "../visual/WasfaCharacter";

import { HomeSection } from "./home-section";

/** The closing call to action: sign up (or open the dashboard when signed in) and chat on WhatsApp. */
export function FinalCta({
  locale = "ar",
  signedIn,
  whatsappHref = null,
}: {
  locale?: Locale;
  signedIn: boolean;
  whatsappHref?: string | null;
}) {
  const { cta, hero } = landingFor(locale);
  return (
    <HomeSection labelledBy="cta-title" className="pt-4">
      <Reveal>
        <div className="relative isolate overflow-hidden rounded-[32px] bg-linear-to-br from-white via-white to-primary-soft px-6 pb-12 pt-8 text-center shadow-[0_2px_4px_rgb(11_18_32/0.04),0_30px_70px_-30px_rgb(30_58_138/0.35)] ring-1 ring-primary/10 sm:px-12 sm:pb-16 sm:pt-12">
          <div className="relative mx-auto grid w-full max-w-xs place-items-center">
            <HaloBackdrop />
            <div className="relative z-10">
              <WasfaCharacter size={150} />
            </div>
          </div>
          <h2 id="cta-title" className="mt-6 text-2xl font-bold text-text sm:text-4xl">
            {cta.title}
          </h2>
          <p className="mx-auto mt-3 max-w-reading text-lg leading-[1.85] text-text-muted">
            {cta.body}
          </p>
          <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row">
            <Link
              href={signedIn ? "/dashboard" : "/register"}
              className={buttonStyles({ size: "lg", className: "shadow-raised" })}
            >
              {signedIn ? hero.dashboardCta : cta.primary}
              <ArrowRight aria-hidden="true" className="size-5 rtl:-scale-x-100" />
            </Link>
            {whatsappHref ? (
              <a
                href={whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                data-wa-cta="final"
                className={buttonStyles({
                  size: "lg",
                  className:
                    "bg-[#25d366] text-[#052e1a] shadow-raised hover:bg-[#20bd5a] focus-visible:shadow-focus",
                })}
              >
                <WhatsAppGlyph className="size-6" />
                {cta.whatsapp}
              </a>
            ) : (
              <Link
                href={localizedPath("/contact", locale)}
                className={buttonStyles({ size: "lg", variant: "secondary" })}
              >
                {cta.secondary}
              </Link>
            )}
          </div>
        </div>
      </Reveal>
    </HomeSection>
  );
}
