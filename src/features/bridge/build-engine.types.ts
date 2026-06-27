/** Input for {@link Engine.ask}. */
export interface AskEngineInput {
  /** User prompt text. */
  content: string;
  /** Optional timeout override in milliseconds. */
  timeoutMs?: number;
}

/** Input for {@link Engine.shutdown}. */
export interface ShutdownEngineInput {
  /** Whether to close the browser on shutdown. */
  closeBrowser?: boolean;
}
