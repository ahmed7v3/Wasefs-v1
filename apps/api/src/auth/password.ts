import { hash, verify } from "@node-rs/argon2";

export interface PasswordHasher {
  hash: (password: string) => Promise<string>;
  verify: (input: { hash: string; password: string }) => Promise<boolean>;
  /**
   * A valid hash of a random password, made with the same parameters. Verifying against it when the
   * account does not exist keeps "unknown user" and "wrong password" equally slow.
   */
  dummyHash: () => Promise<string>;
}

/**
 * Argon2id (the library default algorithm) with the OWASP minimum: 19 MiB, 2 passes, 1 lane.
 * `memoryKib` is tunable by env; the parameters are stored in each hash, so changing it never
 * invalidates existing passwords.
 */
export function createPasswordHasher(memoryKib: number): PasswordHasher {
  const options = { memoryCost: memoryKib, timeCost: 2, parallelism: 1 } as const;
  let dummy: Promise<string> | undefined;
  return {
    hash: (password) => hash(password, options),
    verify: async ({ hash: stored, password }) => {
      try {
        return await verify(stored, password);
      } catch {
        // A malformed or foreign hash is a failed login, not a server error.
        return false;
      }
    },
    dummyHash: () => (dummy ??= hash(`dummy:${Math.random()}:${Date.now()}`, options)),
  };
}
