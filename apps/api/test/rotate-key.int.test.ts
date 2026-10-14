import { randomBytes } from "node:crypto";

import { aiProviders, createDb, seedDefaults, waSessions } from "@wasfa/db";
import { decryptSecret, encryptSecret, keyId, sealedKeyId } from "@wasfa/shared/crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { providerKeyContext } from "../src/ai-runtime/provider-key.js";
import { rotateEncryptionKey } from "../src/cli/rotate-key.js";

import { startInfra, type TestInfra } from "./support/infra.js";

let infra: TestInfra;
let owner: ReturnType<typeof createDb>;
const oldKey = randomBytes(32);
const newKey = randomBytes(32);

beforeAll(async () => {
  infra = await startInfra();
  owner = createDb({ url: infra.databaseUrl, max: 2 });
  await seedDefaults(owner.db);
}, 180_000);

afterAll(async () => {
  await owner?.close();
  await infra?.stop();
});

const providerRow = async (key: string) =>
  (await owner.db.select().from(aiProviders).where(eq(aiProviders.key, key)))[0];

describe("rotateEncryptionKey", () => {
  it("dry run changes nothing; the real run re-seals everything under the new key", async () => {
    const ctx = providerKeyContext("gemini");
    await owner.db
      .update(aiProviders)
      .set({ apiKeyEnc: encryptSecret("provider-secret", oldKey, ctx) })
      .where(eq(aiProviders.key, "gemini"));
    await owner.db.insert(waSessions).values({
      session: "t",
      key: "creds",
      value: encryptSecret("{}", oldKey, "wa_session:t:creds"),
    });

    const before = await providerRow("gemini");
    const dry = await rotateEncryptionKey(owner.db, oldKey, newKey, { dryRun: true });
    expect(dry).toMatchObject({ providers: 1, waSessions: 1 });
    expect((await providerRow("gemini"))?.apiKeyEnc).toBe(before?.apiKeyEnc);

    const real = await rotateEncryptionKey(owner.db, oldKey, newKey);
    expect(real).toMatchObject({ providers: 1, waSessions: 1 });
    const sealed = (await providerRow("gemini"))?.apiKeyEnc ?? "";
    expect(sealedKeyId(sealed)).toBe(keyId(newKey));
    expect(decryptSecret(sealed, newKey, ctx)).toBe("provider-secret");
    expect(() => decryptSecret(sealed, oldKey, ctx)).toThrow();

    const again = await rotateEncryptionKey(owner.db, oldKey, newKey);
    expect(again).toMatchObject({ providers: 0, waSessions: 0 });
    expect(again.alreadyCurrent).toBeGreaterThanOrEqual(2);
  });

  it("aborts without changing anything when a value opens with neither key", async () => {
    await owner.db
      .update(aiProviders)
      .set({ apiKeyEnc: encryptSecret("x", randomBytes(32), providerKeyContext("openrouter")) })
      .where(eq(aiProviders.key, "openrouter"));
    const snapshot = await owner.db.select().from(aiProviders);
    await expect(rotateEncryptionKey(owner.db, oldKey, randomBytes(32))).rejects.toThrow();
    expect(await owner.db.select().from(aiProviders)).toEqual(snapshot);
  });
});
