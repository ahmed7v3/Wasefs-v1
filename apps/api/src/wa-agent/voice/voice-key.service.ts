import { Inject, Injectable } from "@nestjs/common";

import { API_ENV } from "../../config/config.module.js";
import { encryptionKey, type ApiEnv } from "../../config/env.js";
import { WaAgentRepo } from "../conversation/conversation.repo.js";

const TTL_MS = 60_000;

/**
 * The ElevenLabs key for server calls (docs/WA-AGENT.md section 7). Read from the encrypted store and
 * kept in memory for a minute so a voice turn does not hit the database twice. The admin routes call
 * `invalidate()` when the key is set or cleared; another api instance picks the change up at the TTL.
 * The value is only ever handed to the ElevenLabs client: never logged, never returned over HTTP.
 */
@Injectable()
export class VoiceKeyService {
  private cached: { value: string | null; at: number } | undefined;
  /** Replaced by tests. */
  now: () => number = () => Date.now();

  constructor(
    private readonly repo: WaAgentRepo,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async get(): Promise<string | null> {
    const at = this.now();
    if (this.cached && at - this.cached.at < TTL_MS) return this.cached.value;
    const value = await this.repo.elevenLabsKey(encryptionKey(this.env));
    this.cached = { value, at };
    return value;
  }

  async isSet(): Promise<boolean> {
    return (await this.get()) !== null;
  }

  invalidate(): void {
    this.cached = undefined;
  }
}
