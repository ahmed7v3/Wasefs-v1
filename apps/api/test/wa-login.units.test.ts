import { WA_HEARTBEAT_KEY } from "@wasfa/shared/schemas/phone";
import { WA_LOGIN_TTL_SECONDS, parseLoginToken } from "@wasfa/shared/schemas/wa-login";
import { describe, expect, it } from "vitest";

import { AUTH_ROUTES, matchAuthRoute } from "../src/auth/auth.policy.js";
import { createWhatsAppUser } from "../src/auth/whatsapp-login/create-whatsapp-user.js";
import { deviceLabel } from "../src/auth/whatsapp-login/device-label.js";
import { whatsappLoginRefusal } from "../src/auth/whatsapp-login/refusal.js";
import {
  WaLoginStore,
  hashNonce,
  newLoginToken,
} from "../src/auth/whatsapp-login/wa-login.store.js";
import {
  WaLoginUnavailableError,
  WhatsAppLoginService,
  normalizeLoginToken,
} from "../src/auth/whatsapp-login/whatsapp-login.service.js";

import { silentLogger } from "./support/wa-agent-fakes.js";
import { LoginRedis, account } from "./support/wa-login-fakes.js";

import type { WhatsAppAccount } from "../src/auth/whatsapp-login/whatsapp-login.repo.js";
import type { WaLoginEntry } from "@wasfa/shared/schemas/wa-login";
import type { Redis } from "ioredis";

const PHONE = "+201012345678";
const JID = "201012345678@s.whatsapp.net";
const TTL_MS = WA_LOGIN_TTL_SECONDS * 1000;

function storeWith() {
  const redis = new LoginRedis();
  const store = new WaLoginStore(redis as unknown as Redis, () => redis.now);
  return { redis, store };
}

describe("login tokens", () => {
  it("are 8 Crockford characters that the bridge's parser accepts", () => {
    for (let index = 0; index < 50; index++) {
      const token = newLoginToken();
      expect(token).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
      expect(parseLoginToken(`WASFA-${token.slice(0, 4)}-${token.slice(4)}`)).toBe(token);
    }
  });

  it("normalizes what the page shows and rejects the rest", () => {
    expect(normalizeLoginToken("ab12-cd34")).toBe("AB12CD34");
    expect(normalizeLoginToken(" AB12 CD34 ")).toBe("AB12CD34");
    expect(normalizeLoginToken("AB12-CD3I")).toBeNull();
    expect(normalizeLoginToken("short")).toBeNull();
    expect(normalizeLoginToken(undefined)).toBeNull();
  });
});

