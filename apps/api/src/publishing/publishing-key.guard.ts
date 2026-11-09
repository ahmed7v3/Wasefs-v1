import { Injectable } from "@nestjs/common";

import type { CanActivate } from "@nestjs/common";

/** STUB: the key-auth builder replaces this with the real guard (see PublishingPrincipal). */
@Injectable()
export class PublishingKeyGuard implements CanActivate {
  canActivate(): boolean {
    throw new Error("PublishingKeyGuard is not implemented yet");
  }
}
