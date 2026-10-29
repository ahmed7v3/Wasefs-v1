import { settingDefault } from "@wasfa/shared/settings";
import { describe, expect, it } from "vitest";

import { MagicLinkService } from "../src/auth/whatsapp-login/magic-link.service.js";
import { buildSystemPrompt } from "../src/wa-agent/agent/agent-prompt.js";
import { AgentSignupService } from "../src/wa-agent/agent/agent-signup.service.js";
import {
  bindTools,
  toolsFor,
  type AgentToolContext,
  type ToolCallRecord,
} from "../src/wa-agent/agent/tools/index.js";

import {
  appError,
  COMMERCE_CONVERSATION_ID,
  unusedCommerceDeps,
} from "./support/wa-agent-commerce-fakes.js";
import { silentLogger } from "./support/wa-agent-fakes.js";
import { LoginRedis, account } from "./support/wa-login-fakes.js";

import type { WhatsAppAccount } from "../src/auth/whatsapp-login/whatsapp-login.repo.js";
import type { Redis } from "ioredis";

const PHONE = "+201012345678";
const USER_ID = "018f0000-0000-7000-8000-0000000000a1";
const SIGNUP = { accountSignup: true } as const;

function toolSetup(options: { userId?: string | null; phone?: string | null } = {}) {
  const userId = options.userId ?? null;
  const calls: { create: unknown[]; loginLink: string[] } = { create: [], loginLink: [] };
  const ctx: AgentToolContext = {
    conversationId: COMMERCE_CONVERSATION_ID,
    userId,
    phone: options.phone === undefined ? PHONE : options.phone,
    market: { currency: "EGP", country: "EG" },
    config: settingDefault("waAgent"),
    now: new Date("2026-10-29T10:00:00Z"),
    mediaParts: [],
    handoffReason: null,
    deps: {
      catalog: { catalog: () => Promise.reject(new Error("unused")) },
      account: { status: () => Promise.reject(new Error("unused")) },
      media: { find: () => Promise.resolve(null) },
      mediaOrigin: "",
      handoff: { raise: () => Promise.resolve() },
      ...unusedCommerceDeps,
      accounts: {
        create: (input) => {
          calls.create.push(input);
          return Promise.resolve({ created: true, isNew: true, loginUrl: "https://w.test/x#t=1" });
        },
        loginLink: (id) => {
          calls.loginLink.push(id);
          return Promise.resolve({
            ok: true,
            loginUrl: "https://w.test/x#t=1",
            expiresInMinutes: 15,
          });
        },
      },
    },
  };
  const records: ToolCallRecord[] = [];
  const { handlers } = bindTools(toolsFor(userId !== null, SIGNUP), ctx, records);
  return { handlers, calls, records };
}

describe("account tools registry", () => {
  const names = (linked: boolean, on: boolean) =>
    toolsFor(linked, on ? SIGNUP : {}).map((tool) => tool.definition.name);

  it("offers create_account to guests only and login_link to linked chats only", () => {
    expect(names(false, true)).toContain("create_account");
    expect(names(false, true)).not.toContain("login_link");
    expect(names(true, true)).toContain("login_link");
    expect(names(true, true)).not.toContain("create_account");
  });

  it("offers neither while the switch is off", () => {
    for (const linked of [false, true]) {
      expect(names(linked, false)).not.toContain("create_account");
      expect(names(linked, false)).not.toContain("login_link");
    }
  });

  it("describes the flow in the prompt only while on, with the real terms links", () => {
    const input = {
      persona: "",
      language: "ar" as const,
      emojiLevel: "none" as const,
      now: new Date("2026-10-29T10:00:00Z"),
      firstName: null,
      currency: "EGP",
      summary: null,
    };
    expect(buildSystemPrompt(input)).not.toContain("create_account");
    const prompt = buildSystemPrompt({
      ...input,
      accountSignup: { webOrigin: "https://wasfa.test" },
    });
    expect(prompt).toContain("https://wasfa.test/terms");
    expect(prompt).toContain("https://wasfa.test/privacy");
    expect(prompt).toContain("اللينك ده للدخول مرة واحدة وصالح ١٥ دقيقة، متبعتوش لحد");
  });
});

