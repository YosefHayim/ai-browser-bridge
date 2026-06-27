import type { Locator, Page } from "playwright";

/** Prepared rewind turn state before editing and submitting. */
export interface PreparedRewindTurn {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
  /** Conversation turn scope locator. */
  turnScope: Locator;
  /** Prompt text to submit. */
  prompt: string;
  /** Assistant block count before rewind. */
  previousAssistantCount: number;
  /** Last assistant text before rewind. */
  previousLastAssistantText: string;
}

/** Context for {@link prepareRewindTurn}. */
export interface PrepareRewindTurnContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
  /** Optional replacement text for the last user message. */
  replacement?: string;
}
