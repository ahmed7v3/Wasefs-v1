import { t } from "@wasfa/shared/i18n";
import { Card, Container } from "@wasfa/ui";
import { Languages, Pill, ScanText, ShieldCheck } from "lucide-react";

import type { Metadata } from "next";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

const pills = [
  { key: "home.pill.accuracy", Icon: ScanText },
  { key: "home.pill.privacy", Icon: ShieldCheck },
  { key: "home.pill.arabic", Icon: Languages },
] as const;

export default function HomePage() {
  return (
    <div className="page-backdrop min-h-dvh">
      <Container className="flex min-h-dvh flex-col py-6">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-lg bg-primary text-on-primary shadow-card">
              <Pill className="size-6" aria-hidden="true" />
            </span>
            <span className="font-heading text-2xl font-bold text-primary">{t("brand.name")}</span>
          </div>
          <span className="rounded-full bg-accent-soft px-4 py-1 font-heading text-sm font-semibold text-primary">
            {t("home.badge")}
          </span>
        </header>

        <main id="main" className="flex flex-1 items-center py-10 sm:py-16">
          <Card elevation="raised" className="mx-auto w-full max-w-reading text-center sm:p-12">
            <h1 className="font-heading text-4xl font-bold text-primary sm:text-5xl">
              {t("home.headline")}
            </h1>
            <p className="mx-auto mt-5 max-w-prose text-lg text-text-muted">
              {t("home.valueProp")}
            </p>
            <ul className="mt-8 flex flex-wrap items-center justify-center gap-3">
              {pills.map(({ key, Icon }) => (
                <li
                  key={key}
                  className="flex items-center gap-2 rounded-full border border-border bg-bg px-4 py-2 text-sm text-text"
                >
                  <Icon className="size-4 text-primary" aria-hidden="true" />
                  {t(key)}
                </li>
              ))}
            </ul>
          </Card>
        </main>

        <footer className="pb-2 text-center text-sm text-text-muted">{t("home.disclaimer")}</footer>
      </Container>
    </div>
  );
}
