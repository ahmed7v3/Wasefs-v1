import { Injectable, Inject } from "@nestjs/common";

import { clientIp, compileTrust, type TrustFn } from "../common/client-ip.js";
import { API_ENV } from "../config/config.module.js";

import { sanitizeAuditValue, type SanitizeOptions } from "./audit-redact.js";
import { AuditRepo } from "./audit.repo.js";

import type { ApiEnv } from "../config/env.js";
import type { FastifyRequest } from "fastify";

export interface AuditEntry {
  /** The admin who acted; null for the system (bootstrap CLI, workers). */
  actorId: string | null;
  /** Dotted verb, e.g. `user.suspend`, `role.grant`, `setting.update`. */
  action: string;
  targetType: string;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

export interface RecordOptions {
  /** Per-entity allowlist of top-level fields kept in `before`/`after`. */
  fields?: readonly string[];
  /**
   * Store `before`/`after` as given, without the redactor. Only for values that are ids and members
   * of closed sets: the redactor reads a run of digits inside a UUID as a phone number and would
   * mangle it. A caller with free text in the value must scrub it first.
   */
  verbatim?: boolean;
}

const MAX_USER_AGENT = 300;

/**
 * Appends to the audit trail. `before` and `after` always pass through `sanitizeAuditValue`, so
 * callers hand over what changed and the redaction rules (SECURITY.md section 7) apply regardless.
 */
@Injectable()
export class AuditService {
  private readonly trust: TrustFn;

  constructor(
    private readonly repo: AuditRepo,
    @Inject(API_ENV) env: ApiEnv,
  ) {
    this.trust = compileTrust(env.TRUST_PROXY);
  }

  async record(entry: AuditEntry, options: RecordOptions = {}): Promise<void> {
    const sanitize: SanitizeOptions = options.fields ? { fields: options.fields } : {};
    await this.repo.insert({
      actorId: entry.actorId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      before: options.verbatim
        ? (entry.before ?? null)
        : entry.before === undefined
          ? null
          : sanitizeAuditValue(entry.before, sanitize),
      after: options.verbatim
        ? (entry.after ?? null)
        : entry.after === undefined
          ? null
          : sanitizeAuditValue(entry.after, sanitize),
      ip: entry.ip ?? null,
      userAgent: entry.userAgent?.slice(0, MAX_USER_AGENT) ?? null,
    });
  }

  /** Same, with IP and user agent taken from the request, and the actor from it unless given (public routes). */
  recordFor(
    request: FastifyRequest,
    entry: Omit<AuditEntry, "actorId" | "ip" | "userAgent"> & { actorId?: string | null },
    options: RecordOptions = {},
  ): Promise<void> {
    const agent = request.headers["user-agent"];
    return this.record(
      {
        ...entry,
        actorId: entry.actorId ?? request.authUser?.id ?? null,
        ip: clientIp(request, this.trust),
        userAgent: typeof agent === "string" ? agent : null,
      },
      options,
    );
  }
}
