import { defineConfig, devices } from "@playwright/test";

import { STACK_PORTS, originOf } from "./e2e/support/config";

/*
 * End-to-end suite against the real stack (API, worker, web, Postgres, Redis). `pnpm build` first;
 * `globalSetup` boots everything and builds the web app (see e2e/support/stack.ts).
 *
 * One worker, no parallelism: all traffic comes from 127.0.0.1 (per-IP limits), mail and the
 * WhatsApp heartbeat are shared Redis state, and a phone-verification test changes what every
 * other onboarding sees. Determinism matters more than speed here.
 */
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env["CI"]),
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  outputDir: "test-results",
  use: {
    baseURL: originOf(STACK_PORTS.default.web),
    locale: "ar",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      testIgnore: /turnstile\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      // Only the accessibility pass runs at phone width (the flows are the same).
      name: "mobile",
      testMatch: /a11y\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 360, height: 800 } },
    },
    {
      name: "turnstile",
      testMatch: /turnstile\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        baseURL: originOf(STACK_PORTS.turnstile.web),
      },
    },
  ],
});
