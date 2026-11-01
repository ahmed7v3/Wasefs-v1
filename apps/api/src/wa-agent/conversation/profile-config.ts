import type { Locale } from "@wasfa/shared/i18n";
import type { WaAgentSettings } from "@wasfa/shared/settings";
import type { WaAgentProfile } from "@wasfa/shared/wa-agent/session";

/**
 * The admin settings as this chat sees them (docs/WA-AGENT-RUNTIME.md §6, §18.1): the customer's `lang`
 * replaces `language`, and `voice: "off"` stops every voice reply (`replyMode: never`). `voice: "on"` changes
 * nothing: voice then follows the admin's own rules. A chat without a profile gets the settings untouched.
 */
export function withProfile(
  config: WaAgentSettings,
  profile: WaAgentProfile | null | undefined,
): WaAgentSettings {
  if (profile === null || profile === undefined) return config;
  return {
    ...config,
    ...(profile.lang === undefined
      ? {}
      : {
          language:
            profile.lang === "en" ? "en" : config.language === "en" ? "ar_eg" : config.language,
        }),
    ...(profile.voice === "off" ? { voice: { ...config.voice, replyMode: "never" as const } } : {}),
  };
}

/** The language of deterministic texts for this chat. */
export function localeOf(
  config: WaAgentSettings,
  profile: WaAgentProfile | null | undefined,
): Locale {
  return withProfile(config, profile).language === "en" ? "en" : "ar";
}
