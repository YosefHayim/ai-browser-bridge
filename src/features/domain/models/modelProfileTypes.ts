/** Known upstream model provider for context-window lookup. */
export type ModelProvider = "openai" | "anthropic" | "zai" | "google" | "unknown";

/** Static metadata for a supported or fallback model profile. */
export interface ModelProfile {
  /** Canonical profile id used for lookup. */
  id: string;
  /** Human-readable label shown in the UI. */
  label: string;
  /** Upstream provider that publishes the model. */
  provider: ModelProvider;
  /** Alternate names accepted by {@link findModelProfile}. */
  aliases: string[];
  /** Published context window size in tokens. */
  contextWindow: number;
  /** Optional max output token limit. */
  maxOutputTokens?: number;
  /** Documentation URL backing the profile metadata. */
  sourceUrl: string;
  /** Optional note about browser vs API differences. */
  note?: string;
}
