/*
 * Fixed ports and URLs of the end-to-end stack. They are fixed (not "any free port") because
 * NEXT_PUBLIC_API_URL is inlined into the web bundle at build time, so the web build has to know
 * where its API will listen. Override the base with E2E_PORT_BASE if 3210/4210 are taken.
 */
const BASE = Number(process.env["E2E_PORT_BASE"] ?? 3210);
const API_OFFSET = 1000;

/** `next dev` of the hydration project (e2e/hydration.spec.ts): beside the default web, same API. */
export const HYDRATION_DEV_PORT = BASE + 50;

export type StackName = "default" | "turnstile";

export interface StackPorts {
  web: number;
  api: number;
}

export const STACK_PORTS: Record<StackName, StackPorts> = {
  default: { web: BASE, api: BASE + API_OFFSET },
  turnstile: { web: BASE + 1, api: BASE + API_OFFSET + 1 },
};

/** `localhost`, not 127.0.0.1: browsers accept the API's Secure session cookie on it over http. */
export const originOf = (port: number): string => `http://localhost:${port}`;

/** Cloudflare's public test keys: the widget always passes and the secret accepts any token. */
export const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";
export const TURNSTILE_TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";

/** The business WhatsApp number the API tells users to message (digits, with country code). */
export const WHATSAPP_NUMBER = "201555000111";

/** Set `E2E_SKIP_TURNSTILE=1` on a machine without internet: the Turnstile stack and spec are skipped. */
export const skipTurnstile = (): boolean => process.env["E2E_SKIP_TURNSTILE"] === "1";
