import { Card, Container } from "@wasfa/ui";

import { SiteBrandMark } from "../../../components/site-brand-mark";

import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/** The one-screen onboarding is a focused flow, not the app shell: brand mark over one raised card, like the auth screens. */
export default function WelcomeLayout({ children }: { children: ReactNode }) {
  return (
    <div className="page-backdrop min-h-dvh">
      <Container
        width="reading"
        className="flex min-h-dvh flex-col items-center gap-6 py-8 sm:justify-center"
      >
        <SiteBrandMark />
        <main id="main" className="w-full">
          <Card elevation="raised">{children}</Card>
        </main>
      </Container>
    </div>
  );
}
