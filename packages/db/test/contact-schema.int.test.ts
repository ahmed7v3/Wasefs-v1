import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { contactMessages, users } from "../src/schema/index.js";

import { startTestDb, violatedConstraint, type TestDb } from "./db-fixture.js";

let fixture: TestDb;

beforeAll(async () => {
  fixture = await startTestDb();
}, 180_000);

afterAll(async () => {
  await fixture?.stop();
});

const valid = {
  name: "Visitor",
  email: "visitor@example.com",
  topic: "general",
  message: "Hello, I have a question.",
} satisfies typeof contactMessages.$inferInsert;

async function insert(overrides: Partial<typeof contactMessages.$inferInsert> = {}) {
  const [row] = await fixture.handle.db
    .insert(contactMessages)
    .values({ ...valid, ...overrides })
    .returning();
  if (!row) throw new Error("insert returned no row");
  return row;
}

/** Runs a statement that must be rejected and returns the name of the constraint that rejected it. */
async function rejection(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
  } catch (error) {
    return violatedConstraint(error);
  }
  throw new Error("expected the database to reject the statement");
}

describe("contact_messages", () => {
  it("stores a message with safe defaults", async () => {
    const row = await insert();
    expect(row).toMatchObject({
      status: "new",
      locale: "ar",
      userId: null,
      phone: null,
      email: "visitor@example.com",
    });
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it("accepts a phone alone", async () => {
    const row = await insert({ email: null, phone: "+201001234567" });
    expect(row.email).toBeNull();
  });

  it("requires at least one way to reach the sender", async () => {
    expect(await rejection(() => insert({ email: null, phone: null }))).toBe(
      "contact_messages_contact_check",
    );
  });

  it("rejects a phone that is not E.164", async () => {
    expect(await rejection(() => insert({ phone: "01001234567" }))).toBe(
      "contact_messages_phone_format_check",
    );
  });

  it("rejects an unknown topic, status and locale", async () => {
    expect(await rejection(() => insert({ topic: "spam" as never }))).toBe(
      "contact_messages_topic_check",
    );
    expect(await rejection(() => insert({ status: "deleted" as never }))).toBe(
      "contact_messages_status_check",
    );
    expect(await rejection(() => insert({ locale: "fr" as never }))).toBe(
      "contact_messages_locale_check",
    );
  });

  it("rejects an empty or oversized message", async () => {
    expect(await rejection(() => insert({ message: "" }))).toBe(
      "contact_messages_message_length_check",
    );
    expect(await rejection(() => insert({ message: "x".repeat(4001) }))).toBe(
      "contact_messages_message_length_check",
    );
    await expect(insert({ message: "x".repeat(4000) })).resolves.toBeDefined();
  });

  it("keeps the message when its sender's user row is removed", async () => {
    const [user] = await fixture.handle.db
      .insert(users)
      .values({ name: "Sender", email: "sender@example.com" })
      .returning();
    if (!user) throw new Error("insert returned no row");
    const row = await insert({ userId: user.id });
    expect(row.userId).toBe(user.id);

    await fixture.handle.db.delete(users).where(eq(users.id, user.id));
    const [kept] = await fixture.handle.db
      .select()
      .from(contactMessages)
      .where(eq(contactMessages.id, row.id));
    expect(kept).toMatchObject({ id: row.id, userId: null });
  });
});
