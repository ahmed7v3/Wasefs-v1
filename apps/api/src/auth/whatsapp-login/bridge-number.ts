import type { ApiEnv } from "../../config/env.js";
import type { SettingsService } from "../../settings/settings.service.js";

/**
 * The number people send their messages to: the admin's setting first, `WHATSAPP_NUMBER` as the
 * fallback. Digits with country code, no `+` (what `wa.me` takes). Shared by phone verification and
 * "Continue with WhatsApp", which talk to the same bridge.
 */
export async function resolveBridgeNumber(
  settings: Pick<SettingsService, "get">,
  env: Pick<ApiEnv, "WHATSAPP_NUMBER">,
): Promise<{ digits: string; source: "setting" | "env" } | undefined> {
  const configured = (await settings.get("whatsapp")).number;
  if (configured !== null) return { digits: configured.replace(/^\+/, ""), source: "setting" };
  return env.WHATSAPP_NUMBER === undefined
    ? undefined
    : { digits: env.WHATSAPP_NUMBER, source: "env" };
}
