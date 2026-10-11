import { expect } from "@playwright/test";

import type { Redis } from "ioredis";

/** Where the worker's capture transport keeps mail (apps/worker/src/notifications/transport.ts). */
const CAPTURE_KEY = "mail:capture";

export interface CapturedMail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Newest first, like the list in Redis. */
async function captured(redis: Redis): Promise<CapturedMail[]> {
  const rows = await redis.lrange(CAPTURE_KEY, 0, -1);
  return rows.map((row) => JSON.parse(row) as CapturedMail);
}

/** An http(s) URL that contains `needle`. */
const linkPattern = (needle: string) => new RegExp(String.raw`https?://\S*${needle}\S*`);

/** First link in the mail's plain-text part that contains `needle` (the action link). */
export function linkIn(mail: CapturedMail, needle: string): string {
  const link = linkPattern(needle).exec(mail.text)?.[0];
  if (!link) throw new Error(`No ${needle} link in the mail to ${mail.to}`);
  return link;
}

/** Waits for the newest mail to `to` that has a link containing `needle` (no fixed sleeps). */
export async function waitForMailLink(redis: Redis, to: string, needle: string): Promise<string> {
  let found: CapturedMail | undefined;
  await expect
    .poll(
      async () => {
        found = (await captured(redis)).find(
          (mail) => mail.to === to && linkPattern(needle).test(mail.text),
        );
        return found !== undefined;
      },
      { message: `mail with a ${needle} link to ${to}`, timeout: 20_000 },
    )
    .toBe(true);
  if (!found) throw new Error("unreachable");
  return linkIn(found, needle);
}
