/** Known upstream model provider for context-window lookup. */
export type ModelProvider = "openai" | "anthropic" | "zai" | "google" | "unknown";

/** Static metadata for a supported or fallback model profile. */
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
