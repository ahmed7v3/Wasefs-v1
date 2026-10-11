import { test as base, expect, type Page } from "@playwright/test";
import { Redis } from "ioredis";

import { runtime, stackUrls, type StackUrls } from "./runtime";
import { bridgeGone } from "./whatsapp";

interface TestFixtures {
  /** Web and API addresses of the stack this project runs against. */
  urls: StackUrls;
  /** Clean Redis state before each test (rate-limit counters, WhatsApp heartbeat). */
  cleanState: undefined;
}

interface WorkerFixtures {
  redis: Redis;
}

/** Redis keys that limit per client IP: every test comes from 127.0.0.1, so they would add up. */
const COUNTER_PATTERNS = ["auth:rl:*", "auth:fail:*", "rl:*"];

async function deleteKeys(redis: Redis, pattern: string): Promise<void> {
  const keys: string[] = [];
  for await (const batch of redis.scanStream({ match: pattern, count: 200 })) {
    keys.push(...(batch as string[]));
  }
  if (keys.length > 0) await redis.del(...keys);
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  redis: [
    async ({}, use) => {
      const redis = new Redis(runtime().redisUrl, { maxRetriesPerRequest: 3 });
      await use(redis);
      await redis.quit();
    },
    { scope: "worker" },
  ],

  urls: async ({}, use, testInfo) => {
    await use(stackUrls(testInfo.project.name === "turnstile" ? "turnstile" : "default"));
  },

  cleanState: [
    async ({ redis }, use) => {
      // The limits themselves are the production ones; only the counters are reset between tests.
      for (const pattern of COUNTER_PATTERNS) await deleteKeys(redis, pattern);
      // The bridge is "down" unless a test says otherwise: a connected bridge makes the phone step mandatory.
      await bridgeGone(redis);
      await use(undefined);
    },
    { auto: true },
  ],
});

export { expect };

declare global {
  interface Window {
    __cspViolations?: string[];
  }
}

export interface CspWatch {
  /** Violations seen so far: `securitypolicyviolation` events plus console messages about the CSP. */
  violations: () => Promise<string[]>;
}

/** Start before the first navigation; it records anything the browser refuses because of the CSP. */
export async function watchCsp(page: Page): Promise<CspWatch> {
  const consoleHits: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (/content security policy|violates the following/i.test(text)) consoleHits.push(text);
  });
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      window.__cspViolations?.push(
        `${event.violatedDirective} ${event.blockedURI} at ${location.pathname} (${event.sourceFile}:${String(event.lineNumber)})`,
      );
    });
  });
  return {
    violations: async () => [
      ...(await page.evaluate(() => window.__cspViolations ?? [])),
      ...consoleHits,
    ],
  };
}
