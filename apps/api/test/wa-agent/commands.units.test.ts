import { t } from "@wasfa/shared/i18n";
import { settingDefault } from "@wasfa/shared/settings";
import { describe, expect, it, vi } from "vitest";

import { CommandLimits } from "../../src/wa-agent/commands/command-limits.js";
import {
  planSteps,
  type PlanOptions,
  type PlanRow,
} from "../../src/wa-agent/commands/command-plan.js";
import { CommandRouter } from "../../src/wa-agent/commands/command-router.js";
import { HANDLERS } from "../../src/wa-agent/commands/handlers/index.js";
import { localeOf, withProfile } from "../../src/wa-agent/conversation/profile-config.js";
import { StaleFenceError } from "../../src/wa-agent/turn/lock.js";
import { silentLogger } from "../support/wa-agent-fakes.js";

import type {
  CommandDeps,
  CommandInput,
  CommandStep,
} from "../../src/wa-agent/commands/command-types.js";
import type { TurnMessage, WaConversation } from "@wasfa/db";

/*
 * The command layer without containers (docs/WA-AGENT-RUNTIME.md §7, §18.4): the row split, the rate
 * limits, every handler against fakes, the router's single fenced write, and the profile overrides.
 */

const fake = <T>(value: object) => value as unknown as T;
const NOW = new Date("2026-10-31T12:00:00Z");
const defaults = settingDefault("waAgent");
// Room for several replies in one turn, so the default's three-message cap does not hide the split.
const config = { ...defaults, enabled: true, caps: { ...defaults.caps, maxMessagesPerTurn: 8 } };
/** The words of a text without the direction marks the composer adds. */
const plain = (value: string) => value.replace(/[‏⁦-⁩]/g, "");
const tp = (...args: Parameters<typeof t>) => plain(t(...args));

let counter = 0;
const row = (text: string | null, kind = "text", mediaKey: string | null = null): PlanRow => {
  counter += 1;
  return {
    id: `row-${String(counter)}`,
    kind,
    text,
    mediaKey,
    createdAt: new Date(NOW.getTime() + counter),
  };
};
const text = (value: string) => row(value);
const picture = (caption: string | null = null) =>
  row(caption, "image", `wa/2026/10/${String(counter)}`);

function options(over: Partial<PlanOptions> = {}): PlanOptions {
  return {
    state: { menuActive: false, privacyActive: false },
    awaitingRx: false,
    aliases: undefined,
    maxSteps: 4,
    allow: () => Promise.resolve(true),
    ...over,
  };
}

const names = (steps: CommandStep[]) => steps.map((step) => `${step.command}:${step.via}`);

