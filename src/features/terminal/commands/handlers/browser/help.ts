import type { CommandContext } from "../../../../domain/types.ts";
import { loadCustomCommands } from "../../../../user-config/custom-commands.ts";
import { getAllCommands } from "../../registry.ts";

/** List all available slash commands. */
export async function handleHelp(_args: string, ctx: CommandContext): Promise<void> {
  const all = getAllCommands();
  console.log("\nAvailable commands:\n");
  for (const cmd of all) {
    console.log(`  /${cmd.name.padEnd(16)} ${cmd.description}`);
  }
  await printCustomCommands(ctx);
  console.log("");
}

/** Print project/user custom commands when present. */
async function printCustomCommands(ctx: CommandContext): Promise<void> {
  const custom = await loadCustomCommands({ repoRoot: ctx.config.repoPath });
  if (custom.length === 0) return;
  console.log("\nCustom commands:\n");
  for (const cmd of custom) {
    console.log(`  /${cmd.name.padEnd(16)} ${cmd.description ?? `${cmd.source} command`}`);
  }
}

/** List project/user custom commands. */
export async function handleCommands(_args: string, ctx: CommandContext): Promise<void> {
  const custom = await loadCustomCommands({ repoRoot: ctx.config.repoPath });
  if (custom.length === 0) {
    console.log("No custom commands found in .bridge/commands or ~/.ai-browser-bridge/commands.");
    return;
  }
  console.log("\nCustom commands:\n");
  for (const command of custom) {
    console.log(`  /${command.name.padEnd(16)} ${command.description ?? `${command.source} command`}`);
  }
  console.log("");
}
