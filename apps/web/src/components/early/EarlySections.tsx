import {
  Apple,
  Check,
  ChevronDown,
  Clock,
  FileText,
  MessageCircle,
  Play,
  ScanText,
  Smartphone,
  Sparkles,
  Zap,
} from "lucide-react";

import { early, type FeatureIcon } from "../../content/early";
import { GlassBadge } from "../visual/GlassSurface";
import { IsoIllustration } from "../visual/IsoIllustration";
import { Reveal } from "../visual/Reveal";
import { WhatsAppChatMock } from "../visual/WhatsAppChatMock";

import { PhoneCapture } from "./PhoneCapture";

import type { ReactNode } from "react";

const ICONS: Record<FeatureIcon, typeof Zap> = {
  scan: ScanText,
  whatsapp: MessageCircle,
  file: FileText,
  zap: Zap,
  smartphone: Smartphone,
  sparkles: Sparkles,
  clock: Clock,
};

/** Eyebrow + title (+ body) shared by every section. */
function Heading({
  eyebrow,
  title,
  body,
  dark = false,
  center = true,
}: {
  eyebrow: string;
  title: string;
  body?: string;
  dark?: boolean;
  center?: boolean;
}) {
  return (
    <div className={center ? "mx-auto max-w-2xl text-center" : "max-w-xl"}>
      <p className={`text-sm font-bold ${dark ? "text-[#93c5fd]" : "text-[#1e3a8a]"}`}>{eyebrow}</p>
      <h2
        className={`mt-3 text-[clamp(1.7rem,1.1rem+2.2vw,2.6rem)] font-bold leading-[1.35] ${
          dark ? "text-white" : "text-[#0b1220]"
        }`}
      >
        {title}
      </h2>
      {body ? (
        <p
          className={`mt-4 text-lg leading-[1.85] ${dark ? "text-white/75" : "text-[#0b1220]/70"}`}
        >
          {body}
        </p>
      ) : null}
    </div>
  );
}

function Section({
  id,
  children,
  className = "",
}: {
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`relative px-5 py-20 sm:px-8 sm:py-28 ${className}`}>
      <div className="mx-auto max-w-6xl">{children}</div>
    </section>
  );
}

const cardShadow = "shadow-[0_1px_2px_rgb(11_18_32/0.04),0_14px_34px_-14px_rgb(30_58_138/0.18)]";

export function FeatureBento() {
  const { features } = early;
  const last = features.items.length - 1;
  return (
    <Section id={features.id} className="border-t border-[#0b1220]/8">
      <Reveal>
        <Heading eyebrow={features.eyebrow} title={features.title} />
      </Reveal>
      <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {features.items.map((item, index) => {
          const Icon = ICONS[item.icon];
          // 7 cards: the first is wide on the 3-column grid, the last fills the odd slot of the 2-column one.
          const span = index === 0 ? "lg:col-span-2" : index === last ? "sm:col-span-2" : "";
          return (
            <Reveal key={item.title} delay={(index % 3) * 70} className={span}>
              <article
                className={`early-card h-full rounded-[26px] bg-white p-6 ring-1 ring-[#0b1220]/6 sm:p-7 ${cardShadow}`}
              >
                <span className="early-card-icon grid size-12 place-items-center rounded-2xl bg-[#e3eafb] text-[#1e3a8a]">
                  <Icon className="size-6" aria-hidden="true" />
                </span>
                <h3 className="mt-5 text-xl font-bold leading-snug">{item.title}</h3>
                <p className="mt-2 text-base leading-[1.8] text-[#0b1220]/70">{item.body}</p>
              </article>
            </Reveal>
          );
        })}
      </div>
    </Section>
  );
}

