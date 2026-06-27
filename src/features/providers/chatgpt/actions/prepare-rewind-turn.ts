import type { Page } from "playwright";
import { captureLastResponse } from "../conversation/capture-last-response.ts";
import { countAssistantResponses } from "../conversation/count-assistant-responses.ts";
import { buildPreparedRewindTurn } from "./build-prepared-rewind-turn.ts";
import type { PrepareRewindTurnContext, PreparedRewindTurn } from "./rewind.types.ts";
import { loadLastUserBlock } from "./load-last-user-block.ts";

/** Load the last user block and baseline counts for a rewind operation. */
export async function prepareRewindTurn(ctx: PrepareRewindTurnContext): Promise<PreparedRewindTurn> {
  const lastUserBlock = await loadLastUserBlock({ page: ctx.page });
  const previousAssistantCount = await countAssistantResponses(ctx.page);
  const previousLastAssistantText = await captureLastResponse(ctx.page);
  return buildPreparedRewindTurn({
    page: ctx.page,
    replacement: ctx.replacement,
    lastUserBlock,
    previousAssistantCount,
    previousLastAssistantText,
  });
}
