import { landingFor } from "../../content/landing-locale";

import {
  Bubble,
  ChatHeader,
  MedCard,
  PaperRx,
  PdfBubble,
  PhoneShell,
  RxPhoto,
  VoiceBubble,
} from "./chat-parts";

import type { Locale } from "../../lib/locale";

/**
 * The hero picture: a phone showing a WhatsApp chat (prescription photo, the assistant's medicine
 * card with its schedule, a PDF and a voice note) in front of a tilted handwritten prescription.
 * Inline HTML and SVG only. The box has a fixed size (`.hero-scene`), so the staged entrance
 * (bubbles slide in once, `.chat-in`) cannot shift the layout; without motion the finished chat shows.
 * One `role="img"` carries the description; everything inside is decorative.
 */
export function HeroScene({ locale = "ar" }: { locale?: Locale }) {
  const { scene } = landingFor(locale);
  return (
    <div
      role="img"
      aria-label={scene.alt}
      className="hero-scene relative mx-auto w-full max-w-[30rem]"
    >
      <div
        aria-hidden="true"
        className="absolute inset-x-[4%] inset-y-[6%] rounded-full bg-[radial-gradient(closest-side,var(--color-accent-soft),transparent)]"
      />
      <div
        aria-hidden="true"
        className="paper-in absolute start-0 top-14 hidden w-44 -rotate-[8deg] rounded-xl shadow-raised sm:block"
      >
        <PaperRx />
      </div>
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 mx-auto w-fit sm:inset-x-auto sm:end-0 sm:mx-0"
      >
        <PhoneShell className="h-[36.5rem]" screenClassName="h-full wa-wall">
          <ChatHeader name={scene.agentName} status={scene.agentStatus} />
          <div className="flex flex-col gap-2 p-2.5">
            <Bubble from="user" className="chat-in w-40 [--i:0]">
              <RxPhoto />
              <p className="mt-1 text-xs text-text-muted">{scene.photoCaption}</p>
            </Bubble>
            <Bubble from="agent" className="chat-in w-full max-w-[94%] space-y-1.5 [--i:1]">
              <p className="px-0.5 text-xs">{scene.reply}</p>
              {scene.items.map((item) => (
                <MedCard key={item.name} item={item} />
              ))}
            </Bubble>
            <PdfBubble name={scene.pdfName} meta={scene.pdfMeta} className="chat-in [--i:2]" />
            <VoiceBubble
              from="agent"
              length={scene.voiceLength}
              label={scene.voiceLabel}
              className="chat-in [--i:3]"
            />
          </div>
        </PhoneShell>
      </div>
      <p
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 text-center text-xs font-bold text-text-muted"
      >
        {scene.sampleBadge}
      </p>
    </div>
  );
}