export function WhatsAppSection() {
  const { whatsapp } = early;
  return (
    <section id={whatsapp.id} className="early-dark px-5 py-20 text-white sm:px-8 sm:py-28">
      <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <Reveal>
          <Heading
            eyebrow={whatsapp.eyebrow}
            title={whatsapp.title}
            body={whatsapp.body}
            dark
            center={false}
          />
          <ul className="mt-8 space-y-3">
            {whatsapp.points.map((point) => (
              <li key={point} className="flex items-center gap-3 text-[17px] text-white/90">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[#25d366]/20 text-[#25d366]">
                  <Check className="size-3.5" strokeWidth={3.5} aria-hidden="true" />
                </span>
                {point}
              </li>
            ))}
          </ul>
        </Reveal>
        <Reveal delay={120} className="mx-auto w-full max-w-md">
          <WhatsAppChatMock />
        </Reveal>
      </div>
    </section>
  );
}

export function HowItWorks() {
  const { how } = early;
  return (
    <Section id={how.id}>
      <Reveal>
        <Heading eyebrow={how.eyebrow} title={how.title} />
      </Reveal>
      <ol className="mt-14 grid gap-6 lg:grid-cols-3">
        {how.steps.map((step, index) => (
          <Reveal key={step.kind} delay={index * 90} as="li">
            <div
              className={`h-full rounded-[28px] bg-white p-6 text-center ring-1 ring-[#0b1220]/6 sm:p-8 ${cardShadow}`}
            >
              <div className="mx-auto grid h-40 place-items-center">
                <IsoIllustration kind={step.kind} className="h-full w-auto" />
              </div>
              <span className="mx-auto mt-4 grid size-8 place-items-center rounded-full bg-[#1e3a8a] text-sm font-bold text-white">
                {index + 1}
              </span>
              <h3 className="mt-3 text-xl font-bold">{step.title}</h3>
              <p className="mx-auto mt-2 max-w-[30ch] text-base leading-[1.8] text-[#0b1220]/70">
                {step.body}
              </p>
            </div>
          </Reveal>
        ))}
      </ol>
    </Section>
  );
}

export function FoundingPerks() {
  const { perks } = early;
  return (
    <Section className="pt-0 sm:pt-0">
      <Reveal>
        <div className="relative overflow-hidden rounded-[32px] bg-linear-to-br from-white via-white to-[#e3eafb] p-7 shadow-[0_2px_4px_rgb(11_18_32/0.04),0_30px_70px_-30px_rgb(30_58_138/0.35)] ring-1 ring-[#1e3a8a]/10 sm:p-12">
          <GlassBadge className="px-4 py-1.5 text-sm font-bold text-[#1e3a8a]">
            {perks.ribbon}
          </GlassBadge>
          <div className="mt-5 grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-center">
            <div>
              <p className="text-sm font-bold text-[#1e3a8a]">{perks.eyebrow}</p>
              <h2 className="mt-3 text-[clamp(1.7rem,1.1rem+2.2vw,2.6rem)] font-bold leading-[1.35]">
                {perks.title}
              </h2>
              <p className="mt-4 max-w-md text-lg leading-[1.85] text-[#0b1220]/70">{perks.body}</p>
              <a
                href="#join"
                className="mt-7 inline-flex min-h-12 items-center rounded-2xl bg-[#1e3a8a] px-7 font-bold text-white shadow-[0_8px_20px_-8px_rgb(30_58_138/0.7)] transition-colors hover:bg-[#172e6e] focus-visible:outline-none focus-visible:shadow-focus"
              >
                {early.header.cta}
              </a>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2">
              {perks.items.map((item) => (
                <li
                  key={item}
                  className="flex items-center gap-3 rounded-2xl bg-white/80 p-4 text-[16px] font-semibold ring-1 ring-[#0b1220]/6"
                >
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#1e3a8a] text-white">
                    <Check className="size-4" strokeWidth={3.5} aria-hidden="true" />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Reveal>
    </Section>
  );
}

function StoreBadge({ icon, pre, name }: { icon: ReactNode; pre: string; name: string }) {
  return (
    <div
      role="img"
      aria-label={`${name}: ${early.apps.soon}`}
      className="relative inline-flex min-h-16 items-center gap-3 rounded-2xl bg-[#0b1220] px-6 py-3 text-white opacity-90"
    >
      <span aria-hidden="true">{icon}</span>
      <span className="text-start leading-tight" aria-hidden="true">
        <span className="block text-xs text-white/70">{pre}</span>
        <span className="block text-lg font-bold" dir="ltr">
          {name}
        </span>
      </span>
      <span
        aria-hidden="true"
        className="absolute -top-2.5 end-3 rounded-full bg-[#d4902e] px-2.5 py-0.5 text-xs font-bold text-white"
      >
        {early.apps.soon}
      </span>
    </div>
  );
}

export function AppsSoon() {
  const { apps } = early;
  return (
    <Section className="border-t border-[#0b1220]/8">
      <Reveal>
        <Heading eyebrow={apps.eyebrow} title={apps.title} body={apps.body} />
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <StoreBadge
            icon={<Apple className="size-8" />}
            pre={apps.appStore.pre}
            name={apps.appStore.name}
          />
          <StoreBadge
            icon={<Play className="size-7" />}
            pre={apps.googlePlay.pre}
            name={apps.googlePlay.name}
          />
        </div>
      </Reveal>
    </Section>
  );
}

export function Faq() {
  const { faq } = early;
  return (
    <Section id={faq.id} className="border-t border-[#0b1220]/8">
      <Reveal>
        <Heading eyebrow={faq.eyebrow} title={faq.title} />
      </Reveal>
      <div className="early-faq mx-auto mt-12 max-w-3xl divide-y divide-[#0b1220]/8 rounded-[28px] bg-white px-5 ring-1 ring-[#0b1220]/6 sm:px-8">
        {faq.items.map((item) => (
          <details key={item.question} className="py-1">
            <summary className="flex min-h-14 items-center justify-between gap-4 py-3 text-start text-[17px] font-bold leading-snug focus-visible:outline-none focus-visible:shadow-focus">
              <span>{item.question}</span>
              <ChevronDown
                className="early-faq-chevron size-5 shrink-0 text-[#64708a]"
                aria-hidden="true"
              />
            </summary>
            <p className="max-w-[65ch] pb-5 text-base leading-[1.9] text-[#0b1220]/75">
              {item.answer}
            </p>
          </details>
        ))}
      </div>
    </Section>
  );
}

export function FinalCta({
  detectedCountry,
  nonce,
  counter,
}: {
  detectedCountry: string | null;
  nonce: string | undefined;
  counter: string | null;
}) {
  const { cta } = early;
  return (
    <Section className="pb-24 sm:pb-32">
      <Reveal>
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-[clamp(1.9rem,1.2rem+2.6vw,3rem)] font-bold leading-[1.3]">
            {cta.title}
          </h2>
          <p className="mx-auto mt-4 max-w-md text-lg leading-[1.85] text-[#0b1220]/70">
            {cta.body}
          </p>
          <div className="mx-auto mt-9 max-w-xl text-start">
            <PhoneCapture id="join-final" detectedCountry={detectedCountry} nonce={nonce} />
          </div>
          {counter ? (
            <p className="mt-4 inline-flex items-center gap-2 text-[15px] font-semibold tabular-nums text-[#1e3a8a]">
              <span aria-hidden="true" className="early-live size-2 rounded-full bg-[#2563eb]" />
              {cta.counter(counter)}
            </p>
          ) : null}
        </div>
      </Reveal>
    </Section>
  );
}