describe("create_account", () => {
  it("creates the account for the chat's own phone once confirmed", async () => {
    const h = toolSetup();
    const result = await h.handlers["create_account"]?.({ confirmed: true, name: "  Mona " });
    expect(result).toMatchObject({ created: true, isNew: true });
    expect(h.calls.create).toEqual([
      { conversationId: COMMERCE_CONVERSATION_ID, phone: PHONE, name: "Mona" },
    ]);
  });

  it("refuses without confirmation, and creates nothing", async () => {
    const h = toolSetup();
    expect(await h.handlers["create_account"]?.({ confirmed: false })).toEqual({
      created: false,
      reason: "needs_confirmation",
    });
    expect(h.calls.create).toHaveLength(0);
  });

  it("says phone_unknown when WhatsApp did not reveal the number", async () => {
    const h = toolSetup({ phone: null });
    expect(await h.handlers["create_account"]?.({ confirmed: true })).toEqual({
      created: false,
      reason: "phone_unknown",
    });
    expect(h.calls.create).toHaveLength(0);
  });

  it("refuses a linked chat even if the model invents the call", async () => {
    const h = toolSetup({ userId: USER_ID });
    expect(await h.handlers["create_account"]).toBeUndefined();
  });

  it("validates its arguments (name up to 60, confirmed required)", async () => {
    const h = toolSetup();
    expect(await h.handlers["create_account"]?.({})).toEqual({ error: "invalid_arguments" });
    expect(await h.handlers["create_account"]?.({ confirmed: true, name: "x".repeat(61) })).toEqual(
      {
        error: "invalid_arguments",
      },
    );
  });
});

describe("login_link", () => {
  it("passes the chat's own account to the service", async () => {
    const h = toolSetup({ userId: USER_ID });
    expect(await h.handlers["login_link"]?.({})).toMatchObject({ ok: true, expiresInMinutes: 15 });
    expect(h.calls.loginLink).toEqual([USER_ID]);
  });

  it("does not exist for a guest", () => {
    expect(toolSetup().handlers["login_link"]).toBeUndefined();
  });
});

