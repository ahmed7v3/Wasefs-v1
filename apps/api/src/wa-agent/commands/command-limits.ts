import type { WaCommand } from "@wasfa/shared/i18n/wa-commands";
import type { Redis } from "ioredis";

interface Window {
  key: string;
  limit: number;
  seconds: number;
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * The windows a command is counted in (docs/WA-AGENT-RUNTIME.md §7.1, §18.4): 20 commands per 10 minutes for
 * the chat, `new` 10 per hour, privacy requests 3 per day. Keys are `wa:agent:cmd:*:<conversationId>`.
 */
function windowsOf(conversationId: string, command: WaCommand, confirming: boolean): Window[] {
  const windows: Window[] = [
    { key: `wa:agent:cmd:${conversationId}`, limit: 20, seconds: 10 * MINUTE },
  ];
  if (command === "new") {
    windows.push({ key: `wa:agent:cmd:new:${conversationId}`, limit: 10, seconds: HOUR });
  }
  if (command === "privacy" && !confirming) {
    windows.push({ key: `wa:agent:cmd:privacy:${conversationId}`, limit: 3, seconds: DAY });
  }
  return windows;
}

/** Counts a command in every window it belongs to; false when any is over (the text is then a normal message). */
export class CommandLimits {
  constructor(private readonly redis: Pick<Redis, "multi">) {}

  async allow(conversationId: string, command: WaCommand, confirming: boolean): Promise<boolean> {
    let allowed = true;
    for (const window of windowsOf(conversationId, command, confirming)) {
      // One transaction: the key always has its expiry, even if the process dies between the two commands.
      const replies = await this.redis
        .multi()
        .set(window.key, "0", "EX", window.seconds, "NX")
        .incr(window.key)
        .exec();
      const count = Number(replies?.[1]?.[1] ?? 0);
      if (count > window.limit) allowed = false;
    }
    return allowed;
  }
}
