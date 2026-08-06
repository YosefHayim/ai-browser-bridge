import type { Message } from "@/features/domain";
import { findModelProfile, type ModelProfile, UNKNOWN_MODEL_PROFILE } from "@/features/domain";

/** Rough character-to-token ratio for estimation. */
const DEFAULT_CHARS_PER_TOKEN = 4;

const ANTHROPIC_CHARS_PER_TOKEN = 3.5;

const MESSAGE_OVERHEAD_TOKENS = 4;

/** Estimate token count for a single string. */
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
    if (modelName === undefined) {
      this.profile = UNKNOWN_MODEL_PROFILE;
      return;
    }
    this.profile = findModelProfile(modelName);
    this.limit = this.profile.contextWindow;
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

  /** Add one message's estimated tokens to the running total. */
  add(message: Message): void {
    this.total += MESSAGE_OVERHEAD_TOKENS + this.estimateForProvider(message.content);
    const toolCalls = message.toolCalls;
    if (toolCalls === undefined) return;
    for (const toolCall of toolCalls) {
      this.total +=
        MESSAGE_OVERHEAD_TOKENS + this.estimateForProvider(JSON.stringify(toolCall.arguments));
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

  reset(): void {
    this.total = 0;
  }

  setLimit(limit: number): void {
    this.limit = limit;
  }

  setModel(modelName: string): void {
    this.profile = findModelProfile(modelName);
    this.limit = this.profile.contextWindow;
  }

  private estimateForProvider(text: string): number {
    if (this.profile.provider === "anthropic") {
      return estimateTokens(text, ANTHROPIC_CHARS_PER_TOKEN);
    }
    return estimateTokens(text, DEFAULT_CHARS_PER_TOKEN);
  }
}
