import type { Locator } from "playwright";
import {
  readLastUserPromptText,
  resolveLastUserTurnScope,
  resolveRewindPrompt,
} from "./rewind-helpers.ts";
import type { PrepareRewindTurnContext, PreparedRewindTurn } from "./rewind.types.ts";

/** Context for {@link buildPreparedRewindTurn}. */
export interface BuildPreparedRewindTurnContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: PrepareRewindTurnContext["page"];
  /** Optional replacement text for the last user message. */
  replacement?: string;
  /** Last user message block locator. */
  lastUserBlock: Locator;
  /** Assistant block count before rewind. */
  previousAssistantCount: number;
  /** Last assistant text before rewind. */
  previousLastAssistantText: string;
}

/** Build prepared rewind state from loaded baseline values. */
export async function buildPreparedRewindTurn(ctx: BuildPreparedRewindTurnContext): Promise<PreparedRewindTurn> {
  const turnScope = await resolveLastUserTurnScope({ lastUserBlock: ctx.lastUserBlock });
  const prompt = resolveRewindPrompt({
    replacement: ctx.replacement,
    previousText: await readLastUserPromptText({ lastUserBlock: ctx.lastUserBlock }),
  });
  return {
    page: ctx.page,
    turnScope,
    prompt,
    previousAssistantCount: ctx.previousAssistantCount,
    previousLastAssistantText: ctx.previousLastAssistantText,
  };
}
