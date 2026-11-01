import { say, type CommandHandler } from "../command-types.js";

import { PRIVACY_CONFIRM_MS, sessionOf, untilOf } from "./shared.js";

/**
 * `voice`: the chat's voice preference (`profile.voice`, kept across sessions). With no argument it
 * toggles; `off` stops every voice reply, `on` hands voice back to the admin's own rules.
 */
export const voiceHandler: CommandHandler = async (input, deps) => {
  const { step, conversation } = input;
  const current = conversation.profile.voice ?? "on";
  const next = step.arg === "on" || step.arg === "off" ? step.arg : current === "on" ? "off" : "on";
  await deps.sessions.setProfile(conversation.id, { voice: next });
  return {
    parts: say(
      input,
      next === "on" ? "whatsapp.agent.commands.voice.on" : "whatsapp.agent.commands.voice.off",
    ),
  };
};

/** `lang`: the language of this chat's replies (`profile.lang`); no argument switches to the other one. */
export const langHandler: CommandHandler = async (input, deps) => {
  const { step, conversation } = input;
  const next =
    step.arg === "en" || step.arg === "ar" ? step.arg : input.locale === "en" ? "ar" : "en";
  await deps.sessions.setProfile(conversation.id, { lang: next });
  // The confirmation is already in the new language.
  return {
    parts: say(
      { config: input.config, locale: next },
      next === "en" ? "whatsapp.agent.commands.lang.en" : "whatsapp.agent.commands.lang.ar",
    ),
  };
};

/** `human`: what the `handoff_to_owner` tool does: owner alert now, pause once this reply was delivered. */
export const humanHandler: CommandHandler = async (input, deps) => {
  await deps.handoff.raise(input.conversation.id, "command");
  return {
    parts: say(input, "whatsapp.agent.fallback.handoff_to_owner"),
    handoffReason: "command",
  };
};

/**
 * `privacy` (docs/WA-AGENT-RUNTIME.md §18.4): the first call asks for the confirmation word; the word within
 * 5 minutes deletes this conversation's messages and their stored files (not the account, not the rx
 * results), ends the session and leaves an audit row with the conversation id only. The audit row is
 * written first: a turn that fails halfway is retried from its still-present confirm row.
 */
export const privacyHandler: CommandHandler = async (input, deps) => {
  const { conversation, step, now } = input;
  if (step.arg !== "confirm") {
    const sessionId = await sessionOf(input, deps);
    await deps.sessions.setState(sessionId, { privacyConfirm: untilOf(now, PRIVACY_CONFIRM_MS) });
    return { parts: say(input, "whatsapp.agent.commands.privacy.ask") };
  }
  await deps.audit.record({
    actorId: null,
    action: "wa_agent.privacy_delete",
    targetType: "wa_conversation",
    targetId: conversation.id,
  });
  const keys = await deps.store.erase(conversation.id, step.at);
  await deps.sessions.startNew(conversation.id, "privacy", now);
  // Files go after the rows: a failed removal leaves an orphan the retention sweep takes, not a dangling row.
  for (const key of keys) await deps.storage.remove(key).catch(() => undefined);
  return { parts: say(input, "whatsapp.agent.commands.privacy.done") };
};
