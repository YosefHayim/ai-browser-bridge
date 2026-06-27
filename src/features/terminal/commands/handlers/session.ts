import type { CommandContext } from "../../../domain/types.ts";
import { handleCheckpoints, handleRestore, handleRewind } from "./session/checkpoints.ts";
import { handleConversations } from "./session/conversations.ts";
import { handleSessions } from "./session/list-sessions.ts";
import { handleResume } from "./session/resume.ts";
import { handleCopy, handleExport, handleTranscript } from "./session/transcript.ts";

/** Session-related slash-command handlers keyed by command name. */
export const SESSION_HANDLERS: Record<
  string,
  (args: string, ctx: CommandContext) => Promise<void>
> = {
  conversations: handleConversations,
  resume: handleResume,
  sessions: handleSessions,
  transcript: handleTranscript,
  copy: handleCopy,
  export: handleExport,
  checkpoints: handleCheckpoints,
  restore: handleRestore,
  rewind: handleRewind,
};

export {
  handleCheckpoints,
  handleConversations,
  handleCopy,
  handleExport,
  handleRestore,
  handleResume,
  handleRewind,
  handleSessions,
  handleTranscript,
};
