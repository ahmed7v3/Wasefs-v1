import { newPhone } from "./accounts";
import { bridgeConnected, bridgeGone, sendInbound } from "./whatsapp";

import type { StackUrls } from "./runtime";
import type { BrowserContext } from "@playwright/test";
import type { Redis } from "ioredis";

/**
 * Verifies a phone number on the signed-in account through the real API and the stand-in WhatsApp
 * bridge (the UI path has its own spec in phone.spec.ts), then reports the bridge down again.
 * Returns the number in E.164.
 */
export async function verifyPhoneViaApi(
  context: BrowserContext,
  urls: StackUrls,
  redis: Redis,
): Promise<string> {
  const phone = newPhone();
  await bridgeConnected(redis);
  const headers = { Origin: urls.web };
  const started = await context.request.post(`${urls.api}/phone/verify/start`, {
    data: { phoneNumber: phone.e164 },
    headers,
  });
  if (!started.ok()) throw new Error(`phone start failed: ${String(started.status())}`);
  const { code } = (await started.json()) as { code?: string };
  if (!code) throw new Error("phone start returned no code");
  await sendInbound(redis, phone.e164, code);

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const status = (await (
      await context.request.get(`${urls.api}/phone/verify/status`, { headers })
    ).json()) as { status?: string };
    if (status.status === "verified") {
      // Back to the default (bridge down): a connected bridge makes the phone step mandatory for
      // every account onboarded later in the same test, such as an admin session.
      await bridgeGone(redis);
      return phone.e164;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("phone was not verified in time");
}
