#!/usr/bin/env node
/**
 * Fetches the key public pages of the live site and fails on Cloudflare rewrites, un-nonced
 * scripts and missing security headers. Usage:
 *   node scripts/check-live-html.mjs [baseUrl] [--strict]
 * Base URL: argument, else LIVE_BASE_URL, else https://wasfa.online. `--strict` also fails on
 * Cloudflare's JavaScript Detections injector (/cdn-cgi/challenge-platform/).
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

for (const path of PATHS) {
  const url = `${base}${path}`;
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": "wasfa-live-html-check", "accept-language": "ar" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      errors.push(`${url}: HTTP ${response.status}`);
      continue;
    }
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
process.stdout.write(`OK ${PATHS.length} pages clean on ${base}\n`);
