import { Controller, Get, Inject, Res } from "@nestjs/common";
import { buildPublishingGuide } from "@wasfa/shared/publishing-guide";

import { Public } from "../common/auth.guard.js";
import { API_ENV } from "../config/config.module.js";

import { buildOpenApiDocument } from "./publishing-api-openapi.js";

import type { ApiEnv } from "../config/env.js";
import type { FastifyReply } from "fastify";

const CACHE = "public, max-age=300";

/**
 * The two public, key-less documents of the Publishing API: the OpenAPI spec and the agent guide. Both
 * are built once per process (they only depend on the public API origin) and cached 5 minutes downstream.
 */
@Controller("publishing/v1")
export class PublishingApiDocsController {
  private readonly openapi: Record<string, unknown>;
  private readonly guide: string;

  constructor(@Inject(API_ENV) env: ApiEnv) {
    this.openapi = buildOpenApiDocument({ apiBase: env.API_PUBLIC_URL });
    this.guide = buildPublishingGuide({ apiBase: env.API_PUBLIC_URL });
  }

  @Get("openapi.json")
  @Public()
  spec(@Res({ passthrough: true }) reply: FastifyReply): Record<string, unknown> {
    reply.header("cache-control", CACHE);
    return this.openapi;
  }

  @Get("guide")
  @Public()
  instructions(@Res({ passthrough: true }) reply: FastifyReply): string {
    reply.header("cache-control", CACHE).type("text/markdown; charset=utf-8");
    return this.guide;
  }
}
