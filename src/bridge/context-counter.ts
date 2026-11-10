import type { Message } from "@/domain/message-types.ts";
import { findModelProfile } from "@/domain/model-lookup.ts";
import type { ModelProfile } from "@/domain/model-profile-types.ts";
import { UNKNOWN_MODEL_PROFILE } from "@/domain/model-profiles.ts";

const DEFAULT_CHARS_PER_TOKEN = 4;

const ANTHROPIC_CHARS_PER_TOKEN = 3.5;

const MESSAGE_OVERHEAD_TOKENS = 4;

export const estimateTokens = (text: string, charsPerToken = DEFAULT_CHARS_PER_TOKEN): number => {
  const isTextEmpty = text.length === 0;
  if (isTextEmpty) return 0;

  return Math.ceil(text.length / charsPerToken);
};

export class ContextCounter {
  private total = 0;
  private profile: ModelProfile;

  constructor(
    private limit: number,
    modelName?: string,
  ) {
    const isModelNameMissing = modelName === undefined;
    if (isModelNameMissing) {
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

  add(message: Message): void {
    this.total += MESSAGE_OVERHEAD_TOKENS + this.estimateForProvider(message.content);
    const toolCalls = message.toolCalls;

    const isToolCallsMissing = toolCalls === undefined;
    if (isToolCallsMissing) return;

    for (const toolCall of toolCalls) {
      const toolCallArgumentsText = JSON.stringify(toolCall.arguments);
      this.total += MESSAGE_OVERHEAD_TOKENS + this.estimateForProvider(toolCallArgumentsText);
    }
  }

  get count(): number {
    return this.total;
  }

  get fraction(): number {
    return this.total / this.limit;
  }

  get summary(): string {
    const usagePercent = (this.fraction * 100).toFixed(1);
    return `~${this.total.toLocaleString()} / ${this.limit.toLocaleString()} (${usagePercent}%)`;
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
    const isProfileProviderAnthropic = this.profile.provider === "anthropic";
    if (isProfileProviderAnthropic) {
      return estimateTokens(text, ANTHROPIC_CHARS_PER_TOKEN);
    }

    return estimateTokens(text, DEFAULT_CHARS_PER_TOKEN);
  }
}
