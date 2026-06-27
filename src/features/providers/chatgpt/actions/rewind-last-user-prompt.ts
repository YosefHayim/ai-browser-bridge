import type { Page } from "playwright";
import { prepareRewindTurn } from "./prepare-rewind-turn.ts";
import { submitRewindTurn } from "./submit-rewind-turn.ts";

/** Edit the last user message and submit it again, optionally replacing its content. */
export async function rewindLastUserPrompt(page: Page, replacement?: string): Promise<void> {
  const prepared = await prepareRewindTurn({ page, replacement });
  await submitRewindTurn({ prepared });
}
