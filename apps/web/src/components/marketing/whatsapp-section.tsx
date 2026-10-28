import { Container, buttonStyles } from "@wasfa/ui";
import { ArrowRight, Camera, CreditCard, FileText, Mic, Pill, UserPlus } from "lucide-react";
import Link from "next/link";

import { type WhatsappTileIcon } from "../../content/landing";
import { landingFor } from "../../content/landing-locale";

import {
  Bubble,
  ChatHeader,
  MedCard,
  PdfBubble,
  PhoneShell,
  RxPhoto,
  VoiceBubble,
  WhatsAppGlyph,
} from "./chat-parts";
import { QrSvg } from "./qr-svg";
import { SectionHeading } from "./section-heading";

import type { Locale } from "../../lib/locale";
import type { CSSProperties } from "react";

const TILE_ICONS = {
  photo: Camera,
  voice: Mic,
  medicine: Pill,
  files: FileText,
  pay: CreditCard,
  account: UserPlus,
} as const satisfies Record<WhatsappTileIcon, unknown>;

/**
 * "Everything from WhatsApp": a scripted conversation in a phone next to six capability tiles, then
 * the WhatsApp button and (desktop only) a QR code of the same link. Placed right after the hero:
 * the hero names the idea, this section proves it, before the generic skills grid. With no
 * WhatsApp number configured the chat and tiles still show and the button falls back to sign-up.
 * No JavaScript: the QR is drawn on the server and each message settles on scroll with CSS only.
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
    <section
      id={whatsapp.id}
      aria-labelledby="whatsapp-title"
      className="relative border-y border-border/70 bg-surface py-16 sm:py-24"
    >
      <div aria-hidden="true" className="dot-grid absolute inset-x-0 top-0 h-80" />
      <Container className="relative">
        <SectionHeading
          id="whatsapp-title"
          eyebrow={whatsapp.eyebrow}
          title={whatsapp.title}
          lead={whatsapp.lead}
        />
        <div className="mt-12 grid items-center gap-12 lg:grid-cols-[1fr_auto] lg:gap-16">
          <div className="min-w-0">
            <ul aria-label={whatsapp.tilesLabel} className="grid gap-4 sm:grid-cols-2">
              {whatsapp.tiles.map((tile) => {
                const Icon = TILE_ICONS[tile.icon];
                return (
                  <li
                    key={tile.title}
                    className="rounded-3xl border border-border bg-bg-warm p-5 shadow-card transition-[transform,box-shadow] duration-200 ease-standard hover:-translate-y-1 hover:shadow-raised"
                  >
                    <span className="grid size-11 place-items-center rounded-2xl bg-wa-green/20 text-wa-deep">
                      <Icon aria-hidden="true" className="size-6" />
                    </span>
                    <h3 className="mt-3 text-lg font-bold text-text">{tile.title}</h3>
                    <p className="mt-1.5 text-base text-text-muted">{tile.body}</p>
                  </li>
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
                    className:
                      "bg-wa-deep shadow-raised hover:bg-wa-deep/90 focus-visible:shadow-focus",
                  })}
                >
                  <span className="grid size-7 place-items-center rounded-full bg-wa-green text-wa-deep">
                    <WhatsAppGlyph className="size-4.5" />
                  </span>
                  {whatsapp.cta}
                </a>
              ) : (
                <Link href="/register" className={buttonStyles({ size: "lg" })}>
                  {hero.primaryCta}
                  <ArrowRight aria-hidden="true" className="size-5 rtl:-scale-x-100" />
                </Link>
              )}
              {whatsappHref ? (
                <div className="hidden items-center gap-3 lg:flex">
                  <div className="rounded-2xl border border-border bg-white p-2 shadow-card">
                    <QrSvg value={whatsappHref} label={whatsapp.qrLabel} className="size-28" />
                  </div>
                  <p className="max-w-32 text-sm font-bold text-text-muted">{whatsapp.qrTitle}</p>
                </div>
              ) : null}
            </div>
            <p className="mt-5 max-w-reading text-sm text-text-muted">{whatsapp.note}</p>
          </div>

          <div className="relative mx-auto max-lg:order-first">
            <div
              aria-hidden="true"
              className="absolute inset-x-0 -inset-y-6 rounded-[3rem] bg-[radial-gradient(closest-side,rgb(37_211_102/0.18),transparent)]"
            />
            <div role="img" aria-label={whatsapp.phoneLabel} className="relative">
              <PhoneShell screenClassName="wa-wall">
                <div aria-hidden="true">
                  <ChatHeader name={scene.agentName} status={scene.agentStatus} />
                  <div className="flex flex-col gap-2 p-2.5">
                    {whatsapp.chat.map((message, index) => (
                      <div
                        key={`${message.kind}-${message.text}`}
                        className="chat-seq flex flex-col"
                        style={{ "--i": index } as CSSProperties}
                      >
                        {message.kind === "photo" ? (
                          <Bubble from={message.from} className="w-40">
                            <RxPhoto />
                            <p className="mt-1 text-xs text-text-muted">{message.text}</p>
                          </Bubble>
                        ) : null}
                        {message.kind === "text" ? (
                          <Bubble from={message.from}>{message.text}</Bubble>
                        ) : null}
                        {message.kind === "meds" ? (
                          <Bubble from={message.from} className="w-full max-w-[94%] space-y-1.5">
                            <p className="px-0.5 text-xs">{message.text}</p>
                            {scene.items.map((item) => (
                              <MedCard key={item.name} item={item} />
                            ))}
                          </Bubble>
                        ) : null}
                        {message.kind === "voice" ? (
                          <VoiceBubble from={message.from} length={message.text} />
                        ) : null}
                        {message.kind === "file" ? (
                          <PdfBubble name={message.text} meta={scene.pdfMeta} />
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              </PhoneShell>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
