import { z } from "zod";

/*
 * WhatsApp agent sessions (docs/WA-AGENT-RUNTIME.md §18). A session is the slice of a chat the model sees:
 * it ends on the `new` command, on the privacy command or after `waAgent.sessions.idleHours` of silence.
 * (The end reasons live with the other WA enums in `schemas/wa-agent`.)
 */

/** The commands a customer can type (§18.4); admins may add aliases for these, never new commands. */
export const WA_COMMAND_NAMES = [
  "new",
  "analyze",
  "help",
  "balance",
  "report",
  "schedule",
  "meds",
  "remind",
  "voice",
  "lang",
  "human",
  "privacy",
] as const;
export type WaCommandName = (typeof WA_COMMAND_NAMES)[number];

/** Media sent within this long of the previous one belongs to the same set (a prescription's pages). */
export const SET_BURST_MS = 120_000;

/** Chat facts the customer chose; they survive a new session (`wa_conversations.profile`). */
export const waAgentProfileSchema = z.object({
  lang: z.enum(["ar", "en"]).optional(),
  voice: z.enum(["on", "off"]).optional(),
  preferredName: z.string().max(40).optional(),
});
export type WaAgentProfile = z.infer<typeof waAgentProfileSchema>;

const untilSchema = z.object({ until: z.iso.datetime() });

/** Short-lived chat state (`wa_agent_sessions.state`); an expired entry counts as absent. */
export const waSessionStateSchema = z.object({
  menu: untilSchema.optional(),
  awaitingRx: untilSchema.optional(),
  privacyConfirm: untilSchema.optional(),
});
export type WaSessionState = z.infer<typeof waSessionStateSchema>;

/** True while the entry exists and its `until` lies after `now`. */
export function isActive(entry: { until: string } | undefined, now: Date): boolean {
  if (entry === undefined) return false;
  const until = Date.parse(entry.until);
  return Number.isFinite(until) && until > now.getTime();
}

/**
 * The label after `label` in A..Z, AA, AB..AZ, BA..ZZ, AAA... (spreadsheet columns); null starts at "A".
 * Shorter labels always sort before longer ones, so order is (length, then alphabet).
 */
export function nextSetLabel(label: string | null): string {
  if (label === null || label === "") return "A";
  const chars = [...label];
  for (let index = chars.length - 1; index >= 0; index -= 1) {
    if (chars[index] !== "Z") {
      chars[index] = String.fromCharCode((chars[index] ?? "A").charCodeAt(0) + 1);
      return chars.join("");
    }
    chars[index] = "A";
  }
  return `A${chars.join("")}`;
}
