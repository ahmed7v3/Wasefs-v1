import { Injectable } from "@nestjs/common";
import { t } from "@wasfa/shared/i18n";
import { PinoLogger } from "nestjs-pino";

import { ChatTurnService } from "../../chat/chat-turn.service.js";
import { CreditsService } from "../../credits/credits.service.js";
import { splitReply, toWhatsappText } from "../agent/agent-output.js";
import { WaOutboundService } from "../transport/outbound.service.js";

import { WaAgentCommerceRepo } from "./agent-commerce.repo.js";
import { agentUser } from "./agent-user.js";
import { usageReason } from "./usage-errors.js";

import type { AgentCall, AgentToolResult } from "../agent/tools/tool.js";
import type { WaAgentOutboundPart } from "@wasfa/shared/schemas/wa-agent";

/**
 * `ask_medical`: the question goes through the web assistant's own engine (prompts, skills, safety,
 * quota, credit hold and settle), and the answer is delivered to the customer AS IS: the agent model
 * never sees it, so it cannot reword medical content. The fixed disclaimer closes the answer.
 */
@Injectable()
export class AgentMedicalService {
  constructor(
    private readonly commerce: WaAgentCommerceRepo,
    private readonly chat: ChatTurnService,
    private readonly credits: CreditsService,
    private readonly outbound: WaOutboundService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("WaAgentMedical");
  }

  async ask(call: AgentCall, question: string): Promise<AgentToolResult> {
    const row = await this.commerce.user(call.userId);
    if (row?.status !== "active") return { delivered: false, reason: "account_unavailable" };
    const locale = call.config.language === "en" ? "en" : "ar";
    const { maxReplyChars, maxMessagesPerTurn } = call.config.caps;
    // The answer must fit the chat's message caps; tell the engine so instead of cutting it later.
    const budget = Math.max(1, maxMessagesPerTurn - 1) * maxReplyChars;

    let answer: { text: string; creditsCharged: number };
    try {
      answer = await this.chat.answerOnce(
        agentUser(row, call.now),
        `${question}\n\n${t("whatsapp.agent.medical.lengthHint", { chars: Math.floor(budget * 0.85) }, locale)}`,
        { chatTitle: t("whatsapp.agent.chatTitle", {}, "ar") },
      );
    } catch (error) {
      const reason = usageReason(error);
      if (reason === null) throw error;
      if (reason === "insufficient_credits") {
        const wallet = await this.credits.forUser(call.userId, call.now);
        return { delivered: false, reason, balance: wallet.wallet.balance };
      }
      return { delivered: false, reason };
    }

    const body = splitReply(
      toWhatsappText(answer.text),
      Math.max(1, maxMessagesPerTurn - 1),
      maxReplyChars,
    );
    const parts: WaAgentOutboundPart[] = [
      ...body.map((text): WaAgentOutboundPart => ({ kind: "text", text })),
      { kind: "text", text: t("chat.disclaimer", {}, locale) },
    ];
    try {
      await this.outbound.enqueue(call.conversationId, parts);
    } catch (error) {
      // Paused, blocked or switched off while the engine worked: the answer is not wanted any more.
      this.logger.info(
        {
          conversationId: call.conversationId,
          reason: error instanceof Error ? error.name : "unknown",
        },
        "Medical answer not delivered",
      );
      return { delivered: false, reason: "not_deliverable" };
    }
    this.logger.info(
      { conversationId: call.conversationId, parts: parts.length, credits: answer.creditsCharged },
      "Medical answer delivered",
    );
    return { delivered: true, creditsCharged: answer.creditsCharged };
  }
}
