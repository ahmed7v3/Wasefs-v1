import { Injectable, type ArgumentMetadata, type PipeTransform } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { ZodType, type z } from "zod";

export interface ZodDto<T extends ZodType = ZodType> {
  new (): z.output<T>;
  readonly schema: T;
}

/**
 * Wraps a shared zod schema so it can be used as a parameter type:
 * `class CreatePostDto extends createZodDto(createPostSchema) {}`.
 * Use `z.object` (not `z.looseObject`) so unknown keys are stripped.
 */
export function createZodDto<T extends ZodType>(schema: T): ZodDto<T> {
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class -- the class is only a carrier for `schema` that Nest exposes as `metatype`
  class ZodDtoClass {
    static readonly schema = schema;
  }
  return ZodDtoClass as unknown as ZodDto<T>;
}

function schemaOf(metatype: ArgumentMetadata["metatype"]): ZodType | undefined {
  const candidate = (metatype as { schema?: unknown } | undefined)?.schema;
  return candidate instanceof ZodType ? candidate : undefined;
}

/**
 * Parses `value` with a shared schema. Failures become `VALIDATION_FAILED` with field paths only;
 * submitted values are never echoed back (they may be secrets or PII).
 */
export function parseWithSchema<T extends ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (result.success) {
    return result.data;
  }
  const fields = [...new Set(result.error.issues.map((issue) => issue.path.join(".") || "(root)"))];
  throw new AppError(ErrorCode.VALIDATION_FAILED, { details: { fields } });
}

/** Global pipe: parses any `createZodDto` parameter with `parseWithSchema`. */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    const schema = schemaOf(metadata.metatype);
    return schema ? parseWithSchema(schema, value) : value;
  }
}
