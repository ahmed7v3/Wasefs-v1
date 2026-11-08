import { buttonStyles } from "@wasfa/ui";
import { ArrowRight, Camera, CreditCard, FileText, Mic, Pill, UserPlus } from "lucide-react";
import Link from "next/link";

import { type SceneItem, type WhatsappTileIcon, landing } from "../../content/landing";
import { landingFor } from "../../content/landing-locale";
import { WhatsAppGlyph } from "../marketing/chat-parts";
import { QrSvg } from "../marketing/qr-svg";
import { Reveal } from "../visual/Reveal";
import { WhatsAppChatMock } from "../visual/WhatsAppChatMock";

import { HOME_FOCUS, HomeHeading, HomeSection } from "./home-section";

import type { Locale } from "../../lib/locale";
import type { ChatMessage } from "../visual/chat-types";

const TILE_ICONS = {
  photo: Camera,
  voice: Mic,
  medicine: Pill,
  files: FileText,
  pay: CreditCard,
  account: UserPlus,
} as const satisfies Record<WhatsappTileIcon, unknown>;

const KIND_PREFIX = { photo: "📷 ", voice: "🎤 ", file: "📄 ", text: "" } as const;

/** The scripted conversation of the copy, in the chat mock's message shape. */
function toMockMessages(
  chat: typeof landing.whatsapp.chat,
  items: readonly SceneItem[],
): ChatMessage[] {
  return chat.map((message, index): ChatMessage => {
    const id = `m${index}`;
    const from = message.from === "user" ? "user" : "bot";
    if (message.kind === "meds") {
      return {
        id,
        from: "bot",
        kind: "meds",
        title: message.text,
        items: items.map((item) => ({
          name: item.name,
          chips: [item.dose, ...item.times.map((time) => time.label)],
        })),
      };
    }
    return { id, from, kind: "text", text: `${KIND_PREFIX[message.kind]}${message.text}` };
  });
}

/**
 * "Everything from WhatsApp": the animated chat mock beside six capability tiles, then the WhatsApp
 * button and (desktop only) a QR of the same link. With no WhatsApp number configured the chat and
 * tiles still show and the button falls back to sign-up.
 */
export function WhatsAppSection({
  locale = "ar",
  whatsappHref = null,
}: {
  locale?: Locale;
  whatsappHref?: string | null;
}) {
  const { whatsapp, hero, scene } = landingFor(locale);
  return (
    <HomeSection
      id={whatsapp.id}
      labelledBy="whatsapp-title"
      className="bg-[#0b1220] bg-[radial-gradient(52rem_28rem_at_15%_0%,rgb(96_165_250/0.16),transparent_70%),radial-gradient(40rem_26rem_at_100%_100%,rgb(30_58_138/0.5),transparent_70%)] text-white"
    >
      <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <div className="min-w-0">
          <HomeHeading
            id="whatsapp-title"
            eyebrow={whatsapp.eyebrow}
            title={whatsapp.title}
            lead={whatsapp.lead}
            dark
            align="start"
          />
          <ul aria-label={whatsapp.tilesLabel} className="mt-8 grid gap-3 sm:grid-cols-2">
            {whatsapp.tiles.map((tile, index) => {
              const Icon = TILE_ICONS[tile.icon];
              return (
                <Reveal key={tile.title} as="li" delay={(index % 2) * 80}>
                  <div className="h-full rounded-2xl bg-white/8 p-4 ring-1 ring-white/15">
                    <span className="grid size-10 place-items-center rounded-xl bg-[#25d366]/20 text-[#25d366]">
                      <Icon aria-hidden="true" className="size-5" />
                    </span>
                    <h3 className="mt-3 text-lg font-bold text-white">{tile.title}</h3>
                    <p className="mt-1 text-base leading-[1.7] text-white/80">{tile.body}</p>
                  </div>
                </Reveal>
              );
            })}
          </ul>
          <div className="mt-8 flex flex-wrap items-center gap-6">
            {whatsappHref ? (
              <a
                href={whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                data-wa-cta="section"
                className={buttonStyles({
                  size: "lg",
                  className: `w-full bg-[#25d366] text-[#052e1a] shadow-raised hover:bg-[#20bd5a] sm:w-auto ${HOME_FOCUS}`,
                })}
              >
                <WhatsAppGlyph className="size-6" />
                {whatsapp.cta}
              </a>
            ) : (
              <Link
                href="/register"
                className={buttonStyles({
                  size: "lg",
                  className: `w-full bg-white text-primary hover:bg-primary-soft sm:w-auto ${HOME_FOCUS}`,
                })}
              >
                {hero.primaryCta}
                <ArrowRight aria-hidden="true" className="size-5 rtl:-scale-x-100" />
              </Link>
            )}
            {whatsappHref ? (
              <div className="hidden items-center gap-3 lg:flex">
                <div className="rounded-2xl bg-white p-2">
                  <QrSvg value={whatsappHref} label={whatsapp.qrLabel} className="size-28" />
                </div>
                <p className="max-w-32 text-sm font-bold text-white/80">{whatsapp.qrTitle}</p>
              </div>
            ) : null}
          </div>
          <p className="mt-5 max-w-reading text-sm text-white/75">{whatsapp.note}</p>
        </div>

        <Reveal delay={120} className="mx-auto w-full max-w-md">
          <div role="img" aria-label={whatsapp.phoneLabel}>
            <div aria-hidden="true">
              <WhatsAppChatMock
                messages={toMockMessages(whatsapp.chat, scene.items)}
                title={scene.agentName}
              />
            </div>
          </div>
        </Reveal>
      </div>
    </HomeSection>
  );
}
