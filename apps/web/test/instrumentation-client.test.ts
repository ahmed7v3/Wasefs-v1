import { describe, expect, it } from "vitest";

describe("instrumentation-client", () => {
  it("turns zod's JIT compiler off through its global config, before zod is loaded", async () => {
    await import("../src/instrumentation-client");
    const { config } = await import("zod/v4/core");
    // Zod's own view of its config: the object the file wrote into.
    expect(config().jitless).toBe(true);
  });
});
