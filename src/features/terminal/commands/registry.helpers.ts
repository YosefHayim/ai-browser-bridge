import type { CommandDef, CommandContext } from "../../domain/types.ts";
import { loadCustomCommands, renderCustomCommandPrompt } from "../../user-config/custom-commands.ts";

/** Run a built-in handler and report failures without throwing. */
export async function executeBuiltinCommand(input: {
  parsed: { name: string; args: string };
  cmd: CommandDef;
  ctx: CommandContext;
}): Promise<boolean> {
  try {
    await input.cmd.handler(input.parsed.args, input.ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Command /${input.parsed.name} failed: ${message}`);
  }
  return true;
}

/** Resolve and run a user-defined custom command. */
export async function executeCustomCommand(input: {
  parsed: { name: string; args: string };
  ctx: CommandContext;
}): Promise<boolean> {
  const custom = await findCustomCommand({ name: input.parsed.name, ctx: input.ctx });
  if (!custom) return false;
  await input.ctx.sendMessage(renderCustomCommandPrompt(custom, input.parsed.args));
  return true;
}

/** Split a raw `/name args...` string into its name and argument remainder. */
export function parseCommandInput(input: string): { name: string; args: string } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;
  const { name, args } = splitCommandNameAndArgs(trimmed);
  if (!name) return null;
  return { name, args };
}

/** Extract command name and args from a trimmed slash input string. */
function splitCommandNameAndArgs(trimmed: string): { name: string; args: string } {
  const spaceIdx = trimmed.indexOf(" ");
  const name = spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx);
  const args = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1);
  return { name, args };
}

/** Look up a project/user custom command by name. */
async function findCustomCommand(input: { name: string; ctx: CommandContext }) {
  const custom = await loadCustomCommands({ repoRoot: input.ctx.config.repoPath });
  return custom.find((command) => command.name === input.name);
}
