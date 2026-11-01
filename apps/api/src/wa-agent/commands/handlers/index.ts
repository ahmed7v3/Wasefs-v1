import { balanceHandler, reportHandler } from "./account-commands.js";
import { analyzeHandler } from "./analyze.js";
import { humanHandler, langHandler, privacyHandler, voiceHandler } from "./chat-commands.js";
import { helpHandler, newHandler, soonHandler } from "./session-commands.js";

import type { CommandHandler } from "../command-types.js";
import type { WaCommand } from "@wasfa/shared/i18n/wa-commands";

/** One handler per command name (admins add aliases, never commands). */
export const HANDLERS: Record<WaCommand, CommandHandler> = {
  new: newHandler,
  analyze: analyzeHandler,
  help: helpHandler,
  balance: balanceHandler,
  report: reportHandler,
  schedule: soonHandler,
  meds: soonHandler,
  remind: soonHandler,
  voice: voiceHandler,
  lang: langHandler,
  human: humanHandler,
  privacy: privacyHandler,
};
