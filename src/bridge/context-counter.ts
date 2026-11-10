import type { Message } from "@/domain/message-types.ts";
import { findModelProfile } from "@/domain/model-lookup.ts";
import type { ModelProfile } from "@/domain/model-profile-types.ts";
import { UNKNOWN_MODEL_PROFILE } from "@/domain/model-profiles.ts";

const DEFAULT_CHARS_PER_TOKEN = 4;

const ANTHROPIC_CHARS_PER_TOKEN = 3.5;

const MESSAGE_OVERHEAD_TOKENS = 4;

export const estimateTokens = (
  message: string,
  charsPerToken = DEFAULT_CHARS_PER_TOKEN,
): number => {
  const isStringEmpty = message.length === 0;
  if (isStringEmpty) return 0;

  return Math.ceil(message.length / charsPerToken);
};

export class TokenCounter {
  private total = 0;
  private profile: ModelProfile;

  constructor(
    private limit: number,
    modelName?: string,
  ) {
    const isModelNameMissing = modelName == null;
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

    const isToolCallsMissing = toolCalls == null;
    if (isToolCallsMissing) return;

    for (const toolCall of toolCalls) {
      const toolCallArgumentsString = JSON.stringify(toolCall.arguments);
      this.total += MESSAGE_OVERHEAD_TOKENS + this.estimateForProvider(toolCallArgumentsString);
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

  private estimateForProvider(message: string): number {
    const isProfileProviderAnthropic = this.profile.provider === "anthropic";
    if (isProfileProviderAnthropic) {
      return estimateTokens(message, ANTHROPIC_CHARS_PER_TOKEN);
    }

    return estimateTokens(message, DEFAULT_CHARS_PER_TOKEN);
  }
}