describe("WaLoginStore", () => {
  it("keeps only the hash of the nonce", async () => {
    const { redis, store } = storeWith();
    const { token } = await store.create(hashNonce("nonce-1"), "Chrome · Windows");
    const stored = redis.hashes.get(`wa:login:${token}`);
    expect(stored?.get("nonceHash")).toBe(hashNonce("nonce-1"));
    expect([...(stored?.values() ?? [])]).not.toContain("nonce-1");
    expect(stored?.get("status")).toBe("pending");
  });

  it("claims a pending challenge exactly once", async () => {
    const { store } = storeWith();
    const { token } = await store.create(hashNonce("n"), "");
    expect(await store.claim(token)).toBe(true);
    expect(await store.claim(token)).toBe(false);
    expect(await store.claim("ZZZZZZZZ")).toBe(false);
  });

  it("does not claim an expired challenge", async () => {
    const { redis, store } = storeWith();
    const { token } = await store.create(hashNonce("n"), "");
    redis.now += TTL_MS + 1;
    expect(await store.claim(token)).toBe(false);
  });

  it("settles only a claimed challenge, and only once", async () => {
    const { store } = storeWith();
    const { token } = await store.create(hashNonce("n"), "");
    const approved = { status: "approved", userId: "u1", isNew: true } as const;
    expect(await store.settle(token, approved)).toBe(false);
    await store.claim(token);
    expect(await store.settle(token, approved)).toBe(true);
    expect(await store.settle(token, { status: "refused", reason: "inactive" })).toBe(false);
  });

  it("hands a result only to the browser holding the nonce, and only once", async () => {
    const { store } = storeWith();
    const { token } = await store.create(hashNonce("mine"), "");
    await store.claim(token);
    await store.settle(token, { status: "approved", userId: "u1", isNew: false });

    expect(await store.take(token, hashNonce("someone-else"))).toEqual({ status: "pending" });
    expect(await store.take("ZZZZZZZZ", hashNonce("mine"))).toEqual({ status: "pending" });
    expect(await store.take(token, hashNonce("mine"))).toEqual({
      status: "approved",
      userId: "u1",
      isNew: false,
    });
    // The result is gone: a replayed poll finds nothing, so no second session can follow.
    expect(await store.take(token, hashNonce("mine"))).toEqual({ status: "pending" });
  });

  it("reports refusals with their reason, and expiry to the right browser only", async () => {
    const { redis, store } = storeWith();
    const refused = await store.create(hashNonce("a"), "");
    await store.claim(refused.token);
    await store.settle(refused.token, { status: "refused", reason: "two_factor" });
    expect(await store.take(refused.token, hashNonce("a"))).toEqual({
      status: "refused",
      reason: "two_factor",
    });

    const idle = await store.create(hashNonce("b"), "");
    expect(await store.take(idle.token, hashNonce("b"))).toEqual({ status: "pending" });
    redis.now += TTL_MS + 1_000;
    expect(await store.take(idle.token, hashNonce("x"))).toEqual({ status: "pending" });
    expect(await store.take(idle.token, hashNonce("b"))).toEqual({ status: "expired" });
  });

  it("allows 5 claims an hour per number and scope, then says no", async () => {
    const { store } = storeWith();
    const results: boolean[] = [];
    for (let index = 0; index < 7; index++) results.push(await store.allowClaim("login", PHONE));
    expect(results).toEqual([true, true, true, true, true, false, false]);
    expect(await store.allowClaim("logout", PHONE)).toBe(true);
    expect(await store.allowClaim("login", "+201099999999")).toBe(true);
  });
});

describe("whatsappLoginRefusal", () => {
  it("lets an ordinary active account in", () => {
    expect(whatsappLoginRefusal(account())).toBeNull();
  });

  it.each([
    [{ twoFactorEnabled: true }, "two_factor"],
    [{ hasPlatformRole: true }, "privileged"],
    [{ status: "suspended" }, "inactive"],
    [{ status: "deleted" }, "inactive"],
    [{ anonymizedAt: new Date() }, "inactive"],
  ] as const)("refuses %j with %s", (overrides, reason) => {
    expect(whatsappLoginRefusal(account(overrides))).toBe(reason);
  });
});

describe("deviceLabel", () => {
  it("is a short browser and system label", () => {
    expect(
      deviceLabel(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      ),
    ).toBe("Chrome · Windows");
    expect(
      deviceLabel(
        "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 Edg/120.0",
      ),
    ).toBe("Edge · Windows");
    expect(
      deviceLabel(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1",
      ),
    ).toBe("Safari · iOS");
    expect(deviceLabel("Mozilla/5.0 (Android 14) Chrome/120 Mobile Safari/537.36")).toBe(
      "Chrome · Android",
    );
    expect(deviceLabel(null)).toBe("");
    expect(deviceLabel("curl/8.0")).toBe("");
  });
});

