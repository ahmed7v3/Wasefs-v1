import { Inject, Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import {
  type VoiceKeyState,
  type WaAgentAdminSettings,
  type WaAgentConversation,
  type WaAgentConversationState,
  type WaAgentMediaUrl,
  type WaAgentMessage,
  type WaAgentUsage,
  type WaAgentUsageDay,
} from "@wasfa/shared/schemas/admin-wa-agent";
import { FILE_URL_TTL_SECONDS } from "@wasfa/shared/schemas/files";
import { WA_AGENT_MEDIA_PREFIX } from "@wasfa/shared/schemas/wa-agent";

import { AuditService } from "../../audit/audit.service.js";
import { API_ENV } from "../../config/config.module.js";
import { encryptionKey, type ApiEnv } from "../../config/env.js";
import { ObjectStorage } from "../../files/object-storage.js";
import { SettingsService } from "../../settings/settings.service.js";
import { WaAgentStateService } from "../../wa-agent/wa-agent-state.service.js";
import { decodeCursor, toPage } from "../common/keyset.js";

import { AdminWaAgentRepo } from "./admin-wa-agent.repo.js";

import type { AuditScope } from "../../audit/audited.decorator.js";
import type { WaConversation } from "@wasfa/db";
import type { WaAgentSettings } from "@wasfa/shared/settings";
import type { FastifyRequest } from "fastify";

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const MESSAGE_PAGE = 50;

const notFound = (reason?: string) =>
  new AppError(ErrorCode.NOT_FOUND, reason === undefined ? {} : { details: { reason } });
const conflict = (reason: string) => new AppError(ErrorCode.CONFLICT, { details: { reason } });
const invalid = (reason: string, field: string) =>
  new AppError(ErrorCode.VALIDATION_FAILED, { details: { reason, fields: [field] } });

/** `+201001234567` becomes `+••••••••4567`: the last 4 digits only. */
export function maskChatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 4) return "••••";
  return `+${"•".repeat(digits.length - 4)}${digits.slice(-4)}`;
}

/** The number is shown in full only when the search term was (part of) that very number. */
function phoneMatchesSearch(phone: string, q: string | undefined): boolean {
  if (q === undefined || !/^[+\d\s-]+$/.test(q)) return false;
  const digits = q.replace(/\D/g, "");
  return digits.length >= 3 && phone.replace(/\D/g, "").includes(digits);
}

/** Tool names the agent recorded in a reply's `meta.tools` (strings or `{ name }` objects). */
function toolNames(meta: Record<string, unknown>): string[] {
  const tools = meta["tools"];
  if (!Array.isArray(tools)) return [];
  const names: string[] = [];
  for (const entry of tools as unknown[]) {
    if (typeof entry === "string") names.push(entry);
    else if (entry !== null && typeof entry === "object") {
      const name = (entry as { name?: unknown }).name;
      if (typeof name === "string") names.push(name);
    }
  }
  return names.slice(0, 10);
}

const utcMidnight = (instant: number): Date => new Date(Math.floor(instant / DAY_MS) * DAY_MS);