describe("planSteps", () => {
  it("takes the leading commands and leaves the text for the model", async () => {
    const rows = [text("رصيدي"), text("help"), text("عندي صداع"), text("جديد")];
    const steps = await planSteps(rows, options());

    expect(names(steps)).toEqual(["balance:alias", "help:alias"]);
    expect(steps.flatMap((step) => step.rowIds)).toEqual([rows[0]?.id, rows[1]?.id]);
  });

  it("gives everything to the model when text comes first", async () => {
    const steps = await planSteps([text("عندي صداع"), text("رصيدي")], options());
    expect(steps).toEqual([]);
  });

  it("does not take a sentence that merely contains a command word", async () => {
    expect(await planSteps([text("عايز دوا جديد")], options())).toEqual([]);
  });

  it("reads a digit as a menu entry only while the menu is open, also within one batch", async () => {
    expect(await planSteps([text("2")], options())).toEqual([]);
    expect(
      names(
        await planSteps(
          [text("2")],
          options({ state: { menuActive: true, privacyActive: false } }),
        ),
      ),
    ).toEqual(["report:menu"]);
    expect(names(await planSteps([text("help"), text("2"), text("3")], options()))).toEqual([
      "help:alias",
      "report:menu",
    ]);
  });

  it("takes the confirm word only while a confirmation is open", async () => {
    expect(await planSteps([text("تأكيد")], options())).toEqual([]);
    const open = { menuActive: false, privacyActive: true };
    const [step] = await planSteps([text("تأكيد")], options({ state: open }));
    expect(step).toMatchObject({ command: "privacy", arg: "confirm" });
    expect(names(await planSteps([text("امسح بياناتي"), text("تأكيد")], options()))).toEqual([
      "privacy:alias",
      "privacy:alias",
    ]);
  });

  it("joins the pictures before an analyze command or caption into its step", async () => {
    const pages = [picture(), picture()];
    const command = text("/analyze");
    const [step] = await planSteps([...pages, command], options());
    expect(step?.rowIds).toEqual([pages[0]?.id, pages[1]?.id, command.id]);

    const captioned = picture("حلل");
    const [byCaption] = await planSteps([pages[0] ?? captioned, captioned], options());
    expect(byCaption?.rowIds).toHaveLength(2);
    expect(byCaption?.command).toBe("analyze");
  });

  it("leaves pictures for the model unless a command or awaitingRx wants them", async () => {
    expect(await planSteps([picture(), text("رصيدي")], options())).toEqual([]);
    expect(await planSteps([picture("شوف الصورة دي")], options())).toEqual([]);
    const steps = await planSteps(
      [picture(), picture(), text("عندي صداع")],
      options({ awaitingRx: true }),
    );
    expect(names(steps)).toEqual(["analyze:awaiting"]);
    expect(steps[0]?.rowIds).toHaveLength(2);
  });

  it("stops at a command over the rate limit and at the step cap", async () => {
    const allow = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false);
    const limited = await planSteps(
      [text("رصيدي"), text("help"), text("جديد")],
      options({ allow }),
    );
    expect(names(limited)).toEqual(["balance:alias"]);

    const capped = await planSteps(
      [text("رصيدي"), text("help"), text("جديد")],
      options({ maxSteps: 2 }),
    );
    expect(capped).toHaveLength(2);
  });

  it("counts a privacy confirmation apart from the request", async () => {
    const allow = vi.fn().mockResolvedValue(true);
    await planSteps([text("امسح بياناتي")], options({ allow }));
    expect(allow).toHaveBeenCalledWith("privacy", false);
  });
});

describe("CommandLimits", () => {
  function redisCounting() {
    const counts = new Map<string, number>();
    return fake<ConstructorParameters<typeof CommandLimits>[0]>({
      multi: () => {
        const queue: (() => unknown)[] = [];
        const chain = {
          set: (key: string) => {
            queue.push(() => {
              if (!counts.has(key)) counts.set(key, 0);
              return "OK";
            });
            return chain;
          },
          incr: (key: string) => {
            queue.push(() => {
              counts.set(key, (counts.get(key) ?? 0) + 1);
              return counts.get(key);
            });
            return chain;
          },
          exec: () => Promise.resolve(queue.map((step) => [null, step()])),
        };
        return chain;
      },
    });
  }

  it("allows 20 commands per window, then falls through", async () => {
    const limits = new CommandLimits(redisCounting());
    for (let index = 0; index < 20; index++) {
      expect(await limits.allow("c1", "help", false)).toBe(true);
    }
    expect(await limits.allow("c1", "help", false)).toBe(false);
    expect(await limits.allow("c2", "help", false)).toBe(true);
  });

  it("limits `new` to 10 and privacy requests to 3 (the confirmation is not counted)", async () => {
    const limits = new CommandLimits(redisCounting());
    for (let index = 0; index < 10; index++)
      expect(await limits.allow("c1", "new", false)).toBe(true);
    expect(await limits.allow("c1", "new", false)).toBe(false);
    for (let index = 0; index < 3; index++) {
      expect(await limits.allow("c2", "privacy", false)).toBe(true);
    }
    expect(await limits.allow("c2", "privacy", false)).toBe(false);
    expect(await limits.allow("c3", "privacy", true)).toBe(true);
  });
});

// --- handlers ---------------------------------------------------------------------------------

const conversation = (over: Partial<WaConversation> = {}): WaConversation =>
  fake<WaConversation>({
    id: "conv-1",
    userId: "user-1",
    sessionId: "session-1",
    phone: "+201001234567",
    status: "active",
    pausedUntil: null,
    profile: {},
    ...over,
  });