describe("createWhatsAppUser", () => {
  function deps(options: {
    existing?: WhatsAppAccount | null;
    insert?: "ok" | "taken";
    open?: boolean;
    winner?: WhatsAppAccount;
  }) {
    const inserted: Array<{ name: string; email: string; phone: string }> = [];
    let lookups = 0;
    return {
      inserted,
      deps: {
        repo: {
          findByVerifiedPhone: () => {
            lookups += 1;
            return Promise.resolve(
              lookups === 1 ? (options.existing ?? null) : (options.winner ?? null),
            );
          },
          insertUser: (input: { name: string; email: string; phone: string }) => {
            inserted.push(input);
            return Promise.resolve(
              options.insert === "taken" ? ("taken" as const) : { id: "new-1" },
            );
          },
          ensureReferralCode: () => Promise.resolve(),
        },
        signupOpen: () => Promise.resolve(options.open ?? true),
      },
    };
  }

  it("creates a verified, passwordless account with a placeholder email", async () => {
    const { deps: d, inserted } = deps({});
    expect(await createWhatsAppUser(d, { phone: PHONE, name: "  Mona\u0000 " })).toEqual({
      userId: "new-1",
      isNew: true,
    });
    expect(inserted[0]).toMatchObject({ name: "Mona", phone: PHONE });
    expect(inserted[0]?.email).toMatch(/^w[0-9a-f]{24}@phone\.wasfa\.invalid$/);
  });

  it("falls back to the default name", async () => {
    const { deps: d, inserted } = deps({});
    await createWhatsAppUser(d, { phone: PHONE });
    expect(inserted[0]?.name).toBe("مستخدم وصفة");
  });

  it("returns the existing owner of a verified number without creating anything", async () => {
    const { deps: d, inserted } = deps({ existing: account({ id: "old" }) });
    const result = await createWhatsAppUser(d, { phone: PHONE });
    expect(result).toMatchObject({ userId: "old", isNew: false });
    expect(inserted).toHaveLength(0);
  });

  it("treats a lost unique-phone race as the existing user", async () => {
    const { deps: d } = deps({ insert: "taken", winner: account({ id: "winner" }) });
    expect(await createWhatsAppUser(d, { phone: PHONE })).toMatchObject({
      userId: "winner",
      isNew: false,
    });
  });

  it("creates nobody while sign-up is closed", async () => {
    const { deps: d, inserted } = deps({ open: false });
    await expect(createWhatsAppUser(d, { phone: PHONE })).rejects.toMatchObject({
      name: "WhatsAppSignupClosedError",
    });
    expect(inserted).toHaveLength(0);
  });
});

describe("auth routes", () => {
  it("lists start (Turnstile always, 10/h per IP) and status (60/min per IP)", () => {
    const start = matchAuthRoute("POST", "/whatsapp/start")?.route;
    expect(start).toMatchObject({ turnstile: "always", perIp: { max: 10, windowSeconds: 3_600 } });
    const status = matchAuthRoute("GET", "/whatsapp/status")?.route;
    expect(status).toMatchObject({ perIp: { max: 60, windowSeconds: 60 }, query: ["token"] });
    expect(status?.turnstile).toBeUndefined();
    const magic = matchAuthRoute("POST", "/whatsapp/magic")?.route;
    expect(magic).toMatchObject({ perIp: { max: 20, windowSeconds: 900 } });
    expect(magic?.body).toBeDefined();
    expect(matchAuthRoute("GET", "/whatsapp/magic")).toBeUndefined();
    expect(matchAuthRoute("GET", "/whatsapp/start")).toBeUndefined();
    expect(matchAuthRoute("POST", "/whatsapp/status")).toBeUndefined();
    expect(AUTH_ROUTES.filter((route) => route.pattern.startsWith("/whatsapp"))).toHaveLength(3);
  });
});

