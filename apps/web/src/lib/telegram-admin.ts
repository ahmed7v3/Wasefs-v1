import { z } from "zod";

/** Response shapes of `admin/telegram` (the API owns the contract; the page only reads it). */
export const telegramStatusSchema = z.object({
  configured: z.boolean(),
  tokenHint: z.string().nullable(),
  botUsername: z.string().nullable(),
  botName: z.string().nullable(),
  webhookUrl: z.string().nullable(),
  webhookOk: z.boolean(),
  pendingUpdates: z.number().int(),
  lastError: z.string().nullable(),
  enabled: z.boolean(),
  stats: z.object({
    chats: z.number().int(),
    linkedChats: z.number().int(),
    sharedPhones: z.number().int(),
    analysesToday: z.number().int(),
    messagesToday: z.number().int(),
  }),
});
export type TelegramStatus = z.infer<typeof telegramStatusSchema>;

export const TELEGRAM_WELCOME_MAX = 600;
export const TELEGRAM_SUPPORT_MAX = 64;

export const telegramSettingsSchema = z.object({
  enabled: z.boolean(),
  welcomeAr: z.string().max(TELEGRAM_WELCOME_MAX),
  welcomeEn: z.string().max(TELEGRAM_WELCOME_MAX),
  supportUsername: z.string().max(TELEGRAM_SUPPORT_MAX),
  adsEnabled: z.boolean(),
  autoPdf: z.boolean(),
});
export type TelegramSettings = z.infer<typeof telegramSettingsSchema>;

export const TELEGRAM_POLL_MS = 30_000;
