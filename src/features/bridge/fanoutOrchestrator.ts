/** Outcome of asking one provider within a fan-out. */
export interface ProviderAskOutcome {
  ok: boolean;
  reply?: string;
  error?: string;
  elapsedMs: number;
}

/** Fan-out result keyed by provider id. */
export type FanoutResult = Record<string, ProviderAskOutcome>;

/** Options for {@link fanoutAsk}. */
export interface FanoutOptions {
  /** Per-provider timeout in ms (default 300000). */
  timeoutMs?: number;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

const withTimeout = <T>(promise: Promise<T>, ms: number, provider: string): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${provider} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
};

/**
 * Ask one prompt across many providers concurrently. Never rejects — each provider's
 * outcome (reply, or error + elapsed) is captured independently, so one slow or failed
 * provider never blocks or fails the rest.
 *
 * @param providers - Providers value.
 * @param runOne - Run one value.
 * @param options - Options that configure the operation.
 * @returns The `fanoutAsk` result.
 * @example
 * ```ts
 * const result = await fanoutAsk(providers, runOne, options);
 * ```
 */
export const fanoutAsk = async (
  providers: string[],
  runOne: (provider: string) => Promise<string>,
  options: FanoutOptions = {},
): Promise<FanoutResult> => {
  const timeoutMs = options.timeoutMs ?? 300_000;
  const clock = options.now ?? (() => Date.now());
  const outcomes = await Promise.all(
    providers.map(async (provider): Promise<readonly [string, ProviderAskOutcome]> => {
      const start = clock();
      try {
        const reply = await withTimeout(runOne(provider), timeoutMs, provider);
        return [provider, { ok: true, reply, elapsedMs: clock() - start }];
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        return [provider, { ok: false, error, elapsedMs: clock() - start }];
      }
    }),
  );
  return Object.fromEntries(outcomes);
};

/**
 * Whether the run should exit non-zero: all providers failed, or (strict) any failed.
 *
 * @param result - Result value.
 * @param strict - Strict value.
 * @returns The `fanoutFailed` result.
 * @example
 * ```ts
 * const result = fanoutFailed(result, strict);
 * ```
 */
export const fanoutFailed = (result: FanoutResult, strict: boolean): boolean => {
  const outcomes = Object.values(result);
  if (outcomes.length === 0) return true;
  return strict ? outcomes.some((o) => !o.ok) : outcomes.every((o) => !o.ok);
};
