"use client";

import dynamic from "next/dynamic";

// The form (zod, schema, API client, error notice) is below the fold and only shown while the
// waitlist is switched on: it is fetched after the page, not as part of its first load.
export const AppWaitlistFormLazy = dynamic(
  () => import("./app-waitlist-form").then((module) => module.AppWaitlistForm),
  { ssr: false },
);
