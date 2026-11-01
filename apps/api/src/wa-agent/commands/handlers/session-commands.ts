import { t, type MessageKey } from "@wasfa/shared/i18n";
import { MENU_ORDER } from "@wasfa/shared/wa-agent/commands";

import { composeParts } from "../../compose/compose-parts.js";
import { say, type CommandHandler } from "../command-types.js";

import { MENU_MS, sessionOf, untilOf } from "./shared.js";

import type { WaCommand } from "@wasfa/shared/i18n/wa-commands";

/** `new`: a fresh session; in-flight analyses are per conversation and keep running. */
export const newHandler: CommandHandler = async (input, deps) => {
  await deps.sessions.startNew(input.conversation.id, "command", input.now);
  return { parts: say(input, "whatsapp.agent.commands.new") };
};

const MENU_LABEL: Partial<Record<WaCommand, MessageKey>> = {
  analyze: "whatsapp.agent.commands.menu.analyze",
  report: "whatsapp.agent.commands.menu.report",
  balance: "whatsapp.agent.commands.menu.balance",
  schedule: "whatsapp.agent.commands.menu.schedule",
  voice: "whatsapp.agent.commands.menu.voice",
  lang: "whatsapp.agent.commands.menu.lang",
  human: "whatsapp.agent.commands.menu.human",
  new: "whatsapp.agent.commands.menu.new",
  privacy: "whatsapp.agent.commands.menu.privacy",
};

/** `help`: the numbered menu (1-9 in `MENU_ORDER`); a bare digit picks an entry for the next 10 minutes. */
export const helpHandler: CommandHandler = async (input, deps) => {
  const sessionId = await sessionOf(input, deps);
  await deps.sessions.setState(sessionId, { menu: untilOf(input.now, MENU_MS) });
  const lines = MENU_ORDER.flatMap((command, index) => {
    const key = MENU_LABEL[command];
    return key === undefined ? [] : [`${index + 1}. ${t(key, undefined, input.locale)}`];
  });
  const text = [
    t("whatsapp.agent.commands.help.header", undefined, input.locale),
    lines.join("\n"),
    t("whatsapp.agent.commands.help.footer", undefined, input.locale),
  ].join("\n\n");
  return { parts: composeParts(text, input.config.caps) };
};

/** `schedule`, `meds`, `remind`: Companion features that are not built yet. */
export const soonHandler: CommandHandler = (input) =>
  Promise.resolve({ parts: say(input, "whatsapp.agent.commands.soon") });
