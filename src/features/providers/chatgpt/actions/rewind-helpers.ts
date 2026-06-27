import type { Locator, Page } from "playwright";
import { SELECTORS } from "../selectors.config.ts";
import { firstVisibleIn } from "../dom/first-visible-in.ts";
import { normalizeDisplayText } from "../dom/normalize-display-text.ts";

/** Context for {@link resolveLastUserTurnScope}. */
export interface ResolveLastUserTurnScopeContext {
  /** Last user message block locator. */
  lastUserBlock: Locator;
}

/** Resolve the conversation turn scope for hovering edit controls. */
export async function resolveLastUserTurnScope(ctx: ResolveLastUserTurnScopeContext): Promise<Locator> {
  const turn = ctx.lastUserBlock.locator('xpath=ancestor::section[starts-with(@data-testid, "conversation-turn-")][1]');
  return (await turn.count() > 0) ? turn : ctx.lastUserBlock;
}

/** Edit-button selectors scoped to a user turn. */
export const EDIT_BUTTON_SELECTORS = [
  'button[data-testid="edit-turn-button"]',
  'button[data-testid="edit-message-button"]',
  'button[aria-label="Edit message"]',
  'button[aria-label*="Edit" i]',
  'button[title="Edit message"]',
  'button:has-text("Edit")',
] as const;

/** Editor selectors scoped to a user turn or page. */
export const EDITOR_SELECTORS = [
  'textarea[name="prompt-textarea"]',
  '[contenteditable="true"][role="textbox"]',
  '[contenteditable="true"]',
  "textarea",
] as const;

/** Submit-button selectors for edited prompts. */
export const SUBMIT_BUTTON_SELECTORS = [
  'button[data-testid="send-button"]',
  'button[aria-label="Submit"]',
  'button[aria-label="Send"]',
  'button[aria-label="Send prompt"]',
  'button:has-text("Save & submit")',
  'button:has-text("Submit")',
  'button:has-text("Update")',
] as const;

/** Context for {@link readLastUserPromptText}. */
export interface ReadLastUserPromptTextContext {
  /** Last user message block locator. */
  lastUserBlock: Locator;
}

/** Read normalized text from the last user message block. */
export async function readLastUserPromptText(ctx: ReadLastUserPromptTextContext): Promise<string> {
  return normalizeDisplayText({ value: await ctx.lastUserBlock.innerText() });
}

/** Context for {@link resolveRewindPrompt}. */
export interface ResolveRewindPromptContext {
  /** Optional replacement prompt text. */
  replacement?: string;
  /** Previous text from the last user message. */
  previousText: string;
}

/** Resolve the prompt text to submit when rewinding the last user message. */
export function resolveRewindPrompt(ctx: ResolveRewindPromptContext): string {
  const prompt = ctx.replacement?.trim() || ctx.previousText;
  if (!prompt) throw new Error("Last user message is empty.");
  return prompt;
}
