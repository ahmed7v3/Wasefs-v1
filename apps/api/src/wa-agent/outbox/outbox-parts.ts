import { t, type Locale } from "@wasfa/shared/i18n";
import { type WaAgentEvent, type WaAgentOutboundPart } from "@wasfa/shared/schemas/wa-agent";

import {
  documentFailedText,
  paymentMessage,
  rxDoneParts,
  rxFailedText,
  rxFailureText,
} from "../commerce/agent-event-messages.js";
import { agentUser } from "../commerce/agent-user.js";

import type { RxService } from "../../rx/rx.service.js";
import type { WaAgentCommerceRepo } from "../commerce/agent-commerce.repo.js";
import type { WaConversation } from "@wasfa/db";

export interface PartCaps {
  maxReplyChars: number;
  maxMessagesPerTurn: number;
}

type PaymentEvent = Extract<WaAgentEvent, { orderId: string }>;
type DocumentEvent = Extract<WaAgentEvent, { type: "document_ready" | "document_failed" }>;
type RxEvent = Extract<WaAgentEvent, { rxId: string }>;

/**
 * Turns one worker event into the messages the customer gets (no model: the words are i18n, the facts are
 * read for the account the chat belongs to). Shared by the v1 events consumer and the v2 outbox deliverer,
 * so a result reads the same on both paths. Returns null when there is nothing to tell (account gone,
 * order not found).
 */
export class EventPartsBuilder {
  constructor(
    private readonly webOrigin: string,
    private readonly commerce: WaAgentCommerceRepo,
    private readonly rx: RxService,
  ) {}

  async parts(
    event: WaAgentEvent,
    conversation: WaConversation,
    caps: PartCaps,
    locale: Locale,
  ): Promise<WaAgentOutboundPart[] | null> {
    if (event.type === "document_ready" || event.type === "document_failed") {
      return this.documentParts(event, locale);
    }
    // The PDF of a result takes one of the allowed messages; with only one allowed the text wins.
    const withPdf =
      event.type === "rx_done" && event.pdfKey !== undefined && caps.maxMessagesPerTurn >= 2;
    const textCaps = withPdf ? { ...caps, maxMessagesPerTurn: caps.maxMessagesPerTurn - 1 } : caps;
    const texts =
      "rxId" in event
        ? await this.rxTexts(event, conversation, textCaps, locale, withPdf)
        : await this.paymentTexts(event, locale);
    if (texts === null) return null;
    const parts = texts.map((text): WaAgentOutboundPart => ({ kind: "text", text }));
    // A result that turned out to be missing is the failure line: no PDF goes with it.
    const failed = texts.length === 1 && texts[0] === rxFailedText(locale);
    if (withPdf && !failed && event.type === "rx_done" && event.pdfKey !== undefined) {
      parts.push({
        kind: "document",
        mediaKey: event.pdfKey,
        fileName: `${t("whatsapp.agent.event.rxPdfName", {}, locale)}.pdf`,
      });
    }
    return parts;
  }

  private documentParts(event: DocumentEvent, locale: Locale): WaAgentOutboundPart[] {
    if (event.type === "document_failed") {
      return [{ kind: "text", text: documentFailedText(locale) }];
    }
    return [
      event.kind === "image"
        ? { kind: "image", mediaKey: event.mediaKey }
        : { kind: "document", mediaKey: event.mediaKey, fileName: event.fileName },
    ];
  }

  private async paymentTexts(event: PaymentEvent, locale: Locale): Promise<string[] | null> {
    // Scoped to the user in the event: an order of anyone else is simply not found.
    const row = await this.commerce.orderWithPayment(event.userId, event.orderId);
    if (!row) return null;
    const plan = row.order.planId === null ? null : await this.commerce.plan(row.order.planId);
    return [
      paymentMessage(
        event.type,
        {
          number: row.order.number,
          planName: plan === null ? null : locale === "en" ? plan.nameEn : plan.nameAr,
          rejectReason: row.payment.rejectReason,
        },
        locale,
      ),
    ];
  }

  private async rxTexts(
    event: RxEvent,
    conversation: WaConversation,
    caps: PartCaps,
    locale: Locale,
    withPdf: boolean,
  ): Promise<string[] | null> {
    if (event.type === "rx_failed") {
      // A typed failure says whether the credits came back only as far as the worker observed it.
      return [
        event.reason === undefined
          ? rxFailedText(locale)
          : rxFailureText(event.reason, event.creditsReturned === true, locale),
      ];
    }
    if (conversation.userId === null) return null;
    const row = await this.commerce.user(conversation.userId);
    if (row?.status !== "active") return null;
    // The analysis is read as its owner: someone else's analysis id is simply not found.
    const view = await this.rx.get(agentUser(row, new Date()), event.rxId);
    if (view.result === null) return [rxFailedText(locale)];
    return rxDoneParts(
      view.result,
      `${this.webOrigin}/analyze/${event.rxId}`,
      caps,
      locale,
      withPdf,
    );
  }
}
