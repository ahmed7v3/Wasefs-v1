import { describe, expect, it, vi } from "vitest";

// `server-only` throws outside a server build; bot-report is server code by design.
vi.mock("server-only", () => ({}));

import { botHitFor } from "../src/lib/bot-report";
import { classifyBot } from "../src/lib/bots";

describe("classifyBot", () => {
  it.each([
    [
      "Mozilla/5.0 AppleWebKit/537.36; compatible; GPTBot/1.2; +https://openai.com/gptbot",
      "gptbot",
    ],
    ["Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)", "oai-searchbot"],
    [
      "Mozilla/5.0 AppleWebKit/537.36 (compatible; ChatGPT-User/1.0; +https://openai.com/bot)",
      "chatgpt-user",
    ],
    ["Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)", "claudebot"],
    ["Mozilla/5.0 (compatible; Claude-User/1.0)", "claude-user"],
    [
      "Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
      "perplexitybot",
    ],
    ["Mozilla/5.0 (compatible; Perplexity-User/1.0)", "perplexity-user"],
    ["Google-Extended", "google-extended"],
    ["Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "googlebot"],
    ["Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)", "bingbot"],
    [
      "Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)",
      "applebot",
    ],
    ["CCBot/2.0 (https://commoncrawl.org/faq/)", "ccbot"],
    [
      "Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)",
      "bytespider",
    ],
    [
      "meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)",
      "meta-externalagent",
    ],
    ["Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)", "other-bot"],
    ["SomeSpider/2.0", "other-bot"],
    ["Mozilla/5.0 (compatible; MyCrawler/1)", "other-bot"],
  ])("%s", (agent, expected) => {
    expect(classifyBot(agent)).toBe(expected);
  });

  it("leaves browsers and missing headers uncounted", () => {
    expect(
      classifyBot(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
      ),
    ).toBeNull();
    expect(classifyBot("")).toBeNull();
    expect(classifyBot(null)).toBeNull();
  });
});

describe("botHitFor", () => {
  const GPT = "GPTBot/1.2";

  it("reports a crawler's page request as class + route template", () => {
    expect(botHitFor("GET", "/pricing", GPT)).toEqual({ bot: "gptbot", route: "/pricing" });
    expect(botHitFor("GET", "/blog/some-post", GPT)).toEqual({
      bot: "gptbot",
      route: "/blog/[rest]",
    });
  });

  it("skips humans, assets, internals, the API and private trees", () => {
    expect(botHitFor("GET", "/pricing", "Mozilla/5.0 Chrome/126")).toBeNull();
    expect(botHitFor("GET", "/_next/data/x.json", GPT)).toBeNull();
    expect(botHitFor("GET", "/logo.png", GPT)).toBeNull();
    expect(botHitFor("GET", "/api/health", GPT)).toBeNull();
    expect(botHitFor("GET", "/admin", GPT)).toBeNull();
    expect(botHitFor("POST", "/pricing", GPT)).toBeNull();
  });
});
