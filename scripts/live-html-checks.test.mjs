import assert from "node:assert/strict";
import { test } from "node:test";

import { REQUIRED_HEADERS, checkPage } from "./live-html-checks.mjs";

const headers = Object.fromEntries(REQUIRED_HEADERS.map((name) => [name, "x"]));
const clean =
  '<html><script nonce="abc" src="/a.js"></script><script type="application/ld+json" nonce="abc">{}</script></html>';

test("a clean page passes", () => {
  const { errors, warnings } = checkPage({ url: "u", html: clean, headers });
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});

test("Cloudflare email obfuscation fails", () => {
  const html = `${clean}<span class="__cf_email__">x</span><a href="/cdn-cgi/l/email-protection">`;
  const { errors } = checkPage({ url: "u", html, headers });
  assert.equal(errors.length, 2);
});

test("a script without a nonce fails", () => {
  const { errors } = checkPage({ url: "u", html: '<script src="/x.js"></script>', headers });
  assert.equal(errors.length, 1);
});

test("missing headers fail", () => {
  const { errors } = checkPage({ url: "u", html: clean, headers: {} });
  assert.equal(errors.length, REQUIRED_HEADERS.length);
});

test("challenge-platform warns, and fails only in strict mode", () => {
  const html = `${clean}<!-- /cdn-cgi/challenge-platform/scripts/jsd/main.js -->`;
  assert.equal(checkPage({ url: "u", html, headers }).warnings.length, 1);
  assert.equal(checkPage({ url: "u", html, headers }).errors.length, 0);
  assert.equal(checkPage({ url: "u", html, headers }, { strict: true }).errors.length, 1);
});
