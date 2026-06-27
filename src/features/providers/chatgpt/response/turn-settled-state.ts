/** Snapshot of assistant turn state used by {@link isTurnSettled}. */
export interface TurnSettledState {
  /** Whether the assistant block contains non-empty text. */
  hasText: boolean;
  /** Whether the text is a transient placeholder such as "Thinking…". */
  isTransientText: boolean;
  /** Count of generated image assets in the current turn. */
  assetCount: number;
  /** Whether ChatGPT is still streaming the response. */
  streaming: boolean;
  /** Milliseconds the visible content has been unchanged. */
  stableForMs: number;
}
