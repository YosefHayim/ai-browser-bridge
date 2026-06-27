import type { Page } from "playwright";
import type { Message } from "../domain/types.ts";
import type { BrowserProvider } from "../providers/create-provider.factory.ts";
import type { OrchestratorEvent } from "./orchestrator.types.ts";
import { mapCapturedMessages } from "./orchestrator.emitter.ts";

/** Context for syncing conversation messages from the DOM. */
export interface SyncConversationContext {
  page: Page | null;
  provider: BrowserProvider;
  emit: (event: OrchestratorEvent) => void;
}

/** Read all messages from the provider DOM and emit conversation_synced. */
export async function syncConversationMessages(ctx: SyncConversationContext): Promise<Message[]> {
  if (!ctx.page) return [];
  const messages = mapCapturedMessages(await ctx.provider.captureAllMessages(ctx.page));
  if (messages.length === 0) return [];
  ctx.emit({ type: "conversation_synced", messages });
  return messages;
}

/** Context for navigating to a conversation URL. */
export interface NavigateConversationContext extends SyncConversationContext {
  page: Page;
  url: string;
}

/** Navigate to a conversation and sync messages. */
export async function navigateToConversationAction(ctx: NavigateConversationContext): Promise<Message[]> {
  ctx.emit({ type: "status", text: "Navigating to conversation..." });
  await ctx.provider.navigateToConversation(ctx.page, ctx.url);
  const messages = await syncConversationMessages(ctx);
  ctx.emit({ type: "status", text: "Ready" });
  return messages;
}

/** Context for starting a new conversation. */
export interface NewConversationContext {
  page: Page;
  provider: BrowserProvider;
  emit: (event: OrchestratorEvent) => void;
}

/** Open a fresh conversation in the browser. */
export async function newConversationAction(ctx: NewConversationContext): Promise<void> {
  ctx.emit({ type: "status", text: "Starting new conversation..." });
  await ctx.provider.newConversation(ctx.page);
  ctx.emit({ type: "reset" });
  ctx.emit({ type: "status", text: "Ready — new conversation" });
}

/** Context for rewinding the last user prompt. */
export interface RewindLastPromptContext extends SyncConversationContext {
  page: Page;
  replacement?: string;
}

/** Rewind the last user prompt and resync messages. */
export async function rewindLastPromptAction(ctx: RewindLastPromptContext): Promise<Message[]> {
  ctx.emit({ type: "status", text: "Rewinding last prompt..." });
  await ctx.provider.rewindLastUserPrompt(ctx.page, ctx.replacement);
  const messages = await syncConversationMessages(ctx);
  ctx.emit({ type: "status", text: "Ready — rewound last prompt" });
  return messages;
}

/** Context for attaching files to the composer. */
export interface AttachFilesContext {
  page: Page;
  provider: BrowserProvider;
  paths: string[];
  emit: (event: OrchestratorEvent) => void;
}

/** Attach local files to the current composer. */
export async function attachFilesAction(ctx: AttachFilesContext): Promise<void> {
  ctx.emit({ type: "status", text: "Attaching files..." });
  await ctx.provider.attachFilesToPrompt(ctx.page, ctx.paths);
  ctx.emit({ type: "status", text: "Files attached." });
}

/** Context for stopping an active response stream. */
export interface StopResponseContext {
  page: Page;
  provider: BrowserProvider;
  emit: (event: OrchestratorEvent) => void;
}

/** Stop the active response stream when possible. */
export async function stopResponseAction(ctx: StopResponseContext): Promise<boolean> {
  const stopped = await ctx.provider.stopGenerating(ctx.page);
  ctx.emit({ type: "status", text: stopped ? "Stopped response." : "No active response to stop." });
  return stopped;
}
