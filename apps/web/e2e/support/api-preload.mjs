// Loaded into the API process with `node --import`. Better Auth's breached-password check calls
// api.pwnedpasswords.com on every sign-up; the suite must not depend on that service being up, so
// this answers it with "not breached". Everything else, Cloudflare Turnstile included, is untouched.
const realFetch = globalThis.fetch;

globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("https://api.pwnedpasswords.com/range/")) {
    return Promise.resolve(new Response("0000000000000000000000000000000000A:1"));
  }
  return realFetch(input, init);
};
