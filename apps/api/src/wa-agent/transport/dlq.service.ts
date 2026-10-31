import { Inject, Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { WA_AGENT_DLQ_STREAM } from "@wasfa/shared/schemas/phone";
import { Redis } from "ioredis";

import { REDIS } from "../../common/redis.js";

import type { WaAgentDlqEntry, WaAgentDlqList } from "@wasfa/shared/schemas/wa-agent";

type RawEntry = [string, string[]];

function fieldMap(fields: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (let index = 0; index + 1 < fields.length; index += 2) {
    map.set(fields[index] ?? "", fields[index + 1] ?? "");
  }
  return map;
}

function toEntry([id, fields]: RawEntry): WaAgentDlqEntry {
  const map = fieldMap(fields);
  return {
    id,
    stream: map.get("stream") ?? "",
    entryId: map.get("id") ?? "",
    group: map.get("group") ?? "",
    errorClass: map.get("errorClass") ?? "unknown",
    deliveries: Number(map.get("deliveries") ?? "1"),
    at: map.get("at") ?? new Date(0).toISOString(),
    data: map.get("data") ?? null,
    waMessageId: map.get("waMessageId") ?? null,
    kind: map.get("kind") ?? null,
  };
}

const notFound = () => new AppError(ErrorCode.NOT_FOUND, { details: { reason: "dlq_entry" } });

/**
 * The dead-letter stream `wa:agent:dlq` (docs/WA-AGENT-RUNTIME.md §4.1): entries a stream consumer
 * gave up on, as ids only. An admin lists them, replays one (the source entry is read again and
 * re-added to its stream) or discards it. Reads and removes only; `StreamConsumer` writes.
 */
@Injectable()
export class DlqService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  count(): Promise<number> {
    return this.redis.xlen(WA_AGENT_DLQ_STREAM);
  }

  /** Newest first. */
  async list(limit: number): Promise<WaAgentDlqList> {
    const [total, rows] = await Promise.all([
      this.count(),
      this.redis.xrevrange(WA_AGENT_DLQ_STREAM, "+", "-", "COUNT", limit) as Promise<RawEntry[]>,
    ]);
    return { total, entries: rows.map(toEntry) };
  }

  /**
   * Re-adds the source entry to its stream and drops the dead letter. `gone` when the source entry
   * was trimmed meanwhile (the dead letter stays, to be discarded).
   */
  async replay(dlqId: string): Promise<"replayed" | "gone"> {
    const [row] = (await this.redis.xrange(WA_AGENT_DLQ_STREAM, dlqId, dlqId)) as RawEntry[];
    if (row === undefined) throw notFound();
    const { stream, entryId } = toEntry(row);
    const [source] = (await this.redis.xrange(stream, entryId, entryId)) as RawEntry[];
    if (source === undefined) return "gone";
    await this.redis.xadd(stream, "*", ...source[1]);
    await this.redis.xdel(WA_AGENT_DLQ_STREAM, dlqId);
    return "replayed";
  }

  async discard(dlqId: string): Promise<void> {
    if ((await this.redis.xdel(WA_AGENT_DLQ_STREAM, dlqId)) === 0) throw notFound();
  }
}
