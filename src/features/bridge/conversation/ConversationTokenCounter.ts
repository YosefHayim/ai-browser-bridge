import type { Message } from "@/features/conversations/conversationTypes.ts";
import { findModelProfile } from "@/features/models/modelLookup.ts";
import { UNKNOWN_MODEL_PROFILE } from "@/features/models/modelProfiles.ts";
import type { ModelProfile } from "@/features/models/modelProfileTypes.ts";

const DEFAULT_CHARS_PER_TOKEN = 4;

const ANTHROPIC_CHARS_PER_TOKEN = 3.5;

const MESSAGE_OVERHEAD_TOKENS = 4;

export const estimateTokens = (text: string, charsPerToken = DEFAULT_CHARS_PER_TOKEN): number => {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / charsPerToken);
};

export class ConversationTokenCounter {
  private estimatedTokens = 0;
  private activeModelProfile: ModelProfile;

  constructor(
    private tokenLimit: number,
    modelName?: string,
  ) {
    if (modelName === undefined) {
      this.activeModelProfile = UNKNOWN_MODEL_PROFILE;
      return;
    }
    this.activeModelProfile = findModelProfile(modelName);
    this.tokenLimit = this.activeModelProfile.contextWindow;
  }

  get contextLimit(): number {
    return this.tokenLimit;
  }

  get modelLabel(): string {
    return this.activeModelProfile.label;
  }

  get modelProfile(): ModelProfile {
    return this.activeModelProfile;
  }

  add(message: Message): void {
    const messageTokens = this.estimateForProvider(message.content);
    this.estimatedTokens += MESSAGE_OVERHEAD_TOKENS + messageTokens;
    const toolCalls = message.toolCalls;
    if (toolCalls === undefined) return;
    for (const toolCall of toolCalls) {
      const toolArgumentsText = JSON.stringify(toolCall.arguments);
      const toolArgumentTokens = this.estimateForProvider(toolArgumentsText);
      this.estimatedTokens += MESSAGE_OVERHEAD_TOKENS + toolArgumentTokens;
    }
  }

  get count(): number {
    return this.estimatedTokens;
  }

  get fraction(): number {
    return this.estimatedTokens / this.tokenLimit;
  }

  get summary(): string {
    const usagePercent = (this.fraction * 100).toFixed(1);
    return `~${this.estimatedTokens.toLocaleString()} / ${this.tokenLimit.toLocaleString()} (${usagePercent}%)`;
  }

  get isNearLimit(): boolean {
    return this.fraction > 0.8;
  }

  reset(): void {
    this.estimatedTokens = 0;
  }

  setLimit(tokenLimit: number): void {
    this.tokenLimit = tokenLimit;
  }

  setModel(modelName: string): void {
    this.activeModelProfile = findModelProfile(modelName);
    this.tokenLimit = this.activeModelProfile.contextWindow;
  }

  private estimateForProvider(text: string): number {
    if (this.activeModelProfile.provider === "anthropic") {
      return estimateTokens(text, ANTHROPIC_CHARS_PER_TOKEN);
    }
    return estimateTokens(text, DEFAULT_CHARS_PER_TOKEN);
  }
}
