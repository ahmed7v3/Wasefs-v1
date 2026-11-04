import { Check } from "lucide-react";

import { early } from "../../content/early";

import { PhoneCapture } from "./PhoneCapture";
import { GlassBadge } from "./visual/GlassSurface";
import { HaloBackdrop } from "./visual/HaloBackdrop";
import { Reveal } from "./visual/Reveal";
import { WasfaCharacter } from "./visual/WasfaCharacter";

import type { EarlyVariant } from "@wasfa/shared/schemas/early-access";

/**
 * The first screen. The headline is rendered on the server in the visitor's sticky variant
 * (`proxy.ts` picks it), so there is no swap, no layout jump, and the H1 text is the LCP element:
 * it is deliberately not wrapped in `Reveal`.
 */
export function EarlyHero({
  variant,
  detectedCountry,
  nonce,
}: {
  variant: EarlyVariant;
  detectedCountry: string | null;
  nonce: string | undefined;
}) {
  return (
    <section className="relative isolate overflow-x-clip">
      <div className="mx-auto grid max-w-6xl items-center gap-6 px-5 pb-16 pt-6 sm:px-8 lg:grid-cols-[1.1fr_0.9fr] lg:gap-10 lg:pb-28 lg:pt-14">
        <div className="relative order-first mx-auto grid w-full max-w-md place-items-center lg:order-last lg:max-w-none">
          <HaloBackdrop />
          <div className="relative z-10 py-2 lg:py-6">
            <WasfaCharacter className="max-sm:w-44!" label={early.hero.characterLabel} />
          </div>
        </div>

        <div className="min-w-0">
          <GlassBadge className="px-4 py-1.5 text-[13px] font-semibold leading-snug text-[#1e3a8a] sm:text-sm">
            {early.hero.badge}
          </GlassBadge>
          <h1
            data-variant={variant}
            className="mt-5 text-[clamp(2.4rem,1.3rem+4.2vw,4.2rem)] font-bold leading-[1.3] text-[#0b1220]"
          >
            {early.hero.headlines[variant]}
          </h1>
          <Reveal delay={80}>
            <p className="early-lead mt-5 text-lg leading-[1.85] text-[#0b1220]/75 sm:text-xl">
              {early.hero.sub}
            </p>
          </Reveal>
          <Reveal delay={160} className="mt-8 max-w-xl">
            <PhoneCapture id="join" detectedCountry={detectedCountry} nonce={nonce} />
          </Reveal>
          <Reveal delay={240}>
            <ul className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-[15px] font-semibold text-[#0b1220]/80">
              {early.hero.perks.map((perk) => (
                <li key={perk} className="inline-flex items-center gap-2">
                  <span className="grid size-5 place-items-center rounded-full bg-[#1e3a8a] text-white">
                    <Check className="size-3" strokeWidth={3.5} aria-hidden="true" />
                  </span>
                  {perk}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
