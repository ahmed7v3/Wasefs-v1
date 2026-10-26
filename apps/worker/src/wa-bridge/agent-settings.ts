import { settingDefault, type WaAgentSettings } from "@wasfa/shared/settings";

import { readSetting } from "../settings.js";

import type { Database } from "@wasfa/db";
import type { Logger } from "pino";

/** What the bridge needs to know about the two independent switches. */
export interface AgentSwitches {
  /** `waAgent` settings (the agent's own switch is `agent.enabled`). */
  agent: WaAgentSettings;
  /** `auth.phoneVerification === "whatsapp_inbound"`: codes go to `wa:inbound`. */
  verificationOn: boolean;
}

export interface AgentSettingsSource {
  current: () => Promise<AgentSwitches>;
}

/** An admin's change applies within this long (the kill switch included). */
export const AGENT_SETTINGS_TTL_MS = 30_000;

/**
 * `waAgent` and `auth.phoneVerification`, cached for 30 s. A failed read keeps the last good value;
 * with none, the agent is off and verification as today, so a database blip can neither start the
 * agent nor break the code path.
 */
export class AgentSettingsCache implements AgentSettingsSource {
  private at = Number.NEGATIVE_INFINITY;
  private value: AgentSwitches = {
    agent: settingDefault("waAgent"),
    verificationOn: true,
  };

  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
    private readonly now: () => number = Date.now,
    private readonly read: (db: Database) => Promise<AgentSwitches> = readSwitches,
  ) {}

  async current(): Promise<AgentSwitches> {
    if (this.now() - this.at > AGENT_SETTINGS_TTL_MS) {
      try {
        this.value = await this.read(this.db);
      } catch (error) {
        this.logger.error(
          { reason: error instanceof Error ? error.name : "unknown" },
          "Reading the WhatsApp agent settings failed",
        );
      }
      // Also after a failure: do not hammer a struggling database on every message.
      this.at = this.now();
    }
    return this.value;
  }
}

async function readSwitches(db: Database): Promise<AgentSwitches> {
  const [agent, auth] = await Promise.all([readSetting(db, "waAgent"), readSetting(db, "auth")]);
  return { agent, verificationOn: auth.phoneVerification === "whatsapp_inbound" };
}
