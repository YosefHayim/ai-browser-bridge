import { findRewindEditButton, findRewindEditor } from "./rewind-controls.ts";
import type { PreparedRewindTurn } from "./rewind.types.ts";

/** Context for {@link clickRewindEditButton}. */
export interface ClickRewindEditButtonContext {
  /** Prepared rewind turn state. */
  prepared: PreparedRewindTurn;
}

/** Hover the turn and click its edit button. */
export async function clickRewindEditButton(ctx: ClickRewindEditButtonContext): Promise<void> {
  await ctx.prepared.turnScope.hover().catch(() => {});
  await ctx.prepared.page.waitForTimeout(300);
  const editButton = await findRewindEditButton({ turnScope: ctx.prepared.turnScope });
  if (!editButton) throw new Error("Could not find ChatGPT edit button for the last user message.");
  await editButton.click();
}

/** Context for {@link openRewindEditor}. */
export interface OpenRewindEditorContext {
  /** Prepared rewind turn state. */
  prepared: PreparedRewindTurn;
}

/** Hover the turn, click edit, and locate the editable prompt field. */
export async function openRewindEditor(ctx: OpenRewindEditorContext) {
  await clickRewindEditButton({ prepared: ctx.prepared });
  return findRewindEditor({ page: ctx.prepared.page, turnScope: ctx.prepared.turnScope });
}
