import { Injectable } from "@nestjs/common";
import { ErrorCode, isAppError } from "@wasfa/shared/errors";
import { PinoLogger } from "nestjs-pino";

import {
  createWhatsAppUser,
  WhatsAppSignupClosedError,
} from "../../auth/whatsapp-login/create-whatsapp-user.js";
import {
  MAGIC_LINK_TTL_SECONDS,
  MagicLinkService,
} from "../../auth/whatsapp-login/magic-link.service.js";
import { whatsappLoginRefusal } from "../../auth/whatsapp-login/refusal.js";
import { WhatsAppLoginRepo } from "../../auth/whatsapp-login/whatsapp-login.repo.js";
import { WhatsAppLoginService } from "../../auth/whatsapp-login/whatsapp-login.service.js";
import { SettingsService } from "../../settings/settings.service.js";
import { WaAgentRepo } from "../wa-agent.repo.js";

import type { AgentToolResult } from "./tools/index.js";

/**
 * The agent's `create_account` and `login_link` (docs/WA-SIGNUP.md section 3). Who the call is for
 * comes from the turn: the chat's phone (resolved by the bridge) and its linked account, never from
 * the model. Accounts are made by the same function as the web flow; links are the same one-time
 * magic links, limited to 3 per user per hour.
 */
@Injectable()
export class AgentSignupService {
  constructor(
    private readonly accounts: WhatsAppLoginRepo,
    private readonly login: WhatsAppLoginService,
    private readonly magic: MagicLinkService,
    private readonly settings: SettingsService,
    private readonly conversations: WaAgentRepo,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("AgentSignup");
  }

  async create(input: {
    conversationId: string;
    phone: string;
    name?: string | undefined;
  }): Promise<AgentToolResult> {
    let created;
    try {
      created = await createWhatsAppUser(
        {
          repo: this.accounts,
          signupOpen: async () => {
            const access = await this.settings.get("access");
            return access.signupOpen && !access.maintenanceMode;
          },
          onSetupFailed: (userId) => {
            this.logger.error(`Invite code setup failed for user ${userId}`);
          },
        },
        { phone: input.phone, name: input.name },
      );
    } catch (error) {
      if (error instanceof WhatsAppSignupClosedError) {
        return { created: false, reason: "signup_closed" };
      }
      throw error;
    }
    // The number already has an account (the chat links on its next message): the model offers login_link.
    if (!created.isNew) return { created: false, reason: "exists" };

    await this.login.recordSignup(created.userId, "whatsapp_agent");
    await this.conversations.linkUser(input.conversationId, created.userId);
    const link = await this.magic.issue(created.userId, { isNew: true });
    return { created: true, isNew: true, loginUrl: link.url };
  }

  async loginLink(userId: string): Promise<AgentToolResult> {
    const account = await this.accounts.findById(userId);
    const refusal = account === null ? "inactive" : whatsappLoginRefusal(account);
    if (refusal !== null) return { ok: false, reason: refusal };
    try {
      const link = await this.magic.issue(userId);
      return { ok: true, loginUrl: link.url, expiresInMinutes: MAGIC_LINK_TTL_SECONDS / 60 };
    } catch (error) {
      if (isAppError(error) && error.code === ErrorCode.RATE_LIMITED) {
        return { ok: false, reason: "rate_limited" };
      }
      throw error;
    }
  }
}
