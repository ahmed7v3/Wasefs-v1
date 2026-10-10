import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { createDb } from "@wasfa/db";

import { API_ENV } from "../config/config.module.js";

import type { ApiEnv } from "../config/env.js";

export const DB = Symbol("DB");

export type DbHandle = ReturnType<typeof createDb>;

class DatabaseShutdown implements OnApplicationShutdown {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async onApplicationShutdown(): Promise<void> {
    await this.handle.close();
  }
}

/** Pooled Drizzle client. Inject `DB` and use `.db` for queries. */
@Global()
@Module({
  providers: [
    {
      provide: DB,
      inject: [API_ENV],
      useFactory: (env: ApiEnv): DbHandle =>
        createDb({ url: env.DATABASE_URL, max: 10, connectTimeoutSeconds: 5 }),
    },
    DatabaseShutdown,
  ],
  exports: [DB],
})
export class DatabaseModule {}
