import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { HYDRATION_DEV_PORT, originOf } from "./support/config";
import { expect, test, watchCsp } from "./support/fixtures";

/*
 * Phase 4 WP1 §1.4: no public page may hydrate with a mismatch. React only reports hydration
 * problems in full in a development build (the production build keeps just the minified error
 * #418/#423/#425), so this project runs `next dev` next to the e2e stack, pointed at its API, and
 * opens every public template in the browser. The page list is `PUBLIC_PAGES` (both languages), so
 * a new public page is covered the moment it is added there.
 *
 * Failing signals: a console message with hydration text, any uncaught page error, any CSP
 * violation. Run it alone with `pnpm --filter @wasfa/web exec playwright test --project=hydration-dev`.
 */

const WEB_DIR = fileURLToPath(new URL("../", import.meta.url));
const LOG_DIR = `${WEB_DIR}e2e/.logs`;
const DEV_DIST_DIR = ".next-e2e-hydration";

const HYDRATION_TEXT =
  /hydrat|did not match|server rendered html|text content does not match|Minified React error #(?:418|423|425)\b/i;

/*
 * The page table is read as text, not imported: importing app code would pull the app's types into
 * the e2e TypeScript program. Every `path:` / `pathEn:` string in `PUBLIC_PAGES` is a public URL.
 */
const SEO_SOURCE = readFileSync(`${WEB_DIR}src/lib/seo.ts`, "utf8");
const TABLE = SEO_SOURCE.slice(
  SEO_SOURCE.indexOf("export const PUBLIC_PAGES"),
  SEO_SOURCE.indexOf("as const satisfies"),
);
const PATHS = [
  ...new Set([...TABLE.matchAll(/\bpath(?:En)?: "(\/[^"]*)"/g)].map((match) => match[1] ?? "/")),
];

let devServer: ChildProcess | undefined;

function stopDevServer(): void {
  const pid = devServer?.pid;
  if (pid === undefined || devServer?.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    // The dev server forks a compiler process: signal the whole group.
    process.kill(-pid, "SIGTERM");
  }
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ urls }) => {
  test.setTimeout(180_000);
  mkdirSync(LOG_DIR, { recursive: true });
  const fd = openSync(`${LOG_DIR}/web-hydration-dev.log`, "w");
  const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^(NEXT_|NODE_ENV$|API_|CSP_|PORT$|HOST$|HOSTNAME$)/.test(key)) env[key] = value;
  }
  const origin = originOf(HYDRATION_DEV_PORT);
  devServer = spawn(process.execPath, [nextBin, "dev", "--port", String(HYDRATION_DEV_PORT)], {
    cwd: WEB_DIR,
    env: {
      ...env,
      NEXT_PUBLIC_ENV: "development",
      NEXT_PUBLIC_SITE_URL: origin,
      NEXT_PUBLIC_API_URL: urls.api,
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "",
      NEXT_DIST_DIR: DEV_DIST_DIR,
      NEXT_TELEMETRY_DISABLED: "1",
      API_INTERNAL_URL: urls.api,
    },
    stdio: ["ignore", fd, fd],
    detached: process.platform !== "win32",
  });
  closeSync(fd);

  const deadline = Date.now() + 120_000;
  for (;;) {
    if (devServer.exitCode !== null) {
      throw new Error(`next dev exited early; see ${LOG_DIR}/web-hydration-dev.log`);
    }
    if (
      await fetch(`${origin}/healthz`).then(
        (response) => response.ok,
        () => false,
      )
    )
      break;
    if (Date.now() > deadline) throw new Error("next dev was not ready after 120 s");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
});

test.afterAll(() => {
  stopDevServer();
});

for (const path of PATHS) {
  test(`${path} hydrates without warnings`, async ({ page }) => {
    // The first visit compiles the route on demand.
    test.setTimeout(120_000);
    const problems: string[] = [];
    page.on("console", (message) => {
      const type = message.type();
      if ((type === "error" || type === "warning") && HYDRATION_TEXT.test(message.text())) {
        problems.push(`console.${type}: ${message.text()}`);
      }
    });
    page.on("pageerror", (error) => {
      problems.push(`pageerror: ${error.message}`);
    });
    const csp = await watchCsp(page);

    const response = await page.goto(path);
    expect(response?.status(), `${path} status`).toBe(200);
    await expect(page.locator("h1").first()).toBeVisible();
    // Hydration runs after the scripts load. Not `networkidle`: the dev server keeps requests open
    // (HMR, streamed chunks), so it never settles; a fixed pause covers late client-only updates.
    await page.waitForLoadState("load");
    await page.waitForTimeout(2_000);

    // `next dev` mounts its devtools overlay with inline styles that the nonce CSP blocks; that is
    // dev-only tooling, not our pages (the production build is checked by `csp.spec.ts`).
    const devTooling = (violation: string) =>
      violation.includes("next-devtools") || violation.startsWith("Applying inline style");
    problems.push(
      ...(await csp.violations())
        .filter((violation) => !devTooling(violation))
        .map((violation) => `csp: ${violation}`),
    );
    expect(problems).toEqual([]);
  });
}