function input(
  command: CommandStep["command"],
  over: Partial<CommandInput> & { arg?: string } = {},
): CommandInput {
  const { arg, ...rest } = over;
  return {
    conversation: conversation(),
    turn: { id: "turn-1", fence: 3 },
    config,
    now: NOW,
    locale: "ar",
    step: { command, via: "alias", ...(arg === undefined ? {} : { arg }), rowIds: ["r1"], at: NOW },
    ...rest,
  };
}

function deps(over: Partial<CommandDeps> = {}): CommandDeps {
  return {
    sessions: {
      startNew: vi.fn().mockResolvedValue("session-2"),
      state: vi.fn().mockResolvedValue({}),
      setState: vi.fn().mockResolvedValue(undefined),
      clearState: vi.fn().mockResolvedValue(undefined),
      setProfile: vi.fn().mockResolvedValue(undefined),
    },
    attachments: { resolve: vi.fn().mockResolvedValue({ ok: false, code: "no_image" }) },
    rx: {
      startBase: vi.fn().mockResolvedValue({ user: {}, creditsPerPage: 5, maxPages: 4 }),
      start: vi.fn().mockResolvedValue({ started: true, pages: 2 }),
    },
    effects: {
      begin: vi.fn().mockResolvedValue({ state: "fresh" }),
      markDone: vi.fn().mockResolvedValue(undefined),
      assertFence: vi.fn().mockResolvedValue(undefined),
    },
    account: {
      status: vi.fn().mockResolvedValue({
        plan: { key: "plus", name: "بلس" },
        subscription: {
          status: "active",
          endsAt: "2026-11-30T00:00:00Z",
          cancelAtPeriodEnd: false,
        },
        credits: { balance: 42, monthlyCredits: 100, nextGrantAt: "2026-11-01T00:00:00Z" },
        usage: { rxCreditsPerPage: 5, rxMaxPages: 4, chatCharging: "by_use" },
        pendingOrders: [{ number: "WS-1" }],
      }),
    },
    handoff: { raise: vi.fn().mockResolvedValue(undefined) },
    store: {
      lastReport: vi.fn().mockResolvedValue(null),
      erase: vi.fn().mockResolvedValue(["wa/2026/10/a", "wa/2026/10/b"]),
    },
    storage: { remove: vi.fn().mockResolvedValue(undefined) },
    audit: { record: vi.fn().mockResolvedValue(undefined) },
    market: vi.fn().mockResolvedValue({ currency: "EGP", country: "EG" }),
    ...over,
  };
}

const texts = (parts: { kind: string }[]) =>
  parts.flatMap((part) => ("text" in part ? [plain(String(part.text))] : []));

