import type { CommandContext } from "../../../domain/types.ts";
import {
  handleClear,
  handleCompact,
  handleDiff,
  handleExit,
  handleLogs,
  handleNew,
  handleStatus,
  handleStatusline,
  handleStop,
} from "./browser/general.ts";
import { handleCommands, handleHelp } from "./browser/help.ts";
import { handleAttachImage, handleScreenshot, handleUiQa } from "./browser/media.ts";

/** Browser and terminal UI slash-command handlers keyed by command name. */
export const BROWSER_HANDLERS: Record<
  string,
  (args: string, ctx: CommandContext) => Promise<void>
> = {
  help: handleHelp,
  new: handleNew,
  stop: handleStop,
  compact: handleCompact,
  commands: handleCommands,
  logs: handleLogs,
  status: handleStatus,
  statusline: handleStatusline,
  clear: handleClear,
  "attach-image": handleAttachImage,
  screenshot: handleScreenshot,
  "ui-qa": handleUiQa,
  diff: handleDiff,
  exit: handleExit,
};

export {
  handleAttachImage,
  handleClear,
  handleCommands,
  handleCompact,
  handleDiff,
  handleExit,
  handleHelp,
  handleLogs,
  handleNew,
  handleScreenshot,
  handleStatus,
  handleStatusline,
  handleStop,
  handleUiQa,
};
