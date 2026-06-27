import type { CommandContext } from "../../../../domain/types.ts";
import { bridgeLogPath } from "../../../../store/logging.ts";
import { formatBridgeStatus } from "../../formatters.ts";

/** Start a new ChatGPT conversation. */
export async function handleNew(_args: string, ctx: CommandContext): Promise<void> {
  await ctx.orchestrator.newConversation();
  console.log("Started new conversation.");
}

/** Stop the active ChatGPT response. */
export async function handleStop(_args: string, ctx: CommandContext): Promise<void> {
  const stopped = await ctx.orchestrator.stopResponse();
  console.log(stopped ? "Stopped active response." : "No active response to stop.");
}

/** Ask ChatGPT for a concise progress summary. */
export async function handleCompact(_args: string, ctx: CommandContext): Promise<void> {
  await ctx.sendMessage(
    "Summarize our progress so far in a structured format: what we've done, what's in progress, what's next. Be concise.",
  );
  console.log("Compaction summary requested. Start a new conversation to continue with that summary.");
}

/** Show the local bridge log file path. */
export async function handleLogs(_args: string, ctx: CommandContext): Promise<void> {
  console.log(`Bridge logs: ${bridgeLogPath(ctx.config.repoPath)}`);
}

/** Show bridge status. */
export async function handleStatus(_args: string, ctx: CommandContext): Promise<void> {
  console.log(formatBridgeStatus(ctx));
}

/** Show status bar fields. */
export async function handleStatusline(_args: string, ctx: CommandContext): Promise<void> {
  console.log(formatBridgeStatus(ctx));
}

/** Clear the terminal chat view. */
export async function handleClear(_args: string, ctx: CommandContext): Promise<void> {
  ctx.clearMessages?.();
  console.log("Cleared terminal chat view. Browser conversation, context estimate, and local session logs are unchanged.");
}

/** Show current git diff via ChatGPT. */
export async function handleDiff(_args: string, ctx: CommandContext): Promise<void> {
  await ctx.sendMessage("Show me the current git diff for the repository.");
}

/** Shutdown the bridge. */
export async function handleExit(_args: string, ctx: CommandContext): Promise<void> {
  if (ctx.shutdown) {
    await ctx.shutdown();
    return;
  }
  console.log("Shutting down...");
  process.exit(0);
}
