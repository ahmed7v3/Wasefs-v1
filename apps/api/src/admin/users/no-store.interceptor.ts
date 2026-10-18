import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";

import type { FastifyReply } from "fastify";
import type { Observable } from "rxjs";

/** Health data and revealed contact details are never cached by the browser or a proxy. */
@Injectable()
export class NoStoreInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() === "http") {
      context.switchToHttp().getResponse<FastifyReply>().header("Cache-Control", "no-store");
    }
    return next.handle();
  }
}
