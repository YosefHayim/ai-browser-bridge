import type { Message } from "../domain/types.ts";
import type { OrchestratorEvent, SendPromptInput } from "./orchestrator.types.ts";
import { buildMessage, formatError, requirePageForPrompt } from "./orchestrator.emitter.ts";

/** Context for executing a prompt round-trip. */
export interface ExecuteSendPromptContext extends SendPromptInput {
  page: import("playwright").Page | null;
  provider: import("../providers/create-provider.factory.ts").BrowserProvider;
  emit: (event: OrchestratorEvent) => void;
  pushMessage: (message: Message) => void;
}

/** Send a user prompt and capture the assistant reply. */
export async function executeSendPrompt(ctx: ExecuteSendPromptContext): Promise<Message | null> {
  emitUserPrompt(ctx);
  const page = requirePageForPrompt(ctx.page, ctx.emit);
  if (!page) return null;
  return captureAssistantReply({ ...ctx, page });
}

/** Emit the user message and waiting status. */
function emitUserPrompt(ctx: ExecuteSendPromptContext): void {
  const userMsg = buildMessage("user", ctx.content);
  ctx.pushMessage(userMsg);
  ctx.emit({ type: "message", message: userMsg });
  ctx.emit({ type: "status", text: `Waiting for ${ctx.provider.displayName}...` });
}

/** Context for capturing the assistant reply after prompt injection. */
interface CaptureAssistantReplyContext extends ExecuteSendPromptContext {
  page: import("playwright").Page;
}

/** Inject prompt, wait for response, and return the assistant message. */
async function captureAssistantReply(ctx: CaptureAssistantReplyContext): Promise<Message | null> {
  try {
    return await captureAssistantReplySuccess(ctx);
  } catch (err) {
    ctx.emit({ type: "error", error: formatError(err) });
    return null;
  }
}

/** Run the provider round-trip and emit the assistant message. */
async function captureAssistantReplySuccess(ctx: CaptureAssistantReplyContext): Promise<Message> {
  const baseline = await readResponseBaseline(ctx);
  await injectAndWait({ ctx, baseline });
  return emitAssistantReply(ctx);
}

/** Baseline assistant response state before prompt injection. */
interface ResponseBaseline {
  previousAssistantCount: number;
  previousLastAssistantText: string;
}

/** Context for injecting a prompt and waiting for a response. */
interface InjectAndWaitContext {
  ctx: CaptureAssistantReplyContext;
  baseline: ResponseBaseline;
}

/** Read assistant response baseline before injecting a prompt. */
async function readResponseBaseline(ctx: CaptureAssistantReplyContext): Promise<ResponseBaseline> {
  const previousAssistantCount = await ctx.provider.countAssistantResponses(ctx.page);
  const previousLastAssistantText = await ctx.provider.captureLastResponse(ctx.page);
  return { previousAssistantCount, previousLastAssistantText };
}

/** Inject prompt and wait for the provider response. */
async function injectAndWait(input: InjectAndWaitContext): Promise<void> {
  await input.ctx.provider.injectPrompt(input.ctx.page, input.ctx.content);
  input.ctx.emit({ type: "status", text: `${input.ctx.provider.displayName} is responding...` });
  await input.ctx.provider.waitForResponse(input.ctx.page, {
    previousAssistantCount: input.baseline.previousAssistantCount,
    previousLastAssistantText: input.baseline.previousLastAssistantText,
    timeout: input.ctx.timeoutMs,
  });
}

/** Capture assistant text and emit the assistant message event. */
async function emitAssistantReply(ctx: CaptureAssistantReplyContext): Promise<Message> {
  const responseText = await ctx.provider.captureLastResponse(ctx.page);
  return publishAssistantMessage({ ctx, responseText });
}

/** Build and emit the assistant message from captured text. */
function publishAssistantMessage(input: { ctx: CaptureAssistantReplyContext; responseText: string }): Message {
  const assistantMsg = buildMessage("assistant", input.responseText);
  input.ctx.pushMessage(assistantMsg);
  input.ctx.emit({ type: "message", message: assistantMsg });
  input.ctx.emit({ type: "status", text: "Ready" });
  return assistantMsg;
}
