import type { NormalizedRequest, Router, RouterInput } from "@wasfa/ai";
import type { z } from "zod";

/** A step failed for a reason of ours (bad model output, no answer). The code is safe to log; never any content. */
export class RxStepError extends Error {
  constructor(
    readonly code: "invalid_model_output" | "no_answer" | "budget_exceeded" | "image_missing",
  ) {
    super(`rx step failed: ${code}`);
    this.name = "RxStepError";
  }
}

export interface ModelCall<T> {
  value: T;
  /** Provider cost of every attempt, repair included (integer USD micros). */
  costUsdMicros: number;
  /** `ai_usage.id` of the first answering attempt: the row credits are stamped on. */
  usageId: string | null;
  routeVersion: number;
  /** Calls made to the router (2 when the answer needed a repair). */
  calls: number;
}

type CallInput = Omit<RouterInput, "request" | "attemptTimeoutMs">;

/** The model sometimes wraps JSON in a code fence even when told not to. */
function unfence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  return fenced?.[1] ?? trimmed;
}

/** Field paths and issue codes only: the repair message must not echo values back (they are the patient's). */
function describeFailure(error: z.ZodError | "not_json"): string {
  if (error === "not_json") return "the answer was not valid JSON";
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.code}`)
    .join("; ");
}

async function collect(
  router: Router,
  input: RouterInput,
  signal: AbortSignal,
): Promise<{ text: string; costUsdMicros: number; usageId: string | null; routeVersion: number }> {
  let text = "";
  let result;
  for await (const event of router.run(input, signal)) {
    if (event.type === "text") text += event.text;
    else if (event.type === "result") result = event.result;
  }
  if (signal.aborted) throw new RxStepError("budget_exceeded");
  if (result?.outcome !== "ok") throw new RxStepError("no_answer");
  return {
    text,
    costUsdMicros: result.totalCostUsdMicros,
    usageId: result.usageId,
    routeVersion: result.routeVersion,
  };
}

/**
 * One structured call: ask, validate with the zod schema, and when the answer does not validate
 * make ONE repair call on the same route (the validation error goes back to the model, paths and
 * codes only). Refusals (`ai_paused`, no route) and provider errors propagate untouched.
 */
export async function callJson<T>(args: {
  router: Router;
  input: CallInput;
  request: Omit<NormalizedRequest, "model">;
  schema: z.ZodType<T>;
  signal: AbortSignal;
  attemptTimeoutMs: number;
}): Promise<ModelCall<T>> {
  const { router, input, request, schema, signal, attemptTimeoutMs } = args;
  const first = await collect(router, { ...input, request, attemptTimeoutMs }, signal);

  const parse = (text: string): { ok: true; value: T } | { ok: false; why: string } => {
    let json: unknown;
    try {
      json = JSON.parse(unfence(text));
    } catch {
      return { ok: false, why: describeFailure("not_json") };
    }
    const parsed = schema.safeParse(json);
    return parsed.success
      ? { ok: true, value: parsed.data }
      : { ok: false, why: describeFailure(parsed.error) };
  };

  const firstParse = parse(first.text);
  if (firstParse.ok) {
    return { value: firstParse.value, ...pick(first), calls: 1 };
  }

  const repair: Omit<NormalizedRequest, "model"> = {
    ...request,
    messages: [
      ...request.messages,
      { role: "assistant", parts: [{ type: "text", text: first.text }] },
      {
        role: "user",
        parts: [
          {
            type: "text",
            text: `Your previous answer failed validation (${firstParse.why}). Return only the corrected JSON, matching the schema exactly.`,
          },
        ],
      },
    ],
  };
  const second = await collect(router, { ...input, request: repair, attemptTimeoutMs }, signal);
  const secondParse = parse(second.text);
  if (!secondParse.ok) throw new RxStepError("invalid_model_output");
  return {
    value: secondParse.value,
    costUsdMicros: first.costUsdMicros + second.costUsdMicros,
    usageId: first.usageId,
    routeVersion: first.routeVersion,
    calls: 2,
  };
}

function pick(call: { costUsdMicros: number; usageId: string | null; routeVersion: number }) {
  return {
    costUsdMicros: call.costUsdMicros,
    usageId: call.usageId,
    routeVersion: call.routeVersion,
  };
}
