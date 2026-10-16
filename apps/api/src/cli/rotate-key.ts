import { aiProviders, paymentGateways, waSessions } from "@wasfa/db";
import { decryptSecret, encryptSecret, keyId } from "@wasfa/shared/crypto";
import { gatewayCredentialsContext } from "@wasfa/shared/gateways";
import { and, eq } from "drizzle-orm";

import { providerKeyContext } from "../ai-runtime/provider-key.js";

import type { Database } from "@wasfa/db";

export interface RotateResult {
  providers: number;
  gateways: number;
  waSessions: number;
  /** Rows left untouched because they were already sealed with the new key. */
  alreadyCurrent: number;
}

class DryRunDone extends Error {}

/**
 * Re-seals every stored secret under `newKey`. One transaction: a row that opens with neither key
 * aborts the whole run and nothing changes. With `dryRun` the work is done and rolled back, so the
 * operator sees the counts (and any undecryptable row) before touching production.
 */
export async function rotateEncryptionKey(
  db: Database,
  oldKey: Buffer,
  newKey: Buffer,
  { dryRun = false }: { dryRun?: boolean } = {},
): Promise<RotateResult> {
  const keys = [newKey, oldKey];
  const newPrefix = `v2.${keyId(newKey)}.`;
  const result: RotateResult = { providers: 0, gateways: 0, waSessions: 0, alreadyCurrent: 0 };

  try {
    await db.transaction(async (tx) => {
      for (const row of await tx.select().from(aiProviders)) {
        if (row.apiKeyEnc === null) continue;
        if (row.apiKeyEnc.startsWith(newPrefix)) {
          result.alreadyCurrent += 1;
          continue;
        }
        const context = providerKeyContext(row.key);
        const plain = decryptSecret(row.apiKeyEnc, keys, context);
        await tx
          .update(aiProviders)
          .set({ apiKeyEnc: encryptSecret(plain, newKey, context) })
          .where(eq(aiProviders.id, row.id));
        result.providers += 1;
      }

      for (const row of await tx.select().from(paymentGateways)) {
        if (row.credentialsEnc === null) continue;
        if (row.credentialsEnc.startsWith(newPrefix)) {
          result.alreadyCurrent += 1;
          continue;
        }
        const context = gatewayCredentialsContext(row.key);
        const plain = decryptSecret(row.credentialsEnc, keys, context);
        await tx
          .update(paymentGateways)
          .set({ credentialsEnc: encryptSecret(plain, newKey, context) })
          .where(eq(paymentGateways.id, row.id));
        result.gateways += 1;
      }

      for (const row of await tx.select().from(waSessions)) {
        if (row.value.startsWith(newPrefix)) {
          result.alreadyCurrent += 1;
          continue;
        }
        const context = `wa_session:${row.session}:${row.key}`;
        const plain = decryptSecret(row.value, keys, context);
        await tx
          .update(waSessions)
          .set({ value: encryptSecret(plain, newKey, context) })
          .where(and(eq(waSessions.session, row.session), eq(waSessions.key, row.key)));
        result.waSessions += 1;
      }
      if (dryRun) throw new DryRunDone();
    });
  } catch (error) {
    if (!(error instanceof DryRunDone)) throw error;
  }
  return result;
}
