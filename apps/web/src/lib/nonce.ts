import "server-only";

import { headers } from "next/headers";

/** The CSP nonce `proxy.ts` generated for this request, for the client scripts we inject (Turnstile). */
export async function getNonce(): Promise<string | undefined> {
  return (await headers()).get("x-nonce") ?? undefined;
}
