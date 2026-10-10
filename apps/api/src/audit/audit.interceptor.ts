import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { concatMap, from, type Observable } from "rxjs";

import { AuditService } from "./audit.service.js";
import { AUDITED_KEY, type AuditedOptions } from "./audited.decorator.js";

import type { FastifyRequest } from "fastify";

/**
 * Records `@Audited` routes after they succeeded. The audit row is written before the response is
 * sent and a failure to write it fails the request (loudly, with a `WSF-` ref): an admin change
 * without its audit row must not look like it went fine. Handlers that change several rows in one
 * transaction can call `AuditService.record` themselves instead, inside that transaction.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.getAllAndOverride<AuditedOptions | undefined>(AUDITED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!options || context.getType() !== "http") return next.handle();

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    return next.handle().pipe(
      concatMap((result: unknown) =>
        from(
          (async () => {
            const scope = request.auditScope ?? {};
            const params = request.params as Record<string, string | undefined> | undefined;
            const targetId = scope.targetId ?? params?.[options.targetParam ?? "id"];
            const after = scope.after ?? (options.afterFromResponse === true ? result : undefined);
            await this.audit.recordFor(
              request,
              {
                action: options.action,
                targetType: options.targetType,
                targetId: targetId ?? null,
                before: scope.before,
                after,
              },
              options.fields ? { fields: options.fields } : {},
            );
            return result;
          })(),
        ),
      ),
    );
  }
}
