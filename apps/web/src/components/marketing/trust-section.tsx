import { Container, buttonStyles } from "@wasfa/ui";
import { Languages, Lock, ShieldCheck, Stethoscope } from "lucide-react";
import Link from "next/link";

import { landing, type TrustIcon } from "../../content/landing";

import { SectionHeading } from "./section-heading";

const { trust } = landing;

const ICONS = {
  shield: ShieldCheck,
  lock: Lock,
  stethoscope: Stethoscope,
  languages: Languages,
} as const satisfies Record<TrustIcon, unknown>;

export function TrustSection() {
  return (
    <section aria-labelledby="trust-title" className="py-12 sm:py-20">
      <Container>
        <div className="rounded-2xl bg-surface p-6 shadow-raised sm:p-10">
          <SectionHeading id="trust-title" title={trust.title} lead={trust.lead} />
          <ul className="mt-10 grid gap-8 sm:grid-cols-2">
            {trust.items.map((item) => {
              const Icon = ICONS[item.icon];
              return (
                <li key={item.title} className="flex items-start gap-4">
                  <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
                    <Icon aria-hidden="true" className="size-6" />
                  </span>
                  <div>
                    <h3 className="font-heading text-xl font-semibold text-text">{item.title}</h3>
                    <p className="mt-1 text-base text-text-muted">{item.body}</p>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row">
            <Link href="/privacy" className={buttonStyles({ variant: "secondary" })}>
              {trust.privacyLink}
            </Link>
            <Link href="/disclaimer" className={buttonStyles({ variant: "secondary" })}>
              {trust.disclaimerLink}
            </Link>
          </div>
        </div>
      </Container>
    </section>
  );
}
