import { randomBytes } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import {
  HANDOFF_MAX_FILES,
  type CreateHandoffResponse,
  type HandoffStatusResponse,
  type HandoffUploadInput,
} from "@wasfa/shared/schemas/handoff";

import { AuthRateLimiter } from "../auth/rate-limiter.js";
import { API_ENV } from "../config/config.module.js";

import { FilesService } from "./files.service.js";
import { HandoffHub } from "./handoff.hub.js";
import { handoffChannel, HandoffStore, tokenHash, type HandoffRecord } from "./handoff.store.js";

import type { FileViewer } from "./files.repo.js";
import type { ApiEnv } from "../config/env.js";
import type { CompleteUploadResponse, CreateUploadResponse } from "@wasfa/shared/schemas/files";

const TOKEN_BYTES = 32;

/**
 * Desktop to phone handoff (Task 2.6). A token is a capability: whoever holds it may add up to
 * four pages to one capture session of one user, for five minutes, and nothing else. It is not a
 * session, so it opens no other route; in particular it cannot start an analysis, which means a
 * leaked link cannot spend credits. Files created through it belong to the token's user and take
 * the same path as any upload (type, size and checksum signed into the PUT, the 30 per 10 minutes
 * limit of that user).
 */
@Injectable()
export class HandoffService {
  constructor(
    private readonly store: HandoffStore,
    private readonly hub: HandoffHub,
    private readonly files: FilesService,
    private readonly limiter: AuthRateLimiter,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  /** A new token for the caller's capture session. `origin` is the page the request came from. */
  async create(
    userId: string,
    captureSessionId: string,
    origin: string | undefined,
  ): Promise<CreateHandoffResponse> {
    await this.limiter.hit(`handoff:create:${userId}`, 10, 600);
    // A session id someone else already uses looks like any unknown one.
    if (!(await this.store.claimSession(captureSessionId, userId))) {
      throw new AppError(ErrorCode.NOT_FOUND);
    }
    const token = randomBytes(TOKEN_BYTES).toString("base64url");
    const expiresAt = await this.store.create(token, userId, captureSessionId);
    return {
      token,
      url: `${this.webOrigin(origin)}/capture/${token}`,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /** The phone page asks before showing the camera: is the link alive, and how many pages are left? */
  async status(token: string): Promise<HandoffStatusResponse> {
    const record = await this.require(token);
    return {
      remaining: Math.max(0, HANDOFF_MAX_FILES - record.count),
      expiresAt: record.expiresAt.toISOString(),
    };
  }

  async createUpload(token: string, input: HandoffUploadInput): Promise<CreateUploadResponse> {
    const record = await this.require(token);
    await this.limiter.hit(`handoff:token:${tokenHash(token).slice(0, 32)}`, 30, 300);
    await this.store.reserve(token);
    try {
      const created = await this.files.createUpload(viewerOf(record), input);
      await this.store.addFile(token, created.fileId);
      return created;
    } catch (error) {
      await this.store.release(token);
      throw error;
    }
  }

  async completeUpload(token: string, fileId: string): Promise<CompleteUploadResponse> {
    const record = await this.require(token);
    await this.limiter.hit(`handoff:token:${tokenHash(token).slice(0, 32)}`, 30, 300);
    // Only files this very token created: the id alone is not enough to touch a file.
    if (!(await this.store.hasFile(token, fileId))) throw new AppError(ErrorCode.NOT_FOUND);
    const result = await this.files.completeUpload(viewerOf(record), fileId);
    await this.store.publish(record.captureSessionId, JSON.stringify({ fileId }));
    return result;
  }

  /**
   * Opens the live feed of one capture session for its owner. `send` receives the raw event JSON.
   * Returns the function that closes the feed.
   */
  async subscribe(
    userId: string,
    captureSessionId: string,
    send: (message: string) => void,
  ): Promise<() => void> {
    await this.limiter.hit(`handoff:events:${userId}`, 30, 600);
    // Not the owner, or a session nobody opened: the same 404, so ids cannot be probed.
    if ((await this.store.sessionOwner(captureSessionId)) !== userId) {
      throw new AppError(ErrorCode.NOT_FOUND);
    }
    await this.store.claimSession(captureSessionId, userId);
    return this.hub.listen(handoffChannel(captureSessionId), send);
  }

  private async require(token: string): Promise<HandoffRecord> {
    const record = await this.store.find(token);
    if (!record) throw new AppError(ErrorCode.NOT_FOUND);
    return record;
  }

  /** The page's own origin when the browser sent an allowed one, else the first configured. */
  private webOrigin(origin: string | undefined): string {
    if (origin !== undefined && this.env.WEB_ORIGIN.includes(origin)) return origin;
    const [first] = this.env.WEB_ORIGIN;
    if (!first) throw new Error("WEB_ORIGIN must list at least one origin");
    return first;
  }
}

/** The token's user, as far as `FilesService` is concerned. Organizations never take part. */
function viewerOf(record: HandoffRecord): FileViewer {
  return { id: record.userId, orgIds: [] };
}