describe("handlers", () => {
  it("new opens a session and greets with the menu hint", async () => {
    const d = deps();
    const result = await HANDLERS.new(input("new"), d);
    expect(d.sessions.startNew).toHaveBeenCalledWith("conv-1", "command", NOW);
    expect(texts(result.parts).join("")).toContain("بدأنا صفحة جديدة");
  });

  it("help lists nine entries and opens the menu for ten minutes", async () => {
    const d = deps();
    const result = await HANDLERS.help(input("help"), d);
    const body = texts(result.parts).join("\n");
    for (let number = 1; number <= 9; number++) expect(body).toContain(`${String(number)}.`);
    expect(d.sessions.setState).toHaveBeenCalledWith("session-1", {
      menu: { until: "2026-10-31T12:10:00.000Z" },
    });
  });

  it("help speaks English when the chat does", async () => {
    const result = await HANDLERS.help(input("help", { locale: "en" }), deps());
    expect(texts(result.parts).join("\n")).toContain(
      t("whatsapp.agent.commands.menu.analyze", undefined, "en"),
    );
  });

  it("analyze sends a guest to sign-up", async () => {
    const d = deps();
    const result = await HANDLERS.analyze(
      input("analyze", { conversation: conversation({ userId: null }) }),
      d,
    );
    expect(texts(result.parts)).toEqual([tp("whatsapp.agent.commands.guest")]);
    expect(d.rx.start).not.toHaveBeenCalled();
  });

  it("analyze waits for a photo when there is none", async () => {
    const d = deps();
    const result = await HANDLERS.analyze(input("analyze"), d);
    expect(d.sessions.setState).toHaveBeenCalledWith("session-1", {
      awaitingRx: { until: "2026-10-31T12:10:00.000Z" },
    });
    expect(texts(result.parts)).toEqual([tp("whatsapp.agent.commands.analyze.awaiting")]);
  });

  it("analyze starts the reading once, under an effect key of the turn and the pictures", async () => {
    const d = deps({
      attachments: {
        resolve: vi.fn().mockResolvedValue({ ok: true, mediaIds: ["m1", "m2"], handles: [1, 2] }),
      },
    });
    const result = await HANDLERS.analyze(input("analyze"), d);
    expect(d.effects.assertFence).toHaveBeenCalledWith("conv-1", 3);
    expect(d.rx.start).toHaveBeenCalledTimes(1);
    const effect = vi.mocked(d.rx.start).mock.calls[0]?.[1];
    expect(effect).toMatchObject({ turnId: "turn-1", fence: 3 });
    expect(effect?.key).toMatch(/^[0-9a-f]{64}$/);
    expect(d.effects.markDone).toHaveBeenCalledWith(effect?.key, { started: true, pages: 2 });
    expect(d.sessions.clearState).toHaveBeenCalledWith("session-1", "awaitingRx");
    expect(texts(result.parts)).toEqual([tp("whatsapp.agent.rx.starting", { pages: "صفحتين" })]);
  });

  it("analyze returns a finished earlier run's result without starting again", async () => {
    const d = deps({
      attachments: {
        resolve: vi.fn().mockResolvedValue({ ok: true, mediaIds: ["m1"], handles: [1] }),
      },
      effects: {
        begin: vi.fn().mockResolvedValue({ state: "done", result: { started: true, pages: 1 } }),
        markDone: vi.fn(),
        assertFence: vi.fn(),
      },
    });
    const result = await HANDLERS.analyze(input("analyze"), d);
    expect(d.rx.start).not.toHaveBeenCalled();
    expect(texts(result.parts)).toEqual([tp("whatsapp.agent.rx.starting", { pages: "صفحة" })]);
  });

  it("analyze explains a refusal in the customer's words and settles nothing", async () => {
    const d = deps({
      attachments: {
        resolve: vi.fn().mockResolvedValue({ ok: true, mediaIds: ["m1"], handles: [1] }),
      },
      rx: {
        startBase: vi.fn().mockResolvedValue({ user: {}, creditsPerPage: 5, maxPages: 4 }),
        start: vi.fn().mockResolvedValue({ started: false, reason: "insufficient_credits" }),
      },
    });
    const result = await HANDLERS.analyze(input("analyze"), d);
    expect(d.effects.markDone).not.toHaveBeenCalled();
    expect(texts(result.parts)).toEqual([tp("whatsapp.agent.event.rxFailed.insufficient_credits")]);
  });

  it("balance prints the account facts", async () => {
    const result = await HANDLERS.balance(input("balance"), deps());
    const body = texts(result.parts).join("\n");
    expect(body).toContain("بلس");
    expect(body).toContain("42");
    expect(body).toContain("2026-11-30");
    expect(body).toContain("WS-1");
  });

  it("report resends the last report PDF, or says there is none", async () => {
    const none = await HANDLERS.report(input("report"), deps());
    expect(texts(none.parts)).toEqual([tp("whatsapp.agent.commands.report.none")]);

    const found = await HANDLERS.report(
      input("report"),
      deps({
        store: {
          lastReport: vi
            .fn()
            .mockResolvedValue({ mediaKey: "wa/out/x.pdf", fileName: "نتيجة.pdf" }),
          erase: vi.fn(),
        },
      }),
    );
    expect(found.parts).toEqual([
      { kind: "document", mediaKey: "wa/out/x.pdf", fileName: "نتيجة.pdf" },
    ]);
  });

  it("voice sets the preference and toggles without an argument", async () => {
    const d = deps();
    await HANDLERS.voice(input("voice", { arg: "off" }), d);
    expect(d.sessions.setProfile).toHaveBeenLastCalledWith("conv-1", { voice: "off" });
    await HANDLERS.voice(input("voice"), d);
    expect(d.sessions.setProfile).toHaveBeenLastCalledWith("conv-1", { voice: "off" });
    await HANDLERS.voice(
      input("voice", { conversation: conversation({ profile: { voice: "off" } }) }),
      d,
    );
    expect(d.sessions.setProfile).toHaveBeenLastCalledWith("conv-1", { voice: "on" });
  });

  it("lang sets the language and confirms in it", async () => {
    const d = deps();
    const result = await HANDLERS.lang(input("lang", { arg: "en" }), d);
    expect(d.sessions.setProfile).toHaveBeenCalledWith("conv-1", { lang: "en" });
    expect(texts(result.parts)).toEqual([tp("whatsapp.agent.commands.lang.en")]);
    await HANDLERS.lang(input("lang", { locale: "en" }), d);
    expect(d.sessions.setProfile).toHaveBeenLastCalledWith("conv-1", { lang: "ar" });
  });

  it("human raises the handoff and asks for the pause", async () => {
    const d = deps();
    const result = await HANDLERS.human(input("human"), d);
    expect(d.handoff.raise).toHaveBeenCalledWith("conv-1", "command");
    expect(result.handoffReason).toBe("command");
    expect(texts(result.parts)).toEqual([tp("whatsapp.agent.fallback.handoff_to_owner")]);
  });

  it("privacy asks first and deletes nothing", async () => {
    const d = deps();
    const result = await HANDLERS.privacy(input("privacy"), d);
    expect(d.sessions.setState).toHaveBeenCalledWith("session-1", {
      privacyConfirm: { until: "2026-10-31T12:05:00.000Z" },
    });
    expect(d.store.erase).not.toHaveBeenCalled();
    expect(texts(result.parts)).toEqual([tp("whatsapp.agent.commands.privacy.ask")]);
  });

  it("privacy confirmed audits the conversation id only, erases, restarts the session, removes files", async () => {
    const d = deps();
    const result = await HANDLERS.privacy(input("privacy", { arg: "confirm" }), d);
    expect(d.audit.record).toHaveBeenCalledWith({
      actorId: null,
      action: "wa_agent.privacy_delete",
      targetType: "wa_conversation",
      targetId: "conv-1",
    });
    expect(d.store.erase).toHaveBeenCalledWith("conv-1", NOW);
    expect(d.sessions.startNew).toHaveBeenCalledWith("conv-1", "privacy", NOW);
    expect(d.storage.remove).toHaveBeenCalledTimes(2);
    expect(texts(result.parts)).toEqual([tp("whatsapp.agent.commands.privacy.done")]);
  });

  it("privacy still answers when a file cannot be removed", async () => {
    const d = deps({ storage: { remove: vi.fn().mockRejectedValue(new Error("down")) } });
    const result = await HANDLERS.privacy(input("privacy", { arg: "confirm" }), d);
    expect(texts(result.parts)).toEqual([tp("whatsapp.agent.commands.privacy.done")]);
  });

  it("schedule, meds and remind say «soon»", async () => {
    for (const command of ["schedule", "meds", "remind"] as const) {
      const result = await HANDLERS[command](input(command), deps());
      expect(texts(result.parts)).toEqual([tp("whatsapp.agent.commands.soon")]);
    }
  });
});

