import { z } from "zod";

import { FAILURE_CLASSES, WA_TURN_STATES } from "../wa-agent/failure.js";

/*
 * Admin operations for the WhatsApp agent (docs/WA-AGENT-RUNTIME.md §19, Phase 6 WP9 part A): turn traces,
 * the health view, the simulator and the dry-run replay. Responses carry ids, codes, numbers and times only;
 * no customer text or phone number ever leaves through these shapes (the transcript has its own audited route).
 */

/** One model call of a turn, as stored in `wa_turns.trace.steps`. */
export const waTurnStepSchema = z.object({
  step: z.number().int().min(0),
  model: z.string().max(200).nullable(),
  routeVersion: z.number().int().nullable(),
  latencyMs: z.number().int().min(0),
  inputTokens: z.number().int().min(0).nullable(),
  outputTokens: z.number().int().min(0).nullable(),
  costUsdMicros: z.number().int().min(0).nullable(),
  tools: z.array(z.object({ tool: z.string().max(80), outcome: z.string().max(80) })).max(20),
  /** The failure signal of this call when it failed (a code, never a message). */
  error: z.string().max(80).nullable(),
});
export type WaTurnStep = z.output<typeof waTurnStepSchema>;

/** One turn of a conversation, newest first in lists. */
export const waTurnSchema = z.object({
  id: z.uuid(),
  state: z.enum(WA_TURN_STATES),
  causeClass: z.enum(FAILURE_CLASSES).nullable(),
  attempt: z.number().int().min(1),
  errorRef: z.string().max(40).nullable(),
  inboundCount: z.number().int().min(0),
  startedAt: z.iso.datetime({ offset: true }),
  endedAt: z.iso.datetime({ offset: true }).nullable(),
  /** `endedAt - startedAt`; null while the turn is live. */
  latencyMs: z.number().int().min(0).nullable(),
  costUsdMicros: z.number().int().min(0),
  steps: z.array(waTurnStepSchema).max(20),
  /** Code-level events of the turn (`trace.events`): name plus small numbers; no text. */
  events: z
    .array(
      z.object({
        name: z.string().max(80),
        ok: z.boolean().nullable(),
        via: z.string().max(40).nullable(),
        ms: z.number().int().nullable(),
        count: z.number().int().nullable(),
      }),
    )
    .max(50),
});
export type WaTurn = z.output<typeof waTurnSchema>;

export const waTurnListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const waTurnListSchema = z.object({ turns: z.array(waTurnSchema) });
export type WaTurnList = z.output<typeof waTurnListSchema>;

/** The health view's ranges. */
export const WA_HEALTH_RANGES = ["24h", "7d"] as const;
export type WaHealthRange = (typeof WA_HEALTH_RANGES)[number];

export const waHealthQuerySchema = z.object({
  range: z.enum(WA_HEALTH_RANGES).default("24h"),
});

const countByKey = z.array(z.object({ key: z.string().max(80), count: z.number().int().min(0) }));

/** Aggregates over `wa_turns`, `wa_messages` and the DLQ for the range (see §19.2 for the definitions). */
export const waHealthSchema = z.object({
  range: z.enum(WA_HEALTH_RANGES),
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
  turns: z.object({
    total: z.number().int().min(0),
    byState: countByKey,
    byCause: countByKey,
    /** (failed_replied + dropped_policy excluded) / total ended, in basis points (0–10000). */
    failureRateBp: z.number().int().min(0).max(10_000),
    p50LatencyMs: z.number().int().min(0).nullable(),
    p95LatencyMs: z.number().int().min(0).nullable(),
    costUsdMicros: z.number().int().min(0),
  }),
  /** Inbound customer rows older than 10 minutes with no turn link (v2 only; 0 while v2 is off). */
  unanswered: z.number().int().min(0),
  droppedByReason: countByKey,
  mediaFailuresByReason: countByKey,
  commandUses: countByKey,
  dlqSize: z.number().int().min(0),
  /** Today's agent spend so far (UTC day) and the cap, both in USD micros. */
  spendTodayUsdMicros: z.number().int().min(0),
  spendCapUsdMicros: z.number().int().min(0),
  /** Daily buckets for the 7-day range (UTC days, oldest first); empty for 24h. */
  daily: z.array(
    z.object({
      day: z.iso.date(),
      turns: z.number().int().min(0),
      failed: z.number().int().min(0),
      p95LatencyMs: z.number().int().min(0).nullable(),
    }),
  ),
});
export type WaHealth = z.output<typeof waHealthSchema>;

/** A simulated customer message (text only; images are out of scope for the simulator in Release A). */
export const waSimulatorRequestSchema = z.object({
  messages: z
    .array(z.object({ text: z.string().trim().min(1).max(1_000) }))
    .min(1)
    .max(20),
  /** The simulated customer: a guest, or linked to the admin's own account (never another user's). */
  linked: z.boolean().default(false),
});
export type WaSimulatorRequest = z.output<typeof waSimulatorRequestSchema>;

/** What the engine would send, and how it got there. Write tools never act (dry run). */
export const waSimulatorResponseSchema = z.object({
  parts: z.array(
    z.object({ kind: z.enum(["text", "media"]), text: z.string().max(4_000).nullable() }),
  ),
  /** Set when the messages were answered by the command layer (no model call). */
  command: z.string().max(40).nullable(),
  steps: z.array(waTurnStepSchema).max(20),
  /** Write tools the model asked for; reported, not executed. */
  skippedEffects: z.array(z.object({ tool: z.string().max(80) })).max(20),
  latencyMs: z.number().int().min(0),
  costUsdMicros: z.number().int().min(0),
});
export type WaSimulatorResponse = z.output<typeof waSimulatorResponseSchema>;

export const waTurnIdParamSchema = z.object({ id: z.uuid() });

/** A dry-run replay of a finished turn with its original inbound rows: nothing is sent, nothing acts. */
export const waReplayResponseSchema = waSimulatorResponseSchema.extend({
  turnId: z.uuid(),
  originalState: z.enum(WA_TURN_STATES),
});
export type WaReplayResponse = z.output<typeof waReplayResponseSchema>;

/** Alert kinds the agent raises (migration adds them to `admin_alerts_kind_check`). */
export const WA_AGENT_ALERT_KINDS = [
  "wa_agent.failure_rate",
  "wa_agent.latency",
  "wa_agent.dlq",
  "wa_agent.media_failures",
  "wa_agent.spend_cap",
  "wa_agent.unanswered",
] as const;
export type WaAgentAlertKind = (typeof WA_AGENT_ALERT_KINDS)[number];

/** Thresholds for the 5-minute health check (§19.3). */
export const WA_AGENT_ALERT_RULES = {
  windowMinutes: 15,
  minTurnsForRate: 10,
  failureRateBp: 500,
  p95LatencyMs: 45_000,
  mediaFailures: 5,
  repeatMinutes: 60,
} as const;
