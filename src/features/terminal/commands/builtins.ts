import type { CommandDef } from "../../domain/types.ts";
import { filesCommand } from "./files.ts";
import {
  BROWSER_COMMANDS,
  MCP_COMMANDS,
  MODEL_COMMANDS,
  SESSION_COMMANDS,
  type CommandMeta,
} from "./commands.config.ts";
import { BROWSER_HANDLERS } from "./handlers/browser.ts";
import { MCP_HANDLERS } from "./handlers/mcp.ts";
import { MODEL_HANDLERS } from "./handlers/model.ts";
import { SESSION_HANDLERS } from "./handlers/session.ts";

/** Handler lookup table keyed by slash-command name. */
type CommandHandlerMap = Record<string, CommandDef["handler"]>;

/** Inputs for composing command definitions from metadata and handlers. */
interface ComposeCommandsInput {
  /** Command metadata entries. */
  meta: CommandMeta[];
  /** Handler map keyed by command name. */
  handlers: CommandHandlerMap;
}

/**
 * Compose {@link CommandDef} entries from metadata arrays and handler maps.
 * Keeps `builtins.ts` thin while `commands.config.ts` stays function-free.
 */
function composeCommands(input: ComposeCommandsInput): CommandDef[] {
  return input.meta.map((entry) => ({
    name: entry.name,
    description: entry.description,
    aliases: entry.aliases,
    handler: input.handlers[entry.name],
  }));
}

/** Built-in slash commands registered at startup via `registry.ts`. */
export const BUILTIN_COMMANDS: CommandDef[] = [
  filesCommand,
  ...composeCommands({ meta: SESSION_COMMANDS, handlers: SESSION_HANDLERS }),
  ...composeCommands({ meta: MODEL_COMMANDS, handlers: MODEL_HANDLERS }),
  ...composeCommands({ meta: MCP_COMMANDS, handlers: MCP_HANDLERS }),
  ...composeCommands({ meta: BROWSER_COMMANDS, handlers: BROWSER_HANDLERS }),
];
