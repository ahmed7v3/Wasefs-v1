import { ar, t, type Locale, type MessageKey } from "@wasfa/shared/i18n";

/*
 * `explain`: a fixed sentence per refusal code (`whatsapp.agent.tools.explain.<code>`, docs/WA-AGENT-RUNTIME.md
 * §18.5) so the model paraphrases a vetted text instead of improvising on a raw code. Added centrally by
 * `bindTools`; a code without a key simply gets no `explain`.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The flags a service sets to false next to its `reason` when it declines (`started: false, reason: ...`). */
const DECLINE_FLAGS = ["started", "offered", "delivered", "created", "attached", "ok"] as const;

/** The refusal code of a tool result: `{ error }`, or `{ <flag>: false, reason }`; null for a success. */
export function refusalCodeOf(result: unknown): string | null {
  if (!isRecord(result)) return null;
  if (typeof result["error"] === "string") return result["error"];
  const reason = result["reason"];
  if (typeof reason === "string" && DECLINE_FLAGS.some((flag) => result[flag] === false)) {
    return reason;
  }
  return null;
}

/** The i18n key of a code's explanation, or null when it has none. */
export function explainKey(code: string): MessageKey | null {
  const key = `whatsapp.agent.tools.explain.${code}`;
  return Object.hasOwn(ar, key) ? (key as MessageKey) : null;
}

/** `result` plus its `explain` sentence when it is a refusal that has none yet. */
export function withExplain(result: unknown, locale: Locale): unknown {
  if (!isRecord(result) || "explain" in result) return result;
  const code = refusalCodeOf(result);
  const key = code === null ? null : explainKey(code);
  return key === null ? result : { ...result, explain: t(key, undefined, locale) };
}
