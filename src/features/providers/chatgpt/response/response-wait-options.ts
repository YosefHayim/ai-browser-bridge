/** Options for {@link waitForResponse}. */
export interface ResponseWaitOptions {
  /** Maximum wait time in milliseconds. */
  timeout?: number;
  /** Assistant block count before the prompt was sent. */
  previousAssistantCount?: number;
  /** Last assistant text before the prompt was sent. */
  previousLastAssistantText?: string;
}
