#!/usr/bin/env node
/**
 * Fetches the key public pages of the live site and fails on Cloudflare rewrites, un-nonced
 * scripts and missing security headers. Usage:
 *   node scripts/check-live-html.mjs [baseUrl] [--strict]
 * Base URL: argument, else LIVE_BASE_URL, else https://wasfa.online. `--strict` also fails on
 * Cloudflare's JavaScript Detections injector (/cdn-cgi/challenge-platform/).
 * LIVE_CHECK_TOKEN, when set, is sent as `x-wasfa-live-check`: a Cloudflare WAF rule matching it
 * skips bot protection, which otherwise challenges requests from CI runners (datacenter IPs).
 */
import { checkPage } from "./live-html-checks.mjs";

const PATHS = ["/", "/pricing", "/contact", "/register", "/privacy"];

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const base = (
  args.find((arg) => !arg.startsWith("--")) ??
  process.env.LIVE_BASE_URL ??
  "https://wasfa.online"
).replace(/\/+$/, "");

const errors = [];
const warnings = [];
let checked = 0;

for (const path of PATHS) {
  const url = `${base}${path}`;
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        "user-agent": "wasfa-live-html-check",
        "accept-language": "ar",
        ...(process.env.LIVE_CHECK_TOKEN
          ? { "x-wasfa-live-check": process.env.LIVE_CHECK_TOKEN }
          : {}),
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      // A Cloudflare challenge is the edge refusing this client, not the site failing. Without a
      // token it only means the page could not be checked; with one, the WAF skip rule is wrong.
      const mitigated = response.headers.get("cf-mitigated");
      if (mitigated) {
        (process.env.LIVE_CHECK_TOKEN ? errors : warnings).push(
          `${url}: not checked, Cloudflare bot protection answered (cf-mitigated: ${mitigated}); ` +
            "add the WAF skip rule for x-wasfa-live-check and the LIVE_CHECK_TOKEN secret",
        );
      } else {
        errors.push(`${url}: HTTP ${response.status}`);
      }
      continue;
    }
    checked += 1;
    const result = checkPage(
      { url, html: await response.text(), headers: response.headers },
      { strict },
    );
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  } catch (error) {
    errors.push(`${url}: request failed (${error instanceof Error ? error.message : error})`);
  }
}

for (const line of warnings) process.stdout.write(`WARN ${line}\n`);
for (const line of errors) process.stdout.write(`FAIL ${line}\n`);
if (errors.length > 0) process.exit(1);
process.stdout.write(`OK ${checked} of ${PATHS.length} pages checked and clean on ${base}\n`);
