import { settingDefault } from "@wasfa/shared/settings";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { indexNowJob } from "../src/jobs/seo.indexnow.job.js";
import { readSetting } from "../src/settings.js";

import type { Database } from "@wasfa/db";

vi.mock("../src/settings.js", () => ({ readSetting: vi.fn() }));

const logger = { info: vi.fn(), warn: vi.fn() };
const context = {
  db: {} as Database,
  logger: logger as never,
  env: { WEB_ORIGIN: "https://wasfa.online" } as never,
};

const seo = (indexNow: { enabled: boolean; key: string | null }) => {
  vi.mocked(readSetting).mockResolvedValue({ ...settingDefault("seo"), indexNow } as never);
};

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  logger.info.mockReset();
  logger.warn.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("seo.indexnow", () => {
  it("skips while IndexNow is disabled or has no key", async () => {
    seo({ enabled: false, key: "abcdef0123456789" });
    await indexNowJob({ urls: ["https://wasfa.online/ar"] }, context);
    seo({ enabled: true, key: null });
    await indexNowJob({ urls: ["https://wasfa.online/ar"] }, context);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the URLs with the host, key and key file location", async () => {
    seo({ enabled: true, key: "abcdef0123456789" });
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
    await indexNowJob(
      { urls: ["https://wasfa.online/ar/a", "https://wasfa.online/ar/b"] },
      context,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(url).toBe("https://api.indexnow.org/indexnow");
    expect(JSON.parse(init.body)).toEqual({
      host: "wasfa.online",
      key: "abcdef0123456789",
      keyLocation: "https://wasfa.online/indexnow.txt",
      urlList: ["https://wasfa.online/ar/a", "https://wasfa.online/ar/b"],
    });
  });

  it("throws on 429 and 5xx so BullMQ retries", async () => {
    seo({ enabled: true, key: "abcdef0123456789" });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 429 }));
    await expect(indexNowJob({ urls: ["https://wasfa.online/ar"] }, context)).rejects.toThrow(
      "429",
    );
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(indexNowJob({ urls: ["https://wasfa.online/ar"] }, context)).rejects.toThrow(
      "503",
    );
  });

  it("does not retry other 4xx answers", async () => {
    seo({ enabled: true, key: "abcdef0123456789" });
    fetchMock.mockResolvedValue(new Response(null, { status: 403 }));
    await expect(
      indexNowJob({ urls: ["https://wasfa.online/ar"] }, context),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("sends only URLs on the site host", async () => {
    seo({ enabled: true, key: "abcdef0123456789" });
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    await indexNowJob({ urls: ["https://wasfa.online/ar", "https://evil.example/ar"] }, context);
    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(init.body).urlList).toEqual(["https://wasfa.online/ar"]);

    fetchMock.mockClear();
    await indexNowJob({ urls: ["https://evil.example/ar"] }, context);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
