import { type ModelProfile, UNKNOWN_MODEL_PROFILE, findModelProfile } from "@/features/domain";
import type { Message } from "@/features/domain";

/** Rough character-to-token ratio for estimation. */
const DEFAULT_CHARS_PER_TOKEN = 4;

const ANTHROPIC_CHARS_PER_TOKEN = 3.5;

const MESSAGE_OVERHEAD_TOKENS = 4;

/**
 * Estimate token count for a single string.
 *
 * @param text - Text value.
 * @param charsPerToken - Chars per token value.
 * @returns The `estimateTokens` result.
 * @example
 * ```ts
 * const result = estimateTokens(text, charsPerToken);
 * ```
 */
export const estimateTokens = (text: string, charsPerToken = DEFAULT_CHARS_PER_TOKEN): number => {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / charsPerToken);
};

/** Running context counter that tracks usage against a limit. */
export class ContextCounter {
  private total = 0;
  private profile: ModelProfile;

  constructor(
    private limit: number,
    modelName?: string,
  ) {
    this.profile = modelName ? findModelProfile(modelName) : UNKNOWN_MODEL_PROFILE;
    if (modelName) this.limit = this.profile.contextWindow;
  }

  get contextLimit(): number {
    return this.limit;
  }

  get modelLabel(): string {
    return this.profile.label;
  }

  get modelProfile(): ModelProfile {
    return this.profile;
  }

  /**
   * Add one message's estimated tokens to the running total.
   *
   * @param message - Message value.
   * @returns Completes when `add` finishes.
   * @example
   * ```ts
   * counter.add(message);
   * ```
   */
  add(message: Message): void {
    this.total += MESSAGE_OVERHEAD_TOKENS + this.estimateForProvider(message.content);
    for (const tc of message.toolCalls ?? []) {
      this.total +=
        MESSAGE_OVERHEAD_TOKENS + this.estimateForProvider(JSON.stringify(tc.arguments));
    }
  }

  get count(): number {
    return this.total;
  }

  get fraction(): number {
    return this.total / this.limit;
  }

  get summary(): string {
    const pct = (this.fraction * 100).toFixed(1);
    return `~${this.total.toLocaleString()} / ${this.limit.toLocaleString()} (${pct}%)`;
  }

  get isNearLimit(): boolean {
    return this.fraction > 0.8;
  }

  /**
   * Clear the running token total.
   *
   * @returns Completes when `reset` finishes.
   * @example
   * ```ts
   * counter.reset();
   * ```
   */
  reset(): void {
    this.total = 0;
  }

  /**
   * Replace the context window limit used for fraction/summary.
   *
   * @param limit - Limit value.
   * @returns Completes when `setLimit` finishes.
   * @example
   * ```ts
   * counter.setLimit(limit);
   * ```
   */
  setLimit(limit: number): void {
    this.limit = limit;
  }

  /**
   * Switch the model profile and adopt its context window.
   *
   * @param modelName - Model name value.
   * @returns Completes when `setModel` finishes.
   * @example
   * ```ts
   * counter.setModel(modelName);
   * ```
   */
  setModel(modelName: string): void {
    this.profile = findModelProfile(modelName);
    this.limit = this.profile.contextWindow;
  }

  private estimateForProvider(text: string): number {
    const charsPerToken =
      this.profile.provider === "anthropic" ? ANTHROPIC_CHARS_PER_TOKEN : DEFAULT_CHARS_PER_TOKEN;
    return estimateTokens(text, charsPerToken);
  }
}
