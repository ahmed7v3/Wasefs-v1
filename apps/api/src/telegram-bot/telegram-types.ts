import { z } from "zod";

/*
 * The slice of the Telegram Bot API this bot reads. Loose objects: Telegram adds fields all the time,
 * and the webhook body is untrusted input, so only what is used is parsed.
 */
const user = z.looseObject({
  id: z.number().int(),
  is_bot: z.boolean().optional(),
  username: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  language_code: z.string().optional(),
});
const chat = z.looseObject({ id: z.number().int(), type: z.string() });
const photoSize = z.looseObject({
  file_id: z.string(),
  file_unique_id: z.string(),
  file_size: z.number().int().optional(),
  width: z.number().int(),
  height: z.number().int(),
});

export const telegramMessageSchema = z.looseObject({
  message_id: z.number().int(),
  chat,
  from: user.optional(),
  text: z.string().optional(),
  caption: z.string().optional(),
  media_group_id: z.string().optional(),
  photo: z.array(photoSize).optional(),
  document: z
    .looseObject({
      file_id: z.string(),
      file_unique_id: z.string(),
      mime_type: z.string().optional(),
      file_size: z.number().int().optional(),
    })
    .optional(),
  contact: z
    .looseObject({ phone_number: z.string(), user_id: z.number().int().optional() })
    .optional(),
});
export type TelegramMessage = z.output<typeof telegramMessageSchema>;

export const telegramUpdateSchema = z.looseObject({
  update_id: z.number().int(),
  message: telegramMessageSchema.optional(),
  callback_query: z
    .looseObject({
      id: z.string(),
      from: user,
      data: z.string().optional(),
      message: z.looseObject({ message_id: z.number().int(), chat }).optional(),
    })
    .optional(),
});
export type TelegramUpdate = z.output<typeof telegramUpdateSchema>;

/** One picture of an analysis, as the bot collected it. */
export interface TelegramPhoto {
  fileId: string;
  uniqueId: string;
  mime: "image/jpeg" | "image/png" | "image/webp";
  bytes: number;
}

export type InlineButton = { text: string; callback_data: string } | { text: string; url: string };

export type ReplyMarkup =
  | { inline_keyboard: InlineButton[][] }
  | {
      keyboard: { text: string; request_contact?: boolean }[][];
      resize_keyboard: boolean;
      one_time_keyboard: boolean;
    }
  | { remove_keyboard: true };

export type BotLocale = "ar" | "en";
