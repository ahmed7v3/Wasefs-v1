import { AiProviderError } from "../types.js";

/**
 * Ends an async iteration as soon as `signal` aborts, with a retryable "timeout" error.
 * Transports do not all tear a hanging body down on abort (SDKs, test interceptors), so a stalled
 * `next()` is raced against the signal; the source is closed in the background.
 */
export async function* abortable<T>(
  source: AsyncIterable<T>,
  signal: AbortSignal,
): AsyncGenerator<T> {
  const iterator = source[Symbol.asyncIterator]();
  const aborted = Symbol("aborted");
  let onAbort: (() => void) | undefined;
  const abortPromise = new Promise<typeof aborted>((resolve) => {
    if (signal.aborted) resolve(aborted);
    else {
      onAbort = () => resolve(aborted);
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });

  try {
    for (;;) {
      const next = iterator.next();
      // The losing promise may reject later (abort tears the transport down); that is expected.
      next.catch(() => undefined);
      const result = await Promise.race([next, abortPromise]);
      if (result === aborted) {
        void Promise.resolve(iterator.return?.()).catch(() => undefined);
        throw new AiProviderError("timeout");
      }
      if (result.done) return;
      yield result.value;
    }
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}
