import { effectsRanOf, type RoundOutcome, type StepTrace, type TurnTraceStep } from "../turn/agent-round.js";
import { textOnlyReason } from "../voice/voice-text.js";

import { toWhatsappText } from "./agent-output.js";
import { replyParts, withOutcomes } from "./round-helpers.js";

import type { WaAgentVoiceService } from "../voice/voice.service.js";
import type { AgentToolContext, ToolCallRecord, ToolOutput } from "./tools/index.js";
import type { ToolLoopResult } from "@wasfa/ai";
import type { WaConversation, TurnMessage } from "@wasfa/db";
import type { WaAgentOutboundPart } from "@wasfa/shared/schemas/wa-agent";
import type { WaAgentSettings } from "@wasfa/shared/settings";

/**
 * The reply as one voice note, or null when it stays text: voice off, no key, the mode says no, the
 * reply is long, carries media, or holds something the customer must read exactly (a link, a coupon
 * code, a bank number), the daily character cap is used up or ElevenLabs failed.
 */
export async function speakReply(
  deps: { voice: WaAgentVoiceService; random: () => number },
  text: string,
  media: readonly WaAgentOutboundPart[],
  pending: readonly TurnMessage[],
  config: WaAgentSettings,
  now: Date,
): Promise<{ mediaKey: string; chars: number } | null> {
  const { voice } = config;
  const reply = text.trim();
  if (!voice.enabled || voice.voiceId === "" || reply === "" || media.length > 0) return null;
  if (reply.length > voice.maxChars || textOnlyReason(reply) !== null) return null;
  const wanted =
    voice.replyMode === "mirror"
      ? pending.some((message) => message.kind === "audio")
      : voice.replyMode === "sometimes" && deps.random() * 100 < voice.sometimesPercent;
  if (!wanted || !(await deps.voice.ready(voice))) return null;
  return deps.voice.speak(toWhatsappText(reply), voice, now);
}

/** What the finished loop becomes: the parts to send (a voice note or text) and the trace of the round. */
export function roundOutcome(input: {
  result: ToolLoopResult;
  spoken: { mediaKey: string; chars: number } | null;
  config: WaAgentSettings;
  conversation: WaConversation;
  planId: string | null;
  now: Date;
  records: ToolCallRecord[];
  outputs: ToolOutput[];
  stepTraces: readonly StepTrace[];
  ctx: AgentToolContext;
}): RoundOutcome {
  const { result, spoken, config, conversation, planId, now, records, outputs, stepTraces, ctx } =
    input;
  const parts: WaAgentOutboundPart[] = spoken
    ? [{ kind: "voice", mediaKey: spoken.mediaKey }]
    : replyParts(result.text, ctx.mediaParts, config.caps);
  return {
    parts,
    toolRecords: records,
    toolResults: outputs,
    transcript: result.messages,
    steps: withOutcomes(stepTraces, records),
    effectsRan: effectsRanOf(records),
    costUsdMicros: result.costUsdMicros,
    trace: [
      { code: "model", count: result.steps },
      ...records.map((record): TurnTraceStep => ({
        code: record.ok ? "tool" : `tool_${record.code ?? "error"}`,
        name: record.name,
        ok: record.ok,
      })),
    ],
    tail: {
      conversation,
      planId,
      now,
      steps: result.steps,
      truncated: result.truncated,
      text: result.text,
      spoken,
      handoffReason: ctx.handoffReason,
    },
  };
}
