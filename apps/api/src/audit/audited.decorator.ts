import { SetMetadata, createParamDecorator, type ExecutionContext } from "@nestjs/common";

import type { FastifyRequest } from "fastify";

export const AUDITED_KEY = "wasfa:audited";

export interface AuditedOptions {
  /** Dotted verb stored as `audit_logs.action`, e.g. `user.suspend`. */
  action: string;
  /** What kind of thing the route changes (`user`, `role`, `setting`). */
  targetType: string;
  /** Route parameter holding the target id; default `id`. */
  targetParam?: string;
  /** Allowlist of top-level fields kept from `before`/`after`. */
  fields?: readonly string[];
  /** Record the handler's return value as `after` when the handler did not set one itself. */
  afterFromResponse?: boolean;
}

/**
 * Marks an admin write. `AuditInterceptor` records it after the handler succeeded: actor, IP and
 * user agent from the request, the target from the route, `before`/`after` from what the handler put
 * in the `AuditCtx` parameter (or its return value with `afterFromResponse`).
 */
export const Audited = (options: AuditedOptions) => SetMetadata(AUDITED_KEY, options);

/** What a handler tells the interceptor about the change it made. */
export interface AuditScope {
  targetId?: string;
  before?: unknown;
  after?: unknown;
}

declare module "fastify" {
  interface FastifyRequest {
    auditScope?: AuditScope;
  }
}

/** `@AuditCtx() audit: AuditScope` gives the handler the object to fill with `before`/`after`/`targetId`. */
export const AuditCtx = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<FastifyRequest>();
  request.auditScope ??= {};
  return request.auditScope;
});
