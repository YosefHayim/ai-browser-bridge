/** Context for {@link remainingTimeout}. */
export interface RemainingTimeoutContext {
  /** Timestamp when the wait started. */
  startedAt: number;
  /** Total timeout budget in milliseconds. */
  timeout: number;
}

/** Compute remaining timeout budget, never below one second. */
export function remainingTimeout(ctx: RemainingTimeoutContext): number {
  return Math.max(1_000, ctx.timeout - (Date.now() - ctx.startedAt));
}
