import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import { tap, type Observable } from "rxjs";

import { InvalidationBus } from "../common/invalidation-bus.js";

import { CATALOG_INVALIDATION_TOPIC } from "./catalog.service.js";

import type { FastifyRequest } from "fastify";

const WRITE_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Admin writes that change what `/catalog` shows (prices, plans, promotions, coupons, methods, tax
 * rules, packs) drop the cached catalog on every instance. The publish runs after the handler
 * resolved, so the transaction has already committed and the next catalog read sees the change.
 */
@Injectable()
export class CatalogInvalidationInterceptor implements NestInterceptor {
  constructor(private readonly bus: InvalidationBus) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (!WRITE_METHODS.has(request.method)) return next.handle();
    return next.handle().pipe(
      tap(() => {
        void this.bus.publish(CATALOG_INVALIDATION_TOPIC, request.method);
      }),
    );
  }
}
