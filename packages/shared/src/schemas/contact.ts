import { z } from "zod";

import { emailSchema, phoneNumberSchema } from "./auth.js";

export const CONTACT_TOPICS = [
  "general",
  "support",
  "billing",
  "partnership",
  "privacy",
  "other",
] as const;
export type ContactTopic = (typeof CONTACT_TOPICS)[number];

/** Triage state of a stored message; the admin ticket UI of Phase 4 moves it along. */
export const CONTACT_STATUSES = ["new", "read", "archived"] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export const CONTACT_MESSAGE_MAX_LENGTH = 4000;

/** Public contact form. At least one way to reach the sender is required. */
export const contactMessageSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    email: emailSchema.optional(),
    phone: phoneNumberSchema.optional(),
    topic: z.enum(CONTACT_TOPICS),
    message: z.string().trim().min(10).max(CONTACT_MESSAGE_MAX_LENGTH),
  })
  .refine((value) => value.email || value.phone, {
    message: "email or phone required",
    path: ["email"],
  });
export type ContactMessageInput = z.infer<typeof contactMessageSchema>;

export const contactResponseSchema = z.object({ received: z.literal(true) });
export type ContactResponse = z.infer<typeof contactResponseSchema>;
