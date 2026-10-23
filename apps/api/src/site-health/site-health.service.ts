import { Inject, Injectable } from "@nestjs/common";
import {
  BOT_CLASSES,
  WEB_VITAL_BUCKETS,
  WEB_VITAL_NAMES,
  type BotClass,
  type BotHits,
  type SiteHealth,
  type WebVitalName,
  type WebVitalsBeacon,
} from "@wasfa/shared/schemas/public-site";

import { REDIS } from "../common/redis.js";

import { bucketIndex, lastDays, p75, utcDay } from "./site-health.math.js";

import type { Redis } from "ioredis";

/** Daily counters expire after 90 days; the TTL is refreshed on every write (cheap, one command). */
const TTL_SECONDS = 90 * 86_400;
const VITALS_KEY = "site:vitals:";
const BOTS_KEY = "site:bots:";

/**
 * First-party field data and crawler visibility as daily Redis hashes. Nothing here identifies a
 * visitor: fields are route template + metric + bucket, or bot class + route template.
 */
@Injectable()
export class SiteHealthService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async recordVitals(beacon: WebVitalsBeacon, now = new Date()): Promise<void> {
    const key = `${VITALS_KEY}${utcDay(now)}`;
    const pipeline = this.redis.multi();
    for (const metric of beacon.metrics) {
      const bucket = bucketIndex(metric.name, metric.value);
      pipeline.hincrby(key, `${metric.route}|${metric.name}|${bucket}`, 1);
    }
    pipeline.expire(key, TTL_SECONDS);
    await pipeline.exec();
  }

  async recordBotHits(body: BotHits, now = new Date()): Promise<void> {
    const key = `${BOTS_KEY}${utcDay(now)}`;
    const pipeline = this.redis.multi();
    for (const hit of body.hits) pipeline.hincrby(key, `${hit.bot}|${hit.route}`, 1);
    pipeline.expire(key, TTL_SECONDS);
    await pipeline.exec();
  }

  async read(days: number, now = new Date()): Promise<SiteHealth> {
    const dayKeys = lastDays(now, days);
    const pipeline = this.redis.pipeline();
    for (const day of dayKeys) {
      pipeline.hgetall(`${VITALS_KEY}${day}`);
      pipeline.hgetall(`${BOTS_KEY}${day}`);
    }
    const results = (await pipeline.exec()) ?? [];

    // route|metric -> counts per bucket; bot|route -> hits. Even positions are vitals, odd are bots.
    const histograms = new Map<string, { route: string; name: WebVitalName; counts: number[] }>();
    const bots = new Map<string, { bot: BotClass; route: string; hits: number }>();
    results.forEach(([error, value], position) => {
      if (error !== null || value === null || typeof value !== "object") return;
      for (const [field, raw] of Object.entries(value as Record<string, string>)) {
        const count = Number(raw);
        const parts = field.split("|");
        if (position % 2 === 0) {
          const [route, name, bucket] = parts;
          const metric = WEB_VITAL_NAMES.find((candidate) => candidate === name);
          const index = Number(bucket);
          if (route === undefined || metric === undefined) continue;
          const size = WEB_VITAL_BUCKETS[metric].length + 1;
          if (!Number.isInteger(index) || index < 0 || index >= size) continue;
          const id = `${route}|${metric}`;
          const entry = histograms.get(id) ?? {
            route,
            name: metric,
            counts: new Array<number>(size).fill(0),
          };
          entry.counts[index] = (entry.counts[index] ?? 0) + count;
          histograms.set(id, entry);
        } else {
          const [name, route] = parts;
          const bot = BOT_CLASSES.find((candidate) => candidate === name);
          if (bot === undefined || route === undefined) continue;
          const id = `${bot}|${route}`;
          const entry = bots.get(id) ?? { bot, route, hits: 0 };
          entry.hits += count;
          bots.set(id, entry);
        }
      }
    });

    return {
      days,
      vitals: [...histograms.values()]
        .map(({ route, name, counts }) => ({
          route,
          name,
          samples: counts.reduce((sum, count) => sum + count, 0),
          p75: p75(name, counts),
        }))
        .sort((a, b) => a.route.localeCompare(b.route) || a.name.localeCompare(b.name)),
      bots: [...bots.values()].sort((a, b) => b.hits - a.hits),
    };
  }
}
