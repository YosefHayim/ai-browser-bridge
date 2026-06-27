import type { CommandContext } from "../../../domain/types.ts";
import { handleConnector, handleMcp } from "./mcp/connector.ts";
import { handlePermissions } from "./mcp/permissions.ts";
import { handleReview, handleTask } from "./mcp/task.ts";

/** MCP-related slash-command handlers keyed by command name. */
export const MCP_HANDLERS: Record<
  string,
  (args: string, ctx: CommandContext) => Promise<void>
> = {
  task: handleTask,
  permissions: handlePermissions,
  mcp: handleMcp,
  connector: handleConnector,
  review: handleReview,
};

export { handleConnector, handleMcp, handlePermissions, handleReview, handleTask };
