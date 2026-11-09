import { z } from "zod";

/**
 * A PATCH schema from a create schema: every field optional and WITHOUT its default. Zod 4 applies a
 * default inside `.partial()` too, so `{ name: "x" }` would otherwise come back with every other field
 * reset to its default and silently overwrite the stored row.
 */
export function patchSchemaOf<S extends z.ZodObject>(schema: S): z.ZodType<Partial<z.input<S>>> {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(schema.shape)) {
    const plain = field instanceof z.ZodDefault ? field.unwrap() : field;
    shape[key] = (plain as z.ZodType).optional();
  }
  return z.object(shape) as unknown as z.ZodType<Partial<z.input<S>>>;
}
