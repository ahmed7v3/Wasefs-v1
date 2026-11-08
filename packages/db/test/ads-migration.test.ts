import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  AD_PLACEMENT_CATALOG,
  AD_WHATSAPP_TRIGGERS,
  whatsappPlacementKey,
} from "@wasfa/shared/ads";
import { describe, expect, it } from "vitest";

const migrations = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), "utf8");

/** Production's last applied migration when the ads migration was written (Drizzle skips older `when`s). */
const PRODUCTION_LAST_APPLIED_WHEN = 1_793_797_623_734;

describe("ads migration", () => {
  it("is journaled after production's last applied migration", () => {
    const journal = JSON.parse(migrations("meta/_journal.json")) as {
      entries: { tag: string; when: number }[];
    };
    const entry = journal.entries.find((candidate) => candidate.tag === "0033_ads");
    expect(entry).toBeDefined();
    expect(entry?.when).toBeGreaterThan(PRODUCTION_LAST_APPLIED_WHEN);
  });

  it("keeps journal timestamps strictly increasing", () => {
    const journal = JSON.parse(migrations("meta/_journal.json")) as { entries: { when: number }[] };
    const whens = journal.entries.map((entry) => entry.when);
    expect(whens).toEqual([...whens].sort((a, b) => a - b));
  });

  it("journals the ads opt-out migration after 0033_ads and adds the flag and the WhatsApp stats keys", () => {
    const journal = JSON.parse(migrations("meta/_journal.json")) as {
      entries: { tag: string; when: number }[];
    };
    const ads = journal.entries.find((candidate) => candidate.tag === "0033_ads");
    const optOut = journal.entries.find((candidate) => candidate.tag === "0034_ads_opt_out");
    expect(optOut?.when).toBeGreaterThan(ads?.when ?? Number.POSITIVE_INFINITY);
    const sql = migrations("0034_ads_opt_out.sql");
    expect(sql).toContain('"ads_opt_out" boolean DEFAULT false NOT NULL');
    for (const trigger of AD_WHATSAPP_TRIGGERS) {
      expect(sql).toContain(`'${whatsappPlacementKey(trigger)}'`);
    }
  });

  it("seeds exactly the catalog, every placement disabled by default", () => {
    const sql = migrations("0033_ads.sql");
    const seeded = [...sql.matchAll(/^\t\('([a-z0-9_.]+)', ARRAY/gm)].map((match) => match[1]);
    expect(seeded.sort()).toEqual(AD_PLACEMENT_CATALOG.map((entry) => entry.key).sort());
    expect(sql).toContain('"enabled" boolean DEFAULT false NOT NULL');
    expect(sql).not.toMatch(/INSERT INTO "ad_placements" \([^)]*"enabled"/);
  });

  it("gives creatives the channel and WhatsApp text columns and stats a channel in the key", () => {
    const sql = migrations("0033_ads.sql");
    expect(sql).toContain(`"channels" text[] DEFAULT '{web}'::text[] NOT NULL`);
    expect(sql).toContain('"wa_text" text');
    expect(sql).toContain('PRIMARY KEY("creative_id","placement_key","day","channel")');
  });
});
