import { Inject, Injectable } from "@nestjs/common";
import { enabledGateway, paymentGateways } from "@wasfa/db";
import { decryptSecret } from "@wasfa/shared/crypto";
import {
  FAKE_GATEWAY_DEV_SECRET,
  createFakeGateway,
  gatewayCredentialsContext,
  gatewayFromConfig,
  type FakeGateway,
  type PaymentGateway,
} from "@wasfa/shared/gateways";
import { eq } from "drizzle-orm";

import { DB, type DbHandle } from "../common/database.js";
import { API_ENV } from "../config/config.module.js";
import { encryptionKey, type ApiEnv } from "../config/env.js";

/** How long a built adapter is reused before the row (mode, keys, enabled) is read again. */
const CACHE_MS = 60_000;

/**
 * Payment gateway adapters by key. Credentials live sealed in `payment_gateways` (Decision 15) and
 * are opened only here, in memory, for the call. The fake gateway exists outside production only.
 */
@Injectable()
export class GatewayRegistry {
  /** Scripted provider for tests and E2E; `null` in production. */
  readonly fake: FakeGateway | null;
  private readonly cache = new Map<string, { gateway: PaymentGateway | null; until: number }>();

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(DB) private readonly handle: DbHandle,
  ) {
    this.fake = env.NODE_ENV === "production" ? null : createFakeGateway(FAKE_GATEWAY_DEV_SECRET);
  }

  /** The adapter for `key`, or null when it is unknown, disabled or misconfigured. */
  async get(key: string): Promise<PaymentGateway | null> {
    if (key === "fake") return this.fake;
    const cached = this.cache.get(key);
    if (cached && cached.until > Date.now()) return cached.gateway;
    const row = await enabledGateway(this.handle.db, key);
    const gateway = this.build(row);
    this.cache.set(key, { gateway, until: Date.now() + CACHE_MS });
    return gateway;
  }

  /** Builds an adapter for admin verification, including disabled gateways. Never cached. */
  async forAdmin(key: string): Promise<PaymentGateway | null> {
    if (key === "fake") return this.fake;
    const [row] = await this.handle.db
      .select()
      .from(paymentGateways)
      .where(eq(paymentGateways.key, key));
    return this.build(row);
  }

  private build(row: Awaited<ReturnType<typeof enabledGateway>>): PaymentGateway | null {
    let gateway: PaymentGateway | null = null;
    if (row?.credentialsEnc) {
      try {
        gateway = gatewayFromConfig({
          provider: row.provider,
          mode: row.mode,
          credentials: decryptSecret(
            row.credentialsEnc,
            encryptionKey(this.env),
            gatewayCredentialsContext(row.key),
          ),
        });
      } catch {
        // A row sealed with another key is the same as "not configured"; the admin test shows why.
        gateway = null;
      }
    }
    return gateway;
  }

  /** Forget cached adapters (admin changed a gateway row). */
  invalidate(): void {
    this.cache.clear();
  }
}
