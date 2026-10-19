import { t } from "@wasfa/shared/i18n";
import { Container, ToastProvider } from "@wasfa/ui";
import { notFound } from "next/navigation";

import { PhoneCapture } from "../../../components/capture/phone-capture";
import { getHandoffStatus } from "../../../lib/capture/handoff-status";

import type { Metadata } from "next";

// A capability URL: never indexed, and never sent along as a Referer to anything it links to.
export const metadata: Metadata = {
  title: t("capture.phonePage.title"),
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * The page a phone opens from the desktop's QR code. No sign-in: the token in the URL lets it add
 * up to four pages to that desktop session and nothing else.
 */
export default async function CapturePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const status = await getHandoffStatus(token);
  if (status === null) notFound();

  return (
    <div className="page-backdrop min-h-dvh">
      <Container width="reading" className="py-8">
        <main id="main" className="flex flex-col gap-6">
          <header className="flex flex-col gap-2">
            <h1 className="font-heading text-3xl font-bold text-primary">
              {t("capture.phonePage.title")}
            </h1>
            <p className="text-lg text-text-muted">{t("capture.phonePage.lead")}</p>
          </header>
          <ToastProvider>
            <PhoneCapture token={token} remaining={status.remaining} />
          </ToastProvider>
        </main>
      </Container>
    </div>
  );
}
