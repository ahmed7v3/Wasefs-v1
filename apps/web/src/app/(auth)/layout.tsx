import { Card, Container, ToastProvider } from "@wasfa/ui";

import { SiteBrandMark } from "../../components/site-brand-mark";

import type { Metadata } from "next";
import type { ReactNode } from "react";

// Sign-in screens are for people, not for search results.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/** Shared frame of every auth screen: brand mark over one raised card, centred, 360 px first. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <div className="page-backdrop min-h-dvh">
        <Container
          width="reading"
          className="flex min-h-dvh flex-col items-center gap-6 py-8 sm:justify-center"
        >
          <SiteBrandMark />
          <main id="main" className="w-full max-w-md">
            <Card elevation="raised">{children}</Card>
          </main>
        </Container>
      </div>
    </ToastProvider>
  );
}
