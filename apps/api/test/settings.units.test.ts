import { settingDefault } from "@wasfa/shared/settings";
import { describe, expect, it, vi } from "vitest";

import { SettingsService } from "../src/settings/settings.service.js";

import type { AuditService } from "../src/audit/audit.service.js";
import type { InvalidationBus } from "../src/common/invalidation-bus.js";
import type { SettingsRepo } from "../src/settings/settings.repo.js";
import type { Redis } from "ioredis";
import type { PinoLogger } from "nestjs-pino";

function build(stored: unknown) {
  const down = () => Promise.reject(new Error("Redis is down"));
  const redis = { get: vi.fn(down), set: vi.fn(down), del: vi.fn(down) };
  const repo = {
    find: vi.fn(() => Promise.resolve(stored === undefined ? undefined : { value: stored })),
    upsert: vi.fn(() => Promise.resolve()),
  };
  const bus = { on: vi.fn(), publish: vi.fn(() => Promise.resolve()) };
  const audit = { record: vi.fn(() => Promise.resolve()), recordFor: vi.fn() };
  const logger = { setContext: vi.fn(), warn: vi.fn() };
  const service = new SettingsService(
    redis as unknown as Redis,
    repo as unknown as SettingsRepo,
    audit as unknown as AuditService,
    bus as unknown as InvalidationBus,
    logger as unknown as PinoLogger,
  );
  return { service, redis, repo, bus, audit, logger };
}

describe("SettingsService when Redis is down", () => {
  it("reads from the database", async () => {
    const { service, repo, logger } = build({ monthlyAnalyses: 5 });
    expect(await service.get("free_tier")).toEqual({ monthlyAnalyses: 5 });
    expect(repo.find).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalled();
    // The in-process layer still works: no second database read.
    await service.get("free_tier");
    expect(repo.find).toHaveBeenCalledTimes(1);
  });

  it("still writes, audits and publishes", async () => {
    const { service, repo, bus, audit } = build({ monthlyAnalyses: 5 });
    expect(await service.set("free_tier", { monthlyAnalyses: 6 }, { actorId: null })).toEqual({
      monthlyAnalyses: 6,
    });
    expect(repo.upsert).toHaveBeenCalledWith("free_tier", { monthlyAnalyses: 6 }, null);
    expect(bus.publish).toHaveBeenCalledWith("settings:invalidate", "free_tier");
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "setting.update",
        targetId: "free_tier",
        before: { monthlyAnalyses: 5 },
        after: { monthlyAnalyses: 6 },
      }),
    );
  });

  it("uses the default for a missing or invalid stored value, logging only the key", async () => {
    const missing = build(undefined);
    expect(await missing.service.get("free_tier")).toEqual(settingDefault("free_tier"));

    const corrupt = build({ monthlyAnalyses: "secret-looking-text" });
    expect(await corrupt.service.get("free_tier")).toEqual(settingDefault("free_tier"));
    expect(JSON.stringify(corrupt.logger.warn.mock.calls)).not.toContain("secret-looking-text");
    expect(corrupt.logger.warn).toHaveBeenCalledWith({ key: "free_tier" }, expect.any(String));
  });

  it("drops its in-process copy when told another instance changed the key", async () => {
    const { service, repo, bus } = build({ monthlyAnalyses: 5 });
    await service.get("free_tier");
    const [, handler] = bus.on.mock.calls[0] as unknown as [string, (message: string) => void];
    handler("free_tier");
    await service.get("free_tier");
    expect(repo.find).toHaveBeenCalledTimes(2);
  });
});
