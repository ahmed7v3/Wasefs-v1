import { headers } from "next/headers";

import { EarlyFooter } from "../../../components/early/EarlyFooter";
import { EarlyHeader } from "../../../components/early/EarlyHeader";
import { getEarlyJoined } from "../../../lib/early-stats";

import "./early.css";

import type { ReactNode } from "react";

/** `/`, `/early` and either with a query or hash: the landing page itself (anchors stay on the page). */
const HOME_PATH = /^(\/early)?\/?(\?|#|$)/;

/**
 * Frame of the pre-launch subdomain. It sits directly under the root layout (`<html>`, fonts, skip
 * link) and deliberately shares nothing with `(marketing)/layout.tsx`: no main-site header, footer,
 * contact hub or lattice. The root layout's skip link targets `#main`.
 */
export default async function EarlyLayout({ children }: { children: ReactNode }) {
  const [joined, requestHeaders] = await Promise.all([getEarlyJoined(), headers()]);
  const path = requestHeaders.get("x-pathname") ?? "/";
  return (
    <div className="early-root relative isolate flex min-h-svh flex-col">
      <EarlyHeader joined={joined} home={HOME_PATH.test(path)} />
      <main id="main" className="flex-1">
        {children}
      </main>
      <EarlyFooter />
    </div>
  );
}
