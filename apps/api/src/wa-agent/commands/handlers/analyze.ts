import { rxStartText } from "../../agent/rx-progress.js";
import { toolEffectKey, type AgentCall, type AgentToolResult } from "../../agent/tools/tool.js";
import { composeParts } from "../../compose/compose-parts.js";
import {
  say,
  type CommandDeps,
  type CommandHandler,
  type CommandInput,
  type CommandResult,
} from "../command-types.js";

import { AWAITING_RX_MS, linkedUser, sessionOf, untilOf } from "./shared.js";

import type { MessageKey } from "@wasfa/shared/i18n";

const TOOL = "cmd:analyze";

/** The customer-facing line for a refusal code (the `explain` texts are written for the model, not for the chat). */
const REFUSAL_TEXT: Record<string, MessageKey> = {
  not_ready: "whatsapp.agent.commands.analyze.notReady",
  already_analysed: "whatsapp.agent.commands.analyze.alreadyAnalysed",
  still_processing: "whatsapp.agent.commands.analyze.stillProcessing",
  unreadable_image: "whatsapp.agent.event.rxFailed.unreadable_image",
  too_many_pages: "whatsapp.agent.event.rxFailed.too_many_pages",
  insufficient_credits: "whatsapp.agent.event.rxFailed.insufficient_credits",
};

/**
 * `analyze` (docs/WA-AGENT-RUNTIME.md §7.2, §18.4): reads the session's newest set of ready pictures without
 * the model. The start runs once per turn and set of pictures (`cmd:analyze`), so a re-run of the turn
 * never reads or charges twice. Without a picture the next ones are analysed on arrival (`awaitingRx`).
 */
export const analyzeHandler: CommandHandler = async (input, deps) => {
  const user = linkedUser(input);
  if ("guest" in user) return user.guest;
  const { conversation, now, config } = input;
  const sessionId = await sessionOf(input, deps);
  const call: AgentCall = {
    conversationId: conversation.id,
    userId: user.userId,
    market: await deps.market(conversation),
    config,
    now,
    sessionId,
  };
  const base = await deps.rx.startBase(call);
  if (base === null) return { parts: say(input, "whatsapp.agent.commands.analyze.failed") };
  const picked = await deps.attachments.resolve(sessionId, {}, base.maxPages);
  if (!picked.ok) return refusal(input, deps, sessionId, picked.code);

  const result = await startOnce(
    input,
    deps,
    toolEffectKey(input.turn.id, TOOL, { mediaIds: picked.mediaIds }),
    (effect) => deps.rx.start({ ...call, effect }, effect, base, picked),
  );
  if (result["started"] === true) {
    await deps.sessions.clearState(sessionId, "awaitingRx");
    const pages = typeof result["pages"] === "number" && result["pages"] >= 1 ? result["pages"] : 1;
    return { parts: composeParts(rxStartText(pages, input.locale), config.caps) };
  }
  return refusal(input, deps, sessionId, String(result["reason"] ?? "failed"));
};

async function refusal(
  input: CommandInput,
  deps: CommandDeps,
  sessionId: string,
  code: string,
): Promise<CommandResult> {
  if (code === "no_image") {
    await deps.sessions.setState(sessionId, { awaitingRx: untilOf(input.now, AWAITING_RX_MS) });
    return { parts: say(input, "whatsapp.agent.commands.analyze.awaiting") };
  }
  return { parts: say(input, REFUSAL_TEXT[code] ?? "whatsapp.agent.commands.analyze.failed") };
}

/**
 * The exactly-once wrapper of `withToolEffect`, on the effects port directly (a command has no tool
 * context): a finished earlier run returns its stored result; otherwise fence check, run, mark done.
 */
async function startOnce(
  input: CommandInput,
  deps: CommandDeps,
  key: string,
  run: (effect: { key: string; turnId: string; fence: number }) => Promise<AgentToolResult>,
): Promise<AgentToolResult> {
  const { turn, conversation } = input;
  const begun = await deps.effects.begin(key, turn.id, TOOL);
  if (begun.state === "done") return begun.result;
  await deps.effects.assertFence(conversation.id, turn.fence);
  const result = await run({ key, turnId: turn.id, fence: turn.fence });
  // A refusal did nothing and may succeed on a retry, so only a started reading is settled.
  if (result["started"] === true) await deps.effects.markDone(key, result);
  return result;
}
