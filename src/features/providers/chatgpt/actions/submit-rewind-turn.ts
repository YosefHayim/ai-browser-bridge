import {
  findRewindSubmitButton,
  submitRewindEditor,
} from "./rewind-controls.ts";
import { openRewindEditor } from "./open-rewind-editor.ts";
import { submitEditedRewindTurn } from "./submit-edited-rewind-turn.ts";
import type { PreparedRewindTurn } from "./rewind.types.ts";

/** Context for {@link submitRewindTurn}. */
export interface SubmitRewindTurnContext {
  /** Prepared rewind turn state. */
  prepared: PreparedRewindTurn;
}

/** Hover, edit, and resubmit the last user turn. */
export async function submitRewindTurn(ctx: SubmitRewindTurnContext): Promise<void> {
  const editor = await openRewindEditor({ prepared: ctx.prepared });
  if (!editor) throw new Error("Could not find editable prompt field after clicking edit.");
  await submitRewindEditor({ editor, prompt: ctx.prepared.prompt });
  await submitEditedRewindTurn({ prepared: ctx.prepared });
}
