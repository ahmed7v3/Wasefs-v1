import { z } from "zod";

import { telegramBotSettingsSchema } from "../settings.js";

/*
 * Admin contract of the Telegram bot (docs/TELEGRAM-BOT.md). The bot token only travels inward
 * (`token`); responses carry a masked hint and the bot's public username.
 */

/** What BotFather hands out: `<bot id>:<secret>`. */
export const TELEGRAM_TOKEN_PATTERN = /^\d{6,}:[A-Za-z0-9_-]{30,}$/;

export const setTelegramTokenSchema = z.object({
  token: z.string().trim().regex(TELEGRAM_TOKEN_PATTERN),
});

export const telegramSettingsInputSchema = telegramBotSettingsSchema.extend({
  supportUsername: z
    .string()
    .trim()
    .max(64)
    .regex(/^@?[A-Za-z0-9_]*$/)
    .transform((value) => value.replace(/^@/, "")),
});
export type TelegramSettingsInput = z.output<typeof telegramSettingsInputSchema>;

export const telegramBroadcastTestSchema = z.object({
  text: z.string().trim().min(1).max(500),
});

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
export type TelegramStatus = z.output<typeof telegramStatusSchema>;