// --- the router ---------------------------------------------------------------------------------

function router(over: { enqueue?: ReturnType<typeof vi.fn>; held?: boolean } = {}) {
  const enqueueFenced = over.enqueue ?? vi.fn().mockResolvedValue(["out-1"]);
  const begin = vi.fn((_c: string, fence: number, rows: readonly { id: string }[]) =>
    Promise.resolve({
      id: "turn-1",
      conversationId: "conv-1",
      fence,
      attempt: 1,
      inboundIds: rows.map((r) => r.id),
      rateDeferred: false,
    }),
  );
  const close = vi.fn().mockResolvedValue(undefined);
  const d = deps();
  const instance = CommandRouter.of({
    conversations: { find: () => Promise.resolve(conversation()) },
    sessions: { state: () => Promise.resolve({}) },
    store: fake({ begin, close }),
    outbound: fake({ enqueueFenced }),
    limits: { allow: () => Promise.resolve(true) },
    handoff: { pauseWhenDelivered: vi.fn() },
    handoffFlag: () => Promise.resolve(over.held ?? false),
    deps: d,
    handlers: HANDLERS,
    logger: silentLogger,
  });
  return { instance, enqueueFenced, begin, close, d };
}

describe("CommandRouter", () => {
  it("answers only the leading command rows, in one fenced write", async () => {
    const { instance, enqueueFenced, begin } = router();
    const rows = [text("رصيدي"), text("help"), text("عندي صداع")];
    const ran = await instance.run(conversation(), fake(rows), 3, config, NOW);

    expect(ran).toBe("done");
    expect(begin.mock.calls[0]?.[2].map((r) => r.id)).toEqual([rows[0]?.id, rows[1]?.id]);
    expect(enqueueFenced).toHaveBeenCalledTimes(1);
    const [, parts, end] = enqueueFenced.mock.calls[0] ?? [];
    expect(parts).toHaveLength(2);
    expect(end).toMatchObject({
      turnId: "turn-1",
      fence: 3,
      costUsdMicros: 0,
      inboundIds: [rows[0]?.id, rows[1]?.id],
    });
    expect(
      end.trace.map((step: { name: string; via: string }) => `${step.name}:${step.via}`),
    ).toEqual(["balance:alias", "help:alias"]);
  });

  it("leaves a batch that starts with text to the model", async () => {
    const { instance, begin, enqueueFenced } = router();
    const ran = await instance.run(
      conversation(),
      fake([text("عندي صداع"), text("رصيدي")]),
      3,
      config,
      NOW,
    );
    expect(ran).toBe("none");
    expect(begin).not.toHaveBeenCalled();
    expect(enqueueFenced).not.toHaveBeenCalled();
  });

  it("stays out of a paused chat, a handed-over chat and a disabled layer", async () => {
    const rows = fake<TurnMessage[]>([text("help")]);
    expect(await router({ held: true }).instance.run(conversation(), rows, 1, config, NOW)).toBe(
      "none",
    );
    const paused = conversation({
      pausedUntil: new Date(NOW.getTime() + 60_000),
      status: "paused",
    });
    expect(await router().instance.run(paused, rows, 1, config, NOW)).toBe("none");
    const off = { ...config, commands: { ...config.commands, enabled: false } };
    expect(await router().instance.run(conversation(), rows, 1, off, NOW)).toBe("none");
  });

  it("reports a stale fence and sends nothing", async () => {
    const stale = vi.fn().mockRejectedValue(new StaleFenceError("conv-1"));
    const { instance } = router({ enqueue: stale });
    expect(await instance.run(conversation(), fake([text("help")]), 3, config, NOW)).toBe("stale");
  });

  it("closes the turn quietly when the chat was paused while the handlers ran", async () => {
    const { AppError, ErrorCode } = await import("@wasfa/shared/errors");
    const refuse = vi.fn().mockRejectedValue(new AppError(ErrorCode.CONFLICT));
    const { instance, close } = router({ enqueue: refuse });
    expect(await instance.run(conversation(), fake([text("help")]), 3, config, NOW)).toBe("done");
    expect(close).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ causeClass: "policy" }),
      "dropped_policy",
    );
  });
});

describe("withProfile", () => {
  it("applies the chat's language and switches voice off, and leaves everything else", () => {
    expect(withProfile(config, undefined)).toBe(config);
    expect(withProfile(config, {})).toEqual(config);
    expect(withProfile(config, { lang: "en" }).language).toBe("en");
    expect(withProfile({ ...config, language: "en" }, { lang: "ar" }).language).toBe("ar_eg");
    expect(withProfile(config, { voice: "off" }).voice.replyMode).toBe("never");
    expect(withProfile(config, { voice: "on" }).voice).toEqual(config.voice);
    expect(localeOf(config, { lang: "en" })).toBe("en");
    expect(localeOf({ ...config, language: "en" }, {})).toBe("en");
  });
});
