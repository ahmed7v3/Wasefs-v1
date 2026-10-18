import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { ALERT_KIND_PERMISSION } from "@wasfa/shared/permissions";

import { OutboxQueue } from "../common/outbox-queue.js";

import { AlertsRepo } from "./alerts.repo.js";

import type { AuthenticatedUser } from "../common/current-user.js";
import type { AlertKind, AlertSeverity } from "@wasfa/shared/billing";

@Injectable()
export class AdminAlertService {
  constructor(
    private readonly repo: AlertsRepo,
    private readonly outbox: OutboxQueue,
  ) {}

  async notify(input: {
    kind: AlertKind;
    severity: AlertSeverity;
    refType: string;
    refId: string;
    summary: string;
    link: string;
  }) {
    const id = await this.repo.createAlert(input);
    await this.outbox.kick(`alert:${id}`);
    return id;
  }

  list(userId: string, limit: number, cursor?: string) {
    return this.repo.list(userId, limit, cursor);
  }
  markRead(userId: string, id: string) {
    return this.repo.markRead(userId, id);
  }
  readAll(userId: string) {
    return this.repo.readAll(userId);
  }
  prefs(userId: string) {
    return this.repo.prefs(userId);
  }
  updatePrefs(userId: string, input: Parameters<AlertsRepo["updatePrefs"]>[1]) {
    return this.repo.updatePrefs(userId, input);
  }

  async resolve(alertId: string, actor: AuthenticatedUser) {
    const [alert] = await this.repo.findAlert(alertId);
    if (!alert) throw new AppError(ErrorCode.NOT_FOUND);
    const required = ALERT_KIND_PERMISSION[alert.kind];
    const elevated = actor.roles.includes("super_admin");
    if (
      (!elevated && !actor.permissions.includes(required)) ||
      (!elevated &&
        !actor.permissions.includes("payments.review") &&
        !actor.permissions.includes("billing.write"))
    ) {
      throw new AppError(ErrorCode.FORBIDDEN);
    }
    await this.repo.resolve(alertId, actor.id);
    return { resolved: true };
  }
}
