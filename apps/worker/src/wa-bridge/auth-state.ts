import { waSessions, type Database } from "@wasfa/db";
import { decryptSecret, encryptSecret } from "@wasfa/shared/crypto";
import {
  BufferJSON,
  initAuthCreds,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataSet,
  type SignalDataTypeMap,
} from "@whiskeysockets/baileys";
import { and, eq, inArray } from "drizzle-orm";

const CREDS_KEY = "creds";

export interface PostgresAuthState {
  state: AuthenticationState;
  /** Persist the credentials; Baileys calls the `creds.update` listener for every change. */
  saveCreds: () => Promise<void>;
  /** True when this session was linked before (credentials existed in the database). */
  existed: boolean;
}

/**
 * Baileys auth state kept in Postgres instead of on disk (the container is read-only and must
 * survive restarts without re-pairing). Every value is AES-256-GCM encrypted, with the session and
 * key bound as AAD, so a dump of `wa_sessions` cannot act as the linked phone and a row moved to
 * another key fails to decrypt.
 *
 * A row that cannot be decrypted is an error, never "start from scratch": silently minting new
 * credentials would force a re-pair, which is exactly what the bridge must not do on its own.
 */
export async function usePostgresAuthState(
  db: Database,
  key: Buffer,
  session = "default",
): Promise<PostgresAuthState> {
  const context = (rowKey: string) => `wa_session:${session}:${rowKey}`;
  const seal = (rowKey: string, value: unknown) =>
    encryptSecret(JSON.stringify(value, BufferJSON.replacer), key, context(rowKey));
  const open = (rowKey: string, sealed: string): unknown =>
    JSON.parse(decryptSecret(sealed, key, context(rowKey)), BufferJSON.reviver);

  const upsert = async (rowKey: string, value: unknown, executor: Database = db) => {
    const sealed = seal(rowKey, value);
    await executor
      .insert(waSessions)
      .values({ session, key: rowKey, value: sealed })
      .onConflictDoUpdate({
        target: [waSessions.session, waSessions.key],
        set: { value: sealed, updatedAt: new Date() },
      });
  };

  const [credsRow] = await db
    .select({ value: waSessions.value })
    .from(waSessions)
    .where(and(eq(waSessions.session, session), eq(waSessions.key, CREDS_KEY)));
  const creds = credsRow
    ? (open(CREDS_KEY, credsRow.value) as AuthenticationCreds)
    : initAuthCreds();

  const state: AuthenticationState = {
    creds,
    keys: {
      get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
        const result: Record<string, SignalDataTypeMap[T]> = {};
        if (ids.length === 0) return result;
        const rows = await db
          .select({ key: waSessions.key, value: waSessions.value })
          .from(waSessions)
          .where(
            and(
              eq(waSessions.session, session),
              inArray(
                waSessions.key,
                ids.map((id) => `${type}:${id}`),
              ),
            ),
          );
        for (const row of rows) {
          let value = open(row.key, row.value) as SignalDataTypeMap[T];
          if (type === "app-state-sync-key") {
            value = proto.Message.AppStateSyncKeyData.create(
              value as proto.Message.IAppStateSyncKeyData,
            ) as unknown as SignalDataTypeMap[T];
          }
          result[row.key.slice(type.length + 1)] = value;
        }
        return result;
      },
      set: async (data: SignalDataSet) => {
        await db.transaction(async (tx) => {
          for (const [type, entries] of Object.entries(data)) {
            for (const [id, value] of Object.entries(entries ?? {})) {
              const rowKey = `${type}:${id}`;
              if (value === null || value === undefined) {
                await tx
                  .delete(waSessions)
                  .where(and(eq(waSessions.session, session), eq(waSessions.key, rowKey)));
              } else {
                await upsert(rowKey, value, tx as unknown as Database);
              }
            }
          }
        });
      },
    },
  };

  return {
    state,
    saveCreds: () => upsert(CREDS_KEY, state.creds),
    existed: credsRow !== undefined,
  };
}

/** Forget a linked session (after `loggedOut`, or before linking another number). */
export async function clearSession(db: Database, session = "default"): Promise<number> {
  const removed = await db
    .delete(waSessions)
    .where(eq(waSessions.session, session))
    .returning({ key: waSessions.key });
  return removed.length;
}
