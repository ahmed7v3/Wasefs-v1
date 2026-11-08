"use client";

import dynamic from "next/dynamic";

import type { WhatsAppLoginProps } from "./whatsapp-login";

// The login panel pulls the whole message catalogue, the API client and Turnstile (hundreds of KB
// raw) into a page that otherwise needs none of it. The home hero fetches it after the page; the
// reserved height keeps the layout from shifting when it arrives.
const WhatsAppLogin = dynamic(
  () => import("./whatsapp-login").then((module) => module.WhatsAppLogin),
  { ssr: false, loading: () => <div aria-hidden="true" className="min-h-12" /> },
);

export function WhatsAppLoginLazy(props: WhatsAppLoginProps) {
  return <WhatsAppLogin {...props} />;
}
