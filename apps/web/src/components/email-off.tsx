import type { ReactNode } from "react";

/*
 * Cloudflare's Email Address Obfuscation rewrites every address in the HTML into a `__cf_email__`
 * span plus an injected decoder script. The rewrite breaks hydration (React error #418) and the
 * script carries no nonce, so the CSP blocks it. Cloudflare leaves alone whatever sits between
 * `<!--email_off-->` and `<!--/email_off-->`; React cannot render comments, so each marker is the
 * inner HTML of an empty span (never compared during hydration). Holds whatever the zone setting is.
 */
const OPEN = { __html: "<!--email_off-->" };
const CLOSE = { __html: "<!--/email_off-->" };

export function EmailOff({ children }: { children: ReactNode }) {
  return (
    <>
      <span hidden dangerouslySetInnerHTML={OPEN} />
      {children}
      <span hidden dangerouslySetInnerHTML={CLOSE} />
    </>
  );
}
