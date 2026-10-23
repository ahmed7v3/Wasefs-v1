import type { BotClass } from "@wasfa/shared/schemas/public-site";

/*
 * Crawler classification for the bot-hit counters (phase4 WP1 §5.8). Ordered: the first match wins,
 * so a specific token must come before the shorter one it contains (`oai-searchbot` before
 * `gptbot`, `googlebot` is distinct from `google-extended`). Only the class is ever stored.
 */
const BOT_TABLE: readonly (readonly [BotClass, RegExp])[] = [
  ["oai-searchbot", /oai-searchbot/i],
  ["chatgpt-user", /chatgpt-user/i],
  ["gptbot", /gptbot/i],
  ["claude-user", /claude-user/i],
  ["claudebot", /claudebot/i],
  ["perplexity-user", /perplexity-user/i],
  ["perplexitybot", /perplexitybot/i],
  // A robots.txt token rather than a user agent: kept as a class, but it rarely matches.
  ["google-extended", /google-extended/i],
  ["googlebot", /googlebot/i],
  ["bingbot", /bingbot/i],
  ["applebot", /applebot/i],
  ["ccbot", /ccbot/i],
  ["bytespider", /bytespider/i],
  ["meta-externalagent", /meta-externalagent/i],
];

const GENERIC_BOT = /bot|crawler|spider/i;

/** The bot class of a `User-Agent` header, or `null` for a browser (and for a missing header). */
export function classifyBot(userAgent: string | null | undefined): BotClass | null {
  if (!userAgent) return null;
  for (const [bot, pattern] of BOT_TABLE) {
    if (pattern.test(userAgent)) return bot;
  }
  return GENERIC_BOT.test(userAgent) ? "other-bot" : null;
}
