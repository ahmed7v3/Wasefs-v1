import { z } from "zod";

import { PHONE_VERIFICATION_MODES } from "../auth-settings.js";
import { waAgentSettingsSchema } from "../settings.js";

import { cursorQuerySchema } from "./admin.js";
import {
  WA_AGENT_CONVERSATION_STATUSES,
  WA_AGENT_DIRECTIONS,
  WA_AGENT_KINDS,
  WA_AGENT_MESSAGE_STATUSES,
} from "./wa-agent.js";

/*
 * Admin contract of the WhatsApp AI agent (docs/WA-AGENT.md section 8, work package E). The ElevenLabs
 * key only travels inward (`apiKey`); responses carry whether one is set and its masked hint.
 */

const isoDate = z.iso.datetime({ offset: true });

export const waAgentIdParamSchema = z.object({ id: z.uuid() });

/** Chat pause bounds, minutes (5 minutes to 7 days). */
export const WA_AGENT_PAUSE_MIN_MINUTES = 5;
export const WA_AGENT_PAUSE_MAX_MINUTES = 10_080;

// --- Settings -----------------------------------------------------------------------------------

export const waAgentAdminSettingsSchema = z.object({
  settings: waAgentSettingsSchema,
  voiceKey: z.object({
    set: z.boolean(),
    hint: z.string().nullable(),
    updatedAt: isoDate.nullable(),
  }),
  /** Read-only here: the code switch lives on the WhatsApp page. */
  verification: z.object({ mode: z.enum(PHONE_VERIFICATION_MODES) }),
});
export type WaAgentAdminSettings = z.output<typeof waAgentAdminSettingsSchema>;

export const setVoiceKeySchema = z.object({
  apiKey: z.string().trim().min(20).max(200),
});

export const voiceKeyStateSchema = waAgentAdminSettingsSchema.shape.voiceKey;
export type VoiceKeyState = z.output<typeof voiceKeyStateSchema>;

/** The "Test voice" box: a short text spoken with the saved voice settings. */
export const WA_AGENT_VOICE_TEST_MAX_CHARS = 300;
export const voiceTestSchema = z.object({
  text: z.string().trim().min(1).max(WA_AGENT_VOICE_TEST_MAX_CHARS),
});
export const voiceTestResultSchema = z.object({
  url: z.string(),
  mime: z.string(),
  chars: z.number().int(),
  expiresInSeconds: z.number().int(),
});
export type VoiceTestResult = z.output<typeof voiceTestResultSchema>;

/**
 * Why a voice test failed (`details.reason` of the error). The first group is the admin's to fix and
 * comes without a support reference; the second is a genuine outage (503) and carries one.
 */
export const VOICE_TEST_FIXABLE_REASONS = [
  "voice_key_missing",
  "voice_id_missing",
  "voice_key_unreadable",
  "voice_key_rejected",
  "voice_not_found",
  "voice_model_not_found",
  "voice_plan_required",
  "voice_format_not_allowed",
  "voice_quota_exceeded",
  "voice_rate_limited",
  "voice_bad_request",
] as const;
export const VOICE_TEST_OUTAGE_REASONS = [
  "voice_timeout",
  "voice_network",
  "voice_storage_failed",
  "voice_failed",
] as const;
export type VoiceTestReason =
  (typeof VOICE_TEST_FIXABLE_REASONS)[number] | (typeof VOICE_TEST_OUTAGE_REASONS)[number];

// --- Inbox --------------------------------------------------------------------------------------

export const waAgentConversationListQuerySchema = cursorQuerySchema.extend({
  status: z.enum(WA_AGENT_CONVERSATION_STATUSES).optional(),
  linked: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  q: z.string().trim().min(1).max(100).optional(),
});

export const waAgentConversationSchema = z.object({
  id: z.uuid(),
  /** Masked to the last 4 digits unless the search term matched the number. */
  phone: z.string().nullable(),
  user: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  status: z.enum(WA_AGENT_CONVERSATION_STATUSES),
  pausedUntil: isoDate.nullable(),
  lastInboundAt: isoDate.nullable(),
  lastOutboundAt: isoDate.nullable(),
  preview: z.string().max(80).nullable(),
});
export type WaAgentConversation = z.output<typeof waAgentConversationSchema>;

export const waAgentConversationPageSchema = z.object({
  items: z.array(waAgentConversationSchema),
  nextCursor: z.string().nullable(),
});

export const waAgentMessageSchema = z.object({
  id: z.uuid(),
  direction: z.enum(WA_AGENT_DIRECTIONS),
  kind: z.enum(WA_AGENT_KINDS),
  text: z.string().nullable(),
  status: z.enum(WA_AGENT_MESSAGE_STATUSES),
  dropReason: z.string().nullable(),
  /** Names of the tools the agent used for this reply. */
  tools: z.array(z.string()),
  hasMedia: z.boolean(),
  createdAt: isoDate,
});
export type WaAgentMessage = z.output<typeof waAgentMessageSchema>;

/** Newest first; the page reverses it to read top to bottom. */
export const waAgentMessagePageSchema = z.object({
  items: z.array(waAgentMessageSchema),
  nextCursor: z.string().nullable(),
});

export const waAgentMediaUrlSchema = z.object({
  url: z.string(),
  mime: z.string().nullable(),
  expiresInSeconds: z.number().int(),
});
export type WaAgentMediaUrl = z.output<typeof waAgentMediaUrlSchema>;

/** What a pause, resume, block or unblock returns: the chat's new state. */
export const waAgentConversationStateSchema = z.object({
  id: z.uuid(),
  status: z.enum(WA_AGENT_CONVERSATION_STATUSES),
  pausedUntil: isoDate.nullable(),
});
export type WaAgentConversationState = z.output<typeof waAgentConversationStateSchema>;

export const pauseConversationSchema = z.object({
  minutes: z.number().int().min(WA_AGENT_PAUSE_MIN_MINUTES).max(WA_AGENT_PAUSE_MAX_MINUTES),
});

// --- Usage --------------------------------------------------------------------------------------

export const waAgentUsageQuerySchema = z.object({
  days: z.coerce
    .number()
    .int()
    .refine((value) => value === 7 || value === 30, "days must be 7 or 30")
    .default(7),
});

export const waAgentUsageDaySchema = z.object({
  /** UTC day, `YYYY-MM-DD`. */
  day: z.string(),
  inbound: z.number().int(),
  outboundSent: z.number().int(),
  dropped: z.record(z.string(), z.number().int()),
  conversations: z.number().int(),
  linkedConversations: z.number().int(),
  guestConversations: z.number().int(),
  costUsdMicros: z.number().int(),
});
export type WaAgentUsageDay = z.output<typeof waAgentUsageDaySchema>;

export const waAgentUsageSchema = z.object({
  days: z.array(waAgentUsageDaySchema),
  today: z.object({
    spendUsdMicros: z.number().int(),
    spendCapUsdMicros: z.number().int(),
  }),
});
export type WaAgentUsage = z.output<typeof waAgentUsageSchema>;
