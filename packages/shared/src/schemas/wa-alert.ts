import { z } from "zod";

export const waAlertPayloadSchema = z.object({
  jid: z.string().regex(/^\d{6,15}@s\.whatsapp\.net$/),
  text: z.string().trim().min(1).max(300),
  dailyCap: z.number().int().min(1).max(20),
});
export const waAlertOptInSchema = z.object({
  action: z.enum(["optin", "optout"]),
  jid: z.string().regex(/^\d{6,15}@s\.whatsapp\.net$/),
  digits: z.string().regex(/^\d{6,15}$/),
});
