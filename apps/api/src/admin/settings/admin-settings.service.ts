import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import {
  SETTINGS_REGISTRY,
  SETTING_KEYS,
  isSettingKey,
  type SettingKey,
} from "@wasfa/shared/settings";

import { SettingsService } from "../../settings/settings.service.js";

import { AdminSettingsRepo, type SettingMeta } from "./admin-settings.repo.js";

import type { AdminSetting } from "@wasfa/shared/schemas/admin";
import type { FastifyRequest } from "fastify";

@Injectable()
export class AdminSettingsService {
  constructor(
    private readonly settings: SettingsService,
    private readonly repo: AdminSettingsRepo,
  ) {}

  /** Every registry key with its effective value (the stored one or the code default). */
  async list(): Promise<{ items: AdminSetting[] }> {
    const meta = await this.repo.meta();
    const items = await Promise.all(SETTING_KEYS.map((key) => this.item(key, meta.get(key))));
    return { items };
  }

  /**
   * Validates against the registry schema (field paths on failure), stores, clears every cache and
   * writes the `setting.update` audit row: all inside `SettingsService.set`, so it is not audited twice.
   */
  async put(
    actorId: string,
    request: FastifyRequest,
    key: string,
    value: unknown,
  ): Promise<AdminSetting> {
    if (!isSettingKey(key)) throw new AppError(ErrorCode.NOT_FOUND);
    await this.settings.set(key, value, { actorId, request });
    return this.item(key, (await this.repo.meta()).get(key));
  }

  private async item(key: SettingKey, meta: SettingMeta | undefined): Promise<AdminSetting> {
    return {
      key,
      visibility: SETTINGS_REGISTRY[key].visibility,
      value: await this.settings.get(key),
      updatedAt: meta?.updatedAt.toISOString() ?? null,
      updatedBy: meta?.updatedBy ?? null,
    };
  }
}
