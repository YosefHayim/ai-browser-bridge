import type { Locator, Page } from "playwright";
import { firstVisibleIn } from "../dom/first-visible-in.ts";
import { firstVisible as firstVisibleOnPage } from "../dom/first-visible.ts";
import {
  EDITOR_SELECTORS,
  EDIT_BUTTON_SELECTORS,
  SUBMIT_BUTTON_SELECTORS,
} from "./rewind-helpers.ts";

/** Context for {@link findRewindEditButton}. */
export interface FindRewindEditButtonContext {
  /** Conversation turn scope locator. */
  turnScope: Locator;
}

/** Find the edit button for the last user message within a turn scope. */
export async function findRewindEditButton(ctx: FindRewindEditButtonContext) {
  return firstVisibleIn({ parent: ctx.turnScope, selectors: EDIT_BUTTON_SELECTORS });
}

/** Context for {@link findRewindEditor}. */
export interface FindRewindEditorContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
  /** Conversation turn scope locator. */
  turnScope: Locator;
}

/** Find the editable prompt field after clicking edit. */
export async function findRewindEditor(ctx: FindRewindEditorContext) {
  return firstVisibleIn({ parent: ctx.turnScope, selectors: EDITOR_SELECTORS })
    ?? firstVisibleOnPage({ page: ctx.page, selectors: EDITOR_SELECTORS });
}

/** Context for {@link findRewindSubmitButton}. */
export interface FindRewindSubmitButtonContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
  /** Conversation turn scope locator. */
  turnScope: Locator;
}

/** Find the submit button for an edited prompt. */
export async function findRewindSubmitButton(ctx: FindRewindSubmitButtonContext) {
  return firstVisibleIn({ parent: ctx.turnScope, selectors: SUBMIT_BUTTON_SELECTORS })
    ?? firstVisibleOnPage({ page: ctx.page, selectors: SUBMIT_BUTTON_SELECTORS });
}

/** Context for {@link submitRewindEditor}. */
export interface SubmitRewindEditorContext {
  /** Editable prompt field locator. */
  editor: Locator;
  /** Prompt text to write before submitting. */
  prompt: string;
}

/** Fill the rewind editor with the replacement prompt. */
export async function submitRewindEditor(ctx: SubmitRewindEditorContext): Promise<void> {
  await ctx.editor.click();
  await ctx.editor.fill(ctx.prompt);
  await ctx.editor.dispatchEvent("input").catch(() => {});
}
