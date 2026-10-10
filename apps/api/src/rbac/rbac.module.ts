import { Global, Module } from "@nestjs/common";

import { RbacRepo } from "./rbac.repo.js";
import { RbacService } from "./rbac.service.js";

@Global()
@Module({ providers: [RbacRepo, RbacService], exports: [RbacService] })
export class RbacModule {}