describe("WhatsAppLoginService", () => {
  function setup(
    options: {
      whatsappLogin?: boolean;
      signupOpen?: boolean;
      existing?: WhatsAppAccount | null;
      bridge?: boolean;
      number?: string | null;
    } = {},
  ) {
    const { redis, store } = storeWith();
    if (options.bridge ?? true) {
      redis.values.set(WA_HEARTBEAT_KEY, JSON.stringify({ at: Date.now(), state: "connected" }));
    }
    const created: string[] = [];
    const revoked: Array<{ userId: string; since: Date }> = [];
    const audits: unknown[] = [];
    let current = options.existing ?? null;
    const repo = {
      findByVerifiedPhone: () => Promise.resolve(current),
      findById: (id: string) => Promise.resolve(current && current.id === id ? current : null),
      insertUser: (input: { phone: string }) => {
        created.push(input.phone);
        current = account({ id: "new-1" });
        return Promise.resolve({ id: "new-1" });
      },
      ensureReferralCode: () => Promise.resolve(),
      tagSession: () => Promise.resolve(),
      deleteSession: () => Promise.resolve(),
      revokeWhatsAppSessions: (userId: string, since: Date) => {
        revoked.push({ userId, since });
        return Promise.resolve(2);
      },
    };
    const settings = {
      get: (key: string) =>
        Promise.resolve(
          key === "auth"
            ? { whatsappLogin: options.whatsappLogin ?? true }
            : key === "access"
              ? { signupOpen: options.signupOpen ?? true, maintenanceMode: false }
              : { number: options.number === undefined ? "+201000000000" : options.number },
        ),
    };
    const service = new WhatsAppLoginService(
      { WHATSAPP_NUMBER: undefined } as never,
      redis as unknown as Redis,
      settings as never,
      store,
      repo as never,
      { record: (entry: unknown) => Promise.resolve(void audits.push(entry)) } as never,
      silentLogger,
    );
    return {
      redis,
      store,
      service,
      created,
      revoked,
      audits,
      setAccount: (a: WhatsAppAccount) => (current = a),
    };
  }

  const login = (token: string, extra: Partial<WaLoginEntry> = {}): WaLoginEntry =>
    ({
      kind: "login",
      id: "MSG1",
      phone: PHONE,
      jid: JID,
      receivedAt: 1,
      token,
      ...extra,
    }) as WaLoginEntry;

  it("starts a challenge with a wa.me link that carries the formatted token", async () => {
    const { service, redis } = setup();
    const { response, nonce } = await service.start(
      "Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537.36",
    );
    expect(response.code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    const link = new URL(response.waLink);
    expect(link.origin + link.pathname).toBe("https://wa.me/201000000000");
    const text = link.searchParams.get("text") ?? "";
    expect(parseLoginToken(text)).toBe(response.code.replace("-", ""));
    expect(Date.parse(response.expiresAt)).toBeGreaterThan(Date.now());
    const stored = redis.hashes.get(`wa:login:${response.code.replace("-", "")}`);
    expect(stored?.get("ua")).toBe("Chrome · Windows");
    expect(stored?.get("nonceHash")).toBe(hashNonce(nonce));
  });

  it.each([
    [{ whatsappLogin: false }, "disabled"],
    [{ number: null }, "not_configured"],
    [{ bridge: false }, "bridge_down"],
  ] as const)("refuses to start when %j", async (options, reason) => {
    await expect(setup(options).service.start(null)).rejects.toMatchObject({
      constructor: WaLoginUnavailableError,
      reason,
    });
  });

  it("signs a new person in: creates the account, replies login_ok, hands one result to the browser", async () => {
    const h = setup();
    const { response, nonce } = await h.service.start(null);
    const token = response.code.replace("-", "");

    await h.service.handleEntry(login(token, { pushName: "Mona" }));
    expect(h.created).toEqual([PHONE]);
    expect(h.redis.replies()).toEqual([{ inboundId: "MSG1", jid: JID, outcome: "login_ok" }]);
    expect(h.audits).toHaveLength(1);

    expect(await h.service.poll(response.code, "another-browser")).toEqual({ status: "pending" });
    expect(await h.service.poll(response.code, undefined)).toEqual({ status: "pending" });
    expect(await h.service.poll(response.code, nonce)).toEqual({
      status: "approved",
      userId: "new-1",
      isNew: true,
    });
    // Exactly one session: the result is gone after the first successful poll.
    expect(await h.service.poll(response.code, nonce)).toEqual({ status: "pending" });
  });

  it("signs an existing person in without creating anything", async () => {
    const h = setup({ existing: account({ id: "old" }) });
    const { response, nonce } = await h.service.start(null);
    await h.service.handleEntry(login(response.code.replace("-", "")));
    expect(h.created).toHaveLength(0);
    expect(h.audits).toHaveLength(0);
    expect(await h.service.poll(response.code, nonce)).toEqual({
      status: "approved",
      userId: "old",
      isNew: false,
    });
  });

  it.each([
    [{ twoFactorEnabled: true }, "two_factor"],
    [{ hasPlatformRole: true }, "privileged"],
    [{ status: "suspended" }, "inactive"],
  ] as const)("refuses %j with %s and replies login_refused", async (overrides, reason) => {
    const h = setup({ existing: account(overrides) });
    const { response, nonce } = await h.service.start(null);
    await h.service.handleEntry(login(response.code.replace("-", "")));
    expect(h.redis.replies().map((reply) => reply.outcome)).toEqual(["login_refused"]);
    expect(await h.service.poll(response.code, nonce)).toEqual({ status: "refused", reason });
  });

  it("re-checks the account when the browser polls (2FA switched on in between)", async () => {
    const h = setup({ existing: account({ id: "old" }) });
    const { response, nonce } = await h.service.start(null);
    await h.service.handleEntry(login(response.code.replace("-", "")));
    h.setAccount(account({ id: "old", twoFactorEnabled: true }));
    expect(await h.service.poll(response.code, nonce)).toEqual({
      status: "refused",
      reason: "two_factor",
    });
  });

  it("answers an unknown, expired or replayed token with login_expired and creates nothing", async () => {
    const h = setup();
    await h.service.handleEntry(login("ABCDEFGH"));
    expect(h.redis.replies().map((reply) => reply.outcome)).toEqual(["login_expired"]);

    const { response } = await h.service.start(null);
    const token = response.code.replace("-", "");
    await h.service.handleEntry(login(token, { id: "M1" }));
    await h.service.handleEntry(login(token, { id: "M2" }));
    expect(h.created).toEqual([PHONE]);
    expect(h.redis.replies().map((reply) => reply.outcome)).toEqual([
      "login_expired",
      "login_ok",
      "login_expired",
    ]);
  });

  it("expires a challenge that nobody claimed in time", async () => {
    const h = setup();
    const { response } = await h.service.start(null);
    h.redis.now += TTL_MS + 1;
    await h.service.handleEntry(login(response.code.replace("-", "")));
    expect(h.created).toHaveLength(0);
    expect(h.redis.replies().map((reply) => reply.outcome)).toEqual(["login_expired"]);
  });

  it("stays silent about claims beyond 5 an hour from one number", async () => {
    const h = setup();
    for (let index = 0; index < 8; index++) await h.service.handleEntry(login("ABCDEFGH"));
    expect(h.redis.replies()).toHaveLength(5);
  });

  it("creates nobody while sign-up is closed, tells the page, and says nothing in the chat", async () => {
    const h = setup({ signupOpen: false });
    const { response, nonce } = await h.service.start(null);
    await h.service.handleEntry(login(response.code.replace("-", "")));
    expect(h.created).toHaveLength(0);
    expect(h.redis.replies()).toHaveLength(0);
    expect(await h.service.poll(response.code, nonce)).toEqual({
      status: "refused",
      reason: "signup_closed",
    });
  });

  it("ignores everything while the setting is off", async () => {
    const h = setup({ whatsappLogin: false });
    await h.service.handleEntry(login("ABCDEFGH"));
    await h.service.handleEntry({ kind: "logout", id: "M", phone: PHONE, jid: JID, receivedAt: 1 });
    expect(h.redis.replies()).toHaveLength(0);
    expect(h.revoked).toHaveLength(0);
  });

  it("logout revokes the last 24 h of WhatsApp sessions and replies logout_ok either way", async () => {
    const withAccount = setup({ existing: account({ id: "old" }) });
    await withAccount.service.handleEntry({
      kind: "logout",
      id: "M",
      phone: PHONE,
      jid: JID,
      receivedAt: 1,
    });
    expect(withAccount.revoked).toHaveLength(1);
    expect(withAccount.revoked[0]?.userId).toBe("old");
    expect(Date.now() - (withAccount.revoked[0]?.since.getTime() ?? 0)).toBeGreaterThanOrEqual(
      24 * 60 * 60 * 1000 - 1_000,
    );
    expect(withAccount.redis.replies().map((reply) => reply.outcome)).toEqual(["logout_ok"]);

    const stranger = setup();
    await stranger.service.handleEntry({
      kind: "logout",
      id: "M",
      phone: PHONE,
      jid: JID,
      receivedAt: 1,
    });
    expect(stranger.revoked).toHaveLength(0);
    expect(stranger.redis.replies().map((reply) => reply.outcome)).toEqual(["logout_ok"]);
  });
});
