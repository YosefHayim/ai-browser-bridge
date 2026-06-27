import type { CommandContext } from "../../../../domain/types.ts";
import { normalizeProvider } from "../../../../providers/create-provider.factory.ts";
import { loadProjectInstructions } from "../../../../user-config/project-instructions.ts";
import { buildProjectTaskPromptWithInstructions } from "../../prompts.ts";

/** Send a project-agent task with MCP tool instructions. */
export async function handleTask(args: string, ctx: CommandContext): Promise<void> {
  const task = args.trim();
  if (!task) {
    console.log("Usage: /task <project task>");
    return;
  }
  if (normalizeProvider(ctx.config.provider) === "gemini") {
    printGeminiTaskWarning();
    return;
  }
  const instructions = await loadProjectInstructions(ctx.config.repoPath);
  await ctx.sendMessage(buildProjectTaskPromptWithInstructions(task, ctx, instructions.promptText));
}

/** Print Gemini-specific `/task` limitation message. */
function printGeminiTaskWarning(): void {
  console.log(
    "Gemini web does not support MCP connectors. /task needs live repo tools — use ChatGPT, or send a normal prompt with @file mentions on Gemini.",
  );
}

/** Ask ChatGPT to review local repository changes. */
export async function handleReview(args: string, ctx: CommandContext): Promise<void> {
  const scope = args.trim() || "working";
  await ctx.sendMessage([
    "Review the local repository changes with a code-review stance.",
    "Prioritize bugs, regressions, security risks, and missing tests.",
    "Use the MCP tools to inspect the repo and diff before making claims.",
    `Review scope: ${scope}`,
  ].join("\n"));
}
