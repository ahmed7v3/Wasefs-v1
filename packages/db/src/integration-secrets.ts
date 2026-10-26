import { decryptSecret, encryptSecret, maskSecret } from "@wasfa/shared/crypto";
import { eq } from "drizzle-orm";

import { integrationSecrets, type IntegrationSecretKey } from "./schema/integration-secrets.js";

import type { Database } from "./client.js";
import type { Transaction } from "./credits-ledger.js";

type Handle = Database | Transaction;

/*
 * Encrypted third-party keys (docs/WA-AGENT.md section 7). The AAD binds a value to its row, so a
 * ciphertext copied under another key fails to decrypt. The plain value only leaves this module
 * through `getIntegrationSecret`, for server code that calls the integration (never an HTTP route).
 */
const contextOf = (key: IntegrationSecretKey) => `integration_secret:${key}`;

/**
 * The decrypted key, or null when none is stored. `encKey` is the current key first (then old ones
 * during a rotation window). A value that no longer decrypts (changed `ENCRYPTION_KEY`) reads as unset.
 */
export async function getIntegrationSecret(
  db: Handle,
  key: IntegrationSecretKey,
  encKey: Buffer | readonly Buffer[],
): Promise<string | null> {
  const [row] = await db
    .select({ valueEnc: integrationSecrets.valueEnc })
    .from(integrationSecrets)
    .where(eq(integrationSecrets.key, key));
  if (!row) return null;
  try {
    return decryptSecret(row.valueEnc, encKey, contextOf(key));
  } catch {
    return null;
  }
}

/** Whether a key is stored, with its masked hint; never the value. */
export async function getIntegrationSecretMeta(
  db: Handle,
  key: IntegrationSecretKey,
): Promise<{ hint: string; updatedAt: Date } | null> {
  const [row] = await db
    .select({ hint: integrationSecrets.keyHint, updatedAt: integrationSecrets.updatedAt })
    .from(integrationSecrets)
    .where(eq(integrationSecrets.key, key));
  return row ?? null;
}

/** Stores (or replaces) the key, encrypted. Returns the masked hint. */
export async function setIntegrationSecret(
  db: Handle,
  key: IntegrationSecretKey,
  value: string,
  encKey: Buffer,
  actorId: string | null,
): Promise<{ hint: string; updatedAt: Date }> {
  const valueEnc = encryptSecret(value, encKey, contextOf(key));
  const keyHint = maskSecret(value);
  const updatedAt = new Date();
  await db
    .insert(integrationSecrets)
    .values({ key, valueEnc, keyHint, updatedAt, updatedBy: actorId })
    .onConflictDoUpdate({
      target: integrationSecrets.key,
      set: { valueEnc, keyHint, updatedAt, updatedBy: actorId },
    });
  return { hint: keyHint, updatedAt };
}

/** True when a key was stored and is now gone. */
export async function clearIntegrationSecret(
  db: Handle,
  key: IntegrationSecretKey,
): Promise<boolean> {
  const rows = await db
    .delete(integrationSecrets)
    .where(eq(integrationSecrets.key, key))
    .returning({ key: integrationSecrets.key });
  return rows.length > 0;
}
