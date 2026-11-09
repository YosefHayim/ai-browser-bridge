export type ModelProvider = "openai" | "anthropic" | "zai" | "google" | "unknown";

export type ModelProfile = {
  readonly id: string;
  readonly label: string;
  readonly provider: ModelProvider;
  readonly aliases: readonly string[];
  readonly contextWindow: number;
  readonly maxOutputTokens?: number;
  readonly sourceUrl: string;
  readonly note?: string;
};
