import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { recordLearningVote, recordUnmatchedNames } from "../src/drug-signals.js";
import {
  drugAliases,
  drugLearned,
  drugLearningVotes,
  drugUnmatchedNames,
  drugs,
  users,
} from "../src/schema/index.js";

import { startTestDb, type TestDb } from "./db-fixture.js";

let fixture: TestDb;
let drugId = "";
const userIds: string[] = [];

beforeAll(async () => {
  fixture = await startTestDb();
  const { db } = fixture.handle;
  const [drug] = await db
    .insert(drugs)
    .values({ brandEn: "Dostinex", normalizedEn: "dostinex", brandKey: "dostinex" })
    .returning({ id: drugs.id });
  drugId = drug?.id ?? "";
  for (let i = 0; i < 4; i++) {
    const [user] = await db
      .insert(users)
      .values({ name: `Voter ${i}`, email: `voter${i}@example.com` })
      .returning({ id: users.id });
    userIds.push(user?.id ?? "");
  }
}, 180_000);

afterAll(async () => {
  await fixture?.stop();
});

describe("recordUnmatchedNames", () => {
  it("inserts a new reading, counts a repeat and leaves the admin's status alone", async () => {
    const { db } = fixture.handle;
    await recordUnmatchedNames(db, [
      { normalized: "zorbex", sample: "Zorbex" },
      { normalized: "zorbex", sample: "Zorbex again" },
      { normalized: "ab", sample: "ab" },
      { normalized: "", sample: "" },
    ]);
    await db
      .update(drugUnmatchedNames)
      .set({ status: "ignored" })
      .where(eq(drugUnmatchedNames.normalized, "zorbex"));
    await recordUnmatchedNames(db, [{ normalized: "zorbex", sample: "x".repeat(200) }]);

    const rows = await db.select().from(drugUnmatchedNames);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      normalized: "zorbex",
      sample: "Zorbex",
      hits: 2,
      status: "ignored",
    });
  });

  it("clips the sample to 80 characters", async () => {
    const { db } = fixture.handle;
    await recordUnmatchedNames(db, [{ normalized: "longname", sample: "y".repeat(200) }]);
    const [row] = await db
      .select()
      .from(drugUnmatchedNames)
      .where(eq(drugUnmatchedNames.normalized, "longname"));
    expect(row?.sample).toHaveLength(80);
  });
});

describe("recordLearningVote", () => {
  const vote = (index: number, over: Partial<{ normalized: string; autoApproveAt: number }> = {}) =>
    recordLearningVote(fixture.handle.db, {
      normalized: "dostenix",
      drugId,
      userId: userIds[index] ?? "",
      autoApproveAt: 3,
      ...over,
    });

  it("counts distinct users and promotes the alias at the threshold", async () => {
    const { db } = fixture.handle;
    expect(await vote(0)).toEqual({ recorded: true, votes: 1, promoted: false });
    expect(await vote(0)).toEqual({ recorded: true, votes: 1, promoted: false });
    expect(await vote(1)).toEqual({ recorded: true, votes: 2, promoted: false });
    expect(await vote(2)).toEqual({ recorded: true, votes: 3, promoted: true });

    const [pair] = await db
      .select()
      .from(drugLearned)
      .where(and(eq(drugLearned.normalized, "dostenix"), eq(drugLearned.drugId, drugId)));
    expect(pair).toMatchObject({ votes: 3, status: "approved", decidedBy: null });
    const aliases = await db.select().from(drugAliases).where(eq(drugAliases.drugId, drugId));
    expect(aliases).toMatchObject([{ normalized: "dostenix", source: "learned" }]);
  });

  it("does not promote again once approved", async () => {
    expect((await vote(3)).promoted).toBe(false);
    const votes = await fixture.handle.db.select().from(drugLearningVotes);
    expect(votes).toHaveLength(4);
  });

  it("never auto-approves a rejected pair or with auto-approval off", async () => {
    const { db } = fixture.handle;
    await vote(0, { normalized: "dostanex", autoApproveAt: 0 });
    await vote(1, { normalized: "dostanex", autoApproveAt: 0 });
    expect((await vote(2, { normalized: "dostanex", autoApproveAt: 0 })).promoted).toBe(false);

    await db
      .update(drugLearned)
      .set({ status: "rejected" })
      .where(eq(drugLearned.normalized, "dostanex"));
    expect((await vote(3, { normalized: "dostanex", autoApproveAt: 1 })).promoted).toBe(false);
    const [pair] = await db
      .select()
      .from(drugLearned)
      .where(eq(drugLearned.normalized, "dostanex"));
    expect(pair).toMatchObject({ votes: 4, status: "rejected" });
  });

  it("skips an empty reading and the drug's own name", async () => {
    expect((await vote(0, { normalized: "  " })).recorded).toBe(false);
    expect((await vote(0, { normalized: "Dostinex" })).recorded).toBe(false);
  });
});
