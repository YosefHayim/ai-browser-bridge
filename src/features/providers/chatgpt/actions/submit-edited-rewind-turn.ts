import { waitForResponse } from "../response/wait-for-response.ts";
import { findRewindSubmitButton } from "./rewind-controls.ts";
import type { PreparedRewindTurn } from "./rewind.types.ts";

/** Context for {@link submitEditedRewindTurn}. */
export interface SubmitEditedRewindTurnContext {
  /** Prepared rewind turn state. */
  prepared: PreparedRewindTurn;
}

/** Submit the edited rewind turn and wait for the new response. */
export async function submitEditedRewindTurn(ctx: SubmitEditedRewindTurnContext): Promise<void> {
  const submitButton = await findRewindSubmitButton({
    page: ctx.prepared.page,
    turnScope: ctx.prepared.turnScope,
  });
  if (!submitButton) throw new Error("Could not find submit button for edited prompt.");
  await submitButton.click();
  await waitForResponse(ctx.prepared.page, {
    previousAssistantCount: ctx.prepared.previousAssistantCount,
    previousLastAssistantText: ctx.prepared.previousLastAssistantText,
  });
}
