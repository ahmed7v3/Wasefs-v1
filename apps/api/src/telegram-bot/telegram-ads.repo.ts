import { Inject, Injectable } from "@nestjs/common";
import {
  approvedTelegramAdCandidates,
  deleteTelegramAdCampaign,
  deleteTelegramAdCreative,
  endTelegramAdCampaign,
  findMediaForTelegramAd,
  findTelegramAdCampaign,
  findTelegramAdCreative,
  findTelegramChatAdFacts,
  insertTelegramAdCampaign,
  insertTelegramAdCreative,
  insertTelegramAdEvent,
  listTelegramAdCampaigns,
  listTelegramAdCreatives,
  setTelegramChatAdsHidden,
  telegramAdButtonTarget,
  telegramAdCreativeCampaign,
  telegramAdEventSince,
  telegramAdImpressionCounts,
  telegramAdLastImpressionTrigger,
  telegramAdStatsByCampaign,
  telegramAdStatsByCreative,
  telegramAdStatsByDay,
  telegramAdStatsByDayCreative,
  telegramAdStatsByTrigger,
  telegramAdTotals,
  updateTelegramAdCampaign,
  updateTelegramAdCreative,
  type NewTelegramAdCampaign,
  type NewTelegramAdCreative,
  type TelegramAdEventInput,
  type TelegramAdStatsFilter,
} from "@wasfa/db";

import { DB, type DbHandle } from "../common/database.js";

/** Every query of the Telegram ads: delivery, events, the admin console and its analytics. */
@Injectable()
export class TelegramAdsRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  // delivery
  candidates() {
    return approvedTelegramAdCandidates(this.handle.db);
  }
  impressionCounts(campaignIds: readonly string[], since: Date) {
    return telegramAdImpressionCounts(this.handle.db, campaignIds, since);
  }
  endCampaign(id: string) {
    return endTelegramAdCampaign(this.handle.db, id);
  }
  chatFacts(chatId: number) {
    return findTelegramChatAdFacts(this.handle.db, chatId);
  }
  setAdsHidden(chatId: number, hidden: boolean) {
    return setTelegramChatAdsHidden(this.handle.db, chatId, hidden);
  }

  // events
  recordEvent(event: TelegramAdEventInput) {
    return insertTelegramAdEvent(this.handle.db, event);
  }
  eventSince(input: Parameters<typeof telegramAdEventSince>[1]) {
    return telegramAdEventSince(this.handle.db, input);
  }
  lastImpressionTrigger(chatId: number, creativeId: string) {
    return telegramAdLastImpressionTrigger(this.handle.db, chatId, creativeId);
  }
  creativeCampaign(creativeId: string) {
    return telegramAdCreativeCampaign(this.handle.db, creativeId);
  }
  buttonTarget(creativeId: string) {
    return telegramAdButtonTarget(this.handle.db, creativeId);
  }

  // admin: campaigns
  campaigns() {
    return listTelegramAdCampaigns(this.handle.db);
  }
  campaign(id: string) {
    return findTelegramAdCampaign(this.handle.db, id);
  }
  createCampaign(values: NewTelegramAdCampaign) {
    return insertTelegramAdCampaign(this.handle.db, values);
  }
  updateCampaign(id: string, patch: Partial<NewTelegramAdCampaign>) {
    return updateTelegramAdCampaign(this.handle.db, id, patch);
  }
  deleteCampaign(id: string) {
    return deleteTelegramAdCampaign(this.handle.db, id);
  }

  // admin: creatives
  creatives(campaignId?: string) {
    return listTelegramAdCreatives(this.handle.db, campaignId);
  }
  creative(id: string) {
    return findTelegramAdCreative(this.handle.db, id);
  }
  createCreative(values: NewTelegramAdCreative) {
    return insertTelegramAdCreative(this.handle.db, values);
  }
  updateCreative(id: string, patch: Partial<NewTelegramAdCreative>) {
    return updateTelegramAdCreative(this.handle.db, id, patch);
  }
  deleteCreative(id: string) {
    return deleteTelegramAdCreative(this.handle.db, id);
  }
  media(id: string) {
    return findMediaForTelegramAd(this.handle.db, id);
  }

  // admin: analytics
  async stats(filter: TelegramAdStatsFilter) {
    const db = this.handle.db;
    const [totals, byDay, byCampaign, byCreative, byTrigger] = await Promise.all([
      telegramAdTotals(db, filter),
      telegramAdStatsByDay(db, filter),
      telegramAdStatsByCampaign(db, filter),
      telegramAdStatsByCreative(db, filter),
      telegramAdStatsByTrigger(db, filter),
    ]);
    return { totals, byDay, byCampaign, byCreative, byTrigger };
  }
  statsByDayCreative(filter: TelegramAdStatsFilter) {
    return telegramAdStatsByDayCreative(this.handle.db, filter);
  }
}