describe("AgentSignupService", () => {
  function setup(
    options: {
      existing?: WhatsAppAccount | null;
      signupOpen?: boolean;
      linkRows?: WhatsAppAccount | null;
    } = {},
  ) {
    const redis = new LoginRedis();
    // The magic-link store: the service only needs set/getdel and a per-user counter.
    const values = new Map<string, string>();
    const hits = new Map<string, number>();
    const magicRedis = {
      set: (key: string, value: string) => {
        values.set(key, value);
        return Promise.resolve("OK");
      },
      getdel: (key: string) => {
        const value = values.get(key) ?? null;
        values.delete(key);
        return Promise.resolve(value);
      },
    };
    const limiter = {
      hit: (key: string, max: number) => {
        const next = (hits.get(key) ?? 0) + 1;
        hits.set(key, next);
        if (next > max) throw appError("RATE_LIMITED");
        return Promise.resolve();
      },
    };
    let current = options.existing ?? null;
    const inserted: string[] = [];
    const linked: Array<[string, string]> = [];
    const audits: Array<[string, string]> = [];
    const accounts = {
      findByVerifiedPhone: () => Promise.resolve(current),
      findById: (id: string) =>
        Promise.resolve(options.linkRows ?? (current?.id === id ? current : null)),
      insertUser: (input: { phone: string }) => {
        inserted.push(input.phone);
        current = account({ id: "new-1" });
        return Promise.resolve({ id: "new-1" });
      },
      ensureReferralCode: () => Promise.resolve(),
    };
    const magic = new MagicLinkService(
      { WEB_ORIGIN: ["https://wasfa.test"] } as never,
      magicRedis as unknown as Redis,
      limiter as never,
      accounts as never,
    );
    const service = new AgentSignupService(
      accounts as never,
      {
        recordSignup: (id: string, method: string) =>
          Promise.resolve(void audits.push([id, method])),
      } as never,
      magic,
      {
        get: () =>
          Promise.resolve({ signupOpen: options.signupOpen ?? true, maintenanceMode: false }),
      } as never,
      { linkUser: (c: string, u: string) => Promise.resolve(void linked.push([c, u])) } as never,
      silentLogger,
    );
    return { service, magic, inserted, linked, audits, values, redis };
  }

  it("creates the user, links the chat, audits the method and returns a fragment link", async () => {
    const h = setup();
    const result = (await h.service.create({
      conversationId: "c1",
      phone: PHONE,
      name: "Mona",
    })) as {
      created: boolean;
      isNew: boolean;
      loginUrl: string;
    };
    expect(result).toMatchObject({ created: true, isNew: true });
    expect(result.loginUrl).toMatch(
      /^https:\/\/wasfa\.test\/auth\/whatsapp\/link#t=[A-Za-z0-9_-]{43}$/,
    );
    expect(h.linked).toEqual([["c1", "new-1"]]);
    expect(h.audits).toEqual([["new-1", "whatsapp_agent"]]);
    // Only the hash of the token is a key.
    const token = result.loginUrl.split("#t=")[1] ?? "";
    expect([...h.values.keys()].some((key) => key.includes(token))).toBe(false);
  });

  it("says exists when the number already has an account, and creates nothing", async () => {
    const h = setup({ existing: account({ id: "old" }) });
    expect(await h.service.create({ conversationId: "c1", phone: PHONE })).toEqual({
      created: false,
      reason: "exists",
    });
    expect(h.inserted).toHaveLength(0);
    expect(h.linked).toHaveLength(0);
  });

  it("says signup_closed while new accounts are paused", async () => {
    const h = setup({ signupOpen: false });
    expect(await h.service.create({ conversationId: "c1", phone: PHONE })).toEqual({
      created: false,
      reason: "signup_closed",
    });
    expect(h.inserted).toHaveLength(0);
  });

  it.each([
    [{ twoFactorEnabled: true }, "two_factor"],
    [{ hasPlatformRole: true }, "privileged"],
    [{ status: "suspended" }, "inactive"],
  ] as const)("login_link refuses %j with %s", async (overrides, reason) => {
    const h = setup({ existing: account({ id: USER_ID, ...overrides }) });
    expect(await h.service.loginLink(USER_ID)).toEqual({ ok: false, reason });
  });

  it("issues links for an ordinary account, 3 an hour, then rate_limited", async () => {
    const h = setup({ existing: account({ id: USER_ID }) });
    for (let index = 0; index < 3; index++) {
      expect(await h.service.loginLink(USER_ID)).toMatchObject({ ok: true, expiresInMinutes: 15 });
    }
    expect(await h.service.loginLink(USER_ID)).toEqual({ ok: false, reason: "rate_limited" });
  });

  it("redeems a link once and refuses it afterwards, or once 2FA is on", async () => {
    const h = setup({ existing: account({ id: USER_ID }) });
    const first = (await h.service.loginLink(USER_ID)) as { loginUrl: string };
    const token = first.loginUrl.split("#t=")[1] ?? "";
    expect(await h.magic.redeem(token)).toEqual({ userId: USER_ID, isNew: false });
    expect(await h.magic.redeem(token)).toBeNull();
    expect(await h.magic.redeem("not-a-token")).toBeNull();

    const again = (await h.service.loginLink(USER_ID)) as { loginUrl: string };
    const h2 = setup({ existing: account({ id: USER_ID, twoFactorEnabled: true }) });
    // A different instance has no such token at all: unknown looks the same as refused.
    expect(await h2.magic.redeem(again.loginUrl.split("#t=")[1] ?? "")).toBeNull();
  });
});
