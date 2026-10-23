"use client";

import { lazy, Suspense } from "react";

import "../styles/globals.css";

// Lazy for the same reason as error.tsx: keep the message catalogue out of every first load.
const GlobalErrorView = lazy(() => import("../components/global-error-view"));

/** Last resort when the root layout itself fails: it replaces the layout, so it renders <html>. */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="ar" dir="rtl">
      <body className="grid min-h-dvh place-items-center bg-bg p-6 text-center text-text">
        <Suspense fallback={null}>
          <GlobalErrorView reset={reset} />
        </Suspense>
      </body>
    </html>
  );
}