/** Settings, voice key, inbox, usage and chat controls of the WhatsApp AI agent. */
@Injectable()
export class AdminWaAgentService {
  constructor(
    private readonly repo: AdminWaAgentRepo,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly state: WaAgentStateService,
    private readonly storage: ObjectStorage,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  // --- Settings and the voice key -------------------------------------------------------------

  async getSettings(): Promise<WaAgentAdminSettings> {
    const [settings, auth, voiceKey] = await Promise.all([
      this.settings.get("waAgent"),
      this.settings.get("auth"),
      this.voiceKeyState(),
    ]);
    return { settings, voiceKey, verification: { mode: auth.phoneVerification } };
  }

  /** Saves the whole agent setting (audited by `SettingsService.set`) after checking its media list. */
  async putSettings(
    actorId: string,
    request: FastifyRequest,
    input: WaAgentSettings,
  ): Promise<WaAgentAdminSettings> {
    await this.checkMedia(input.media);
    await this.settings.set("waAgent", input, { actorId, request });
    return this.getSettings();
  }

  async setVoiceKey(actorId: string, apiKey: string, audit: AuditScope): Promise<VoiceKeyState> {
    const stored = await this.repo.setVoiceKey(apiKey, encryptionKey(this.env), actorId);
    audit.targetId = "elevenlabs";
    // Never the key: whether one exists and its masked hint.
    audit.after = { hasKey: true, keyHint: stored.hint };
    return { set: true, hint: stored.hint, updatedAt: stored.updatedAt.toISOString() };
  }

  async clearVoiceKey(audit: AuditScope): Promise<void> {
    audit.targetId = "elevenlabs";
    audit.after = { hasKey: false, keyHint: null };
    await this.repo.clearVoiceKey();
  }

  private async voiceKeyState(): Promise<VoiceKeyState> {
    const meta = await this.repo.voiceKeyMeta();
    return meta
      ? { set: true, hint: meta.hint, updatedAt: meta.updatedAt.toISOString() }
      : { set: false, hint: null, updatedAt: null };
  }

  /** Every listed asset must be a finished image of the media library, and each key used once. */
  private async checkMedia(media: WaAgentSettings["media"]): Promise<void> {
    const seen = new Set<string>();
    for (const [index, item] of media.entries()) {
      if (seen.has(item.key)) throw invalid("duplicate_media_key", `media.${index}.key`);
      seen.add(item.key);
    }
    const assets = await this.repo.assetsById(media.map((item) => item.mediaAssetId));
    for (const [index, item] of media.entries()) {
      const asset = assets.get(item.mediaAssetId);
      if (!asset || asset.status !== "ready" || !(asset.mime ?? "").startsWith("image/")) {
        throw invalid("media_asset_invalid", `media.${index}.mediaAssetId`);
      }
    }
  }

  // --- Inbox ----------------------------------------------------------------------------------

  async conversations(query: {
    status?: WaConversation["status"] | undefined;
    linked?: boolean | undefined;
    q?: string | undefined;
    cursor?: string | undefined;
    limit: number;
  }) {
    const rows = await this.repo.conversations(
      { status: query.status, linked: query.linked, q: query.q },
      decodeCursor(query.cursor, "uuid"),
      query.limit,
    );
    const page = toPage(rows, query.limit, (row) => ({ at: row.cursorAt, key: row.id }));
    const items: WaAgentConversation[] = page.items.map((row) => ({
      id: row.id,
      phone:
        row.phone === null
          ? null
          : phoneMatchesSearch(row.phone, query.q)
            ? row.phone
            : maskChatPhone(row.phone),
      user: row.userId !== null ? { id: row.userId, name: row.userName ?? "" } : null,
      status: row.status,
      pausedUntil: row.pausedUntil?.toISOString() ?? null,
      lastInboundAt: row.lastInboundAt?.toISOString() ?? null,
      lastOutboundAt: row.lastOutboundAt?.toISOString() ?? null,
      preview: row.preview,
    }));
    return { items, nextCursor: page.nextCursor };
  }

  /** One page of a transcript, newest first. Health data: every read leaves an audit row. */
  async messages(
    request: FastifyRequest,
    conversationId: string,
    query: { cursor?: string | undefined },
  ) {
    const conversation = await this.repo.findConversation(conversationId);
    if (!conversation) throw notFound();
    const cursor = decodeCursor(query.cursor, "uuid");
    const rows = await this.repo.transcript(conversationId, cursor, MESSAGE_PAGE);
    const page = toPage(rows, MESSAGE_PAGE, (row) => ({ at: row.cursorAt, key: row.id }));
    await this.audit.recordFor(request, {
      action: "wa_agent.transcript_view",
      targetType: "wa_conversation",
      targetId: conversationId,
    });
    const items: WaAgentMessage[] = page.items.map((row) => ({
      id: row.id,
      direction: row.direction,
      kind: row.kind,
      text: row.text,
      status: row.status,
      dropReason: row.dropReason,
      tools: toolNames(row.meta),
      hasMedia: row.hasMedia,
      createdAt: row.createdAt.toISOString(),
    }));
    return { items, nextCursor: page.nextCursor };
  }

  /** A 60 second link to a stored `wa/` object. Nothing else in the bucket is ever signed here. */
  async mediaUrl(request: FastifyRequest, messageId: string): Promise<WaAgentMediaUrl> {
    const media = await this.repo.messageMedia(messageId);
    if (
      !media ||
      !media.mediaKey.startsWith(WA_AGENT_MEDIA_PREFIX) ||
      media.mediaKey.includes("..")
    ) {
      throw notFound();
    }
    const url = await this.storage.presignGet(media.mediaKey, FILE_URL_TTL_SECONDS);
    await this.audit.recordFor(
      request,
      {
        action: "wa_agent.media_view",
        targetType: "wa_message",
        targetId: messageId,
        after: { conversationId: media.conversationId },
      },
      { verbatim: true },
    );
    return { url, mime: media.mediaMime, expiresInSeconds: FILE_URL_TTL_SECONDS };
  }

  // --- Chat controls --------------------------------------------------------------------------

  async pause(id: string, minutes: number, audit: AuditScope): Promise<WaAgentConversationState> {
    const before = await this.require(id);
    const updated = await this.state.pause(id, new Date(Date.now() + minutes * MINUTE_MS));
    if (!updated) throw notFound();
    return this.finish(before, updated, audit, { minutes });
  }

  async resume(id: string, audit: AuditScope): Promise<WaAgentConversationState> {
    const before = await this.require(id);
    const updated = await this.state.resume(id);
    if (!updated) throw notFound();
    return this.finish(before, updated, audit);
  }

  async block(id: string, audit: AuditScope): Promise<WaAgentConversationState> {
    const before = await this.require(id);
    const updated = await this.state.block(id);
    if (!updated) throw notFound();
    return this.finish(before, updated, audit);
  }

  async unblock(id: string, audit: AuditScope): Promise<WaAgentConversationState> {
    const before = await this.require(id);
    if (before.status !== "blocked") throw conflict("not_blocked");
    const updated = await this.state.resume(id);
    if (!updated) throw notFound();
    return this.finish(before, updated, audit);
  }

  private async require(id: string): Promise<WaConversation> {
    const conversation = await this.repo.findConversation(id);
    if (!conversation) throw notFound();
    return conversation;
  }

  private finish(
    before: WaConversation,
    after: WaConversation,
    audit: AuditScope,
    extra: Record<string, unknown> = {},
  ): WaAgentConversationState {
    audit.targetId = after.id;
    audit.before = {
      status: before.status,
      pausedUntil: before.pausedUntil?.toISOString() ?? null,
    };
    audit.after = {
      status: after.status,
      pausedUntil: after.pausedUntil?.toISOString() ?? null,
      ...extra,
    };
    return {
      id: after.id,
      status: after.status,
      pausedUntil: after.pausedUntil?.toISOString() ?? null,
    };
  }

  // --- Usage ----------------------------------------------------------------------------------

  /** Per UTC day: messages, chats, drops by reason and the agent's own AI cost, plus today's cap. */
  async usage(days: number): Promise<WaAgentUsage> {
    const todayStart = utcMidnight(Date.now());
    const since = new Date(todayStart.getTime() - (days - 1) * DAY_MS);
    const [counts, dropped, costs, settings] = await Promise.all([
      this.repo.usageByDay(since),
      this.repo.droppedByDay(since),
      this.repo.costByDay(since),
      this.settings.get("waAgent"),
    ]);
    const countsByDay = new Map(counts.map((row) => [row.day, row]));
    const costByDay = new Map(costs.map((row) => [row.day, row.costUsdMicros]));
    const result: WaAgentUsageDay[] = [];
    for (let index = 0; index < days; index += 1) {
      const day = new Date(since.getTime() + index * DAY_MS).toISOString().slice(0, 10);
      const row = countsByDay.get(day);
      result.push({
        day,
        inbound: row?.inbound ?? 0,
        outboundSent: row?.outboundSent ?? 0,
        dropped: Object.fromEntries(
          dropped.filter((entry) => entry.day === day).map((entry) => [entry.reason, entry.count]),
        ),
        conversations: row?.conversations ?? 0,
        linkedConversations: row?.linkedConversations ?? 0,
        guestConversations: row?.guestConversations ?? 0,
        costUsdMicros: costByDay.get(day) ?? 0,
      });
    }
    const today = result.at(-1);
    return {
      days: result,
      today: {
        spendUsdMicros: today?.costUsdMicros ?? 0,
        spendCapUsdMicros: settings.spendCapUsdMicros,
      },
    };
  }
}
