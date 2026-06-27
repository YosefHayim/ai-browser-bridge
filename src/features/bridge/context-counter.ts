import type { Message } from "../domain/types.ts";
import { findModelProfile, UNKNOWN_MODEL_PROFILE, type ModelProfile } from "../domain/models.config.ts";

/** Rough character-to-token ratio for estimation. */
const DEFAULT_CHARS_PER_TOKEN = 4;
const ANTHROPIC_CHARS_PER_TOKEN = 3.5;
const MESSAGE_OVERHEAD_TOKENS = 4;

/** Estimate token count for a single string. */
export function estimateTokens(text: string, charsPerToken = DEFAULT_CHARS_PER_TOKEN): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / charsPerToken);
}

/** Running context counter that tracks usage against a limit. */
export class ContextCounter {
  private total = 0;
  private profile: ModelProfile;

  constructor(private limit: number, modelName?: string) {
    this.profile = modelName ? findModelProfile(modelName) : UNKNOWN_MODEL_PROFILE;
    if (modelName) this.limit = this.profile.contextWindow;
  }

  /** Context window token limit. */
  get contextLimit(): number {
    return this.limit;
  }

  get modelLabel(): string {
    return this.profile.label;
  }

  get modelProfile(): ModelProfile {
    return this.profile;
  }

  /** Add a message to the running count. */
  add(message: Message): void {
    this.total += MESSAGE_OVERHEAD_TOKENS + this.estimateForProvider(message.content);
    for (const tc of message.toolCalls ?? []) {
      this.total += MESSAGE_OVERHEAD_TOKENS + this.estimateForProvider(JSON.stringify(tc.arguments));
    }
  }

  /** Current estimated token count. */
  get count(): number {
    return this.total;
  }

  /** Fraction used (0–1). */
  get fraction(): number {
    return this.total / this.limit;
  }

  /** Human-readable usage string, e.g. "12,400 / 128,000 (9.7%)". */
  get summary(): string {
    const pct = (this.fraction * 100).toFixed(1);
    return `~${this.total.toLocaleString()} / ${this.limit.toLocaleString()} (${pct}%)`;
  }

  /** Whether usage exceeds the warning threshold (80%). */
  get isNearLimit(): boolean {
    return this.fraction > 0.8;
  }

  /** Reset the counter after syncing a fresh conversation state. */
  reset(): void {
    this.total = 0;
  }

  /** Set a new limit. */
  setLimit(limit: number): void {
    this.limit = limit;
  }

  /** Set a model profile and adopt its source-backed context window. */
  setModel(modelName: string): void {
    this.profile = findModelProfile(modelName);
    this.limit = this.profile.contextWindow;
  }

  private estimateForProvider(text: string): number {
    const charsPerToken = this.profile.provider === "anthropic"
      ? ANTHROPIC_CHARS_PER_TOKEN
      : DEFAULT_CHARS_PER_TOKEN;
    return estimateTokens(text, charsPerToken);
  }
}
