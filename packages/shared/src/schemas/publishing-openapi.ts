import { z } from "zod";

const jsonSchemaValue = z.unknown();
const mediaTypeSchema = z.looseObject({ schema: jsonSchemaValue.optional() });
const parameterSchema = z.looseObject({
  name: z.string().min(1),
  in: z.enum(["path", "query", "header", "cookie"]),
  required: z.boolean().optional(),
  description: z.string().optional(),
  schema: jsonSchemaValue.optional(),
});
const responseSchema = z.looseObject({
  description: z.string().optional(),
  content: z.record(z.string(), mediaTypeSchema).optional(),
});

const operationSchema = z.looseObject({
  summary: z.string().min(1),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  security: z.array(z.record(z.string(), z.array(z.string()))).optional(),
  "x-required-scope": z.string().min(1).optional(),
  parameters: z.array(parameterSchema).optional(),
  requestBody: z
    .looseObject({
      required: z.boolean().optional(),
      content: z.record(z.string(), mediaTypeSchema),
    })
    .optional(),
  responses: z.record(z.string(), responseSchema).refine((responses) => Object.keys(responses).length > 0),
});

const pathItemSchema = z.looseObject({
  get: operationSchema.optional(),
  put: operationSchema.optional(),
  post: operationSchema.optional(),
  delete: operationSchema.optional(),
  options: operationSchema.optional(),
  head: operationSchema.optional(),
  patch: operationSchema.optional(),
  trace: operationSchema.optional(),
});

/** Public OpenAPI response shape needed by the admin reference; additive spec fields remain accepted. */
export const publishingOpenApiSchema = z.looseObject({
  openapi: z.string().regex(/^3\.1\.\d+$/),
  info: z.looseObject({
    title: z.string().min(1),
    version: z.string().min(1),
    description: z.string().optional(),
  }),
  servers: z.array(z.looseObject({ url: z.url() })).min(1),
  paths: z.record(z.string().startsWith("/"), pathItemSchema),
});

export type PublishingOpenApiDocument = z.output<typeof publishingOpenApiSchema>;
export type PublishingOpenApiOperation = z.output<typeof operationSchema>;
