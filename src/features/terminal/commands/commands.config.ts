/** Slash-command metadata without handler functions. */
export interface CommandMeta {
  /** Primary command name (without `/`). */
  name: string;
  /** One-line description for `/help`. */
  description: string;
  /** Optional alternate names that resolve to this command. */
  aliases?: string[];
}

/** Session, transcript, and checkpoint command metadata. */
export const SESSION_COMMANDS: CommandMeta[] = [
  { name: "conversations", description: "List and open ChatGPT conversations" },
  { name: "resume", aliases: ["open"], description: "Resume a browser conversation or local session" },
  { name: "sessions", description: "List local bridge sessions" },
  { name: "transcript", description: "Print local session transcript" },
  { name: "copy", description: "Copy local session transcript to clipboard" },
  { name: "export", description: "Export local session transcript" },
  { name: "checkpoints", description: "List file checkpoints" },
  { name: "restore", description: "Restore files from a checkpoint" },
  { name: "rewind", aliases: ["retry"], description: "Edit the last prompt, or restore checkpoint files" },
];

/** Model and context-window command metadata. */
export const MODEL_COMMANDS: CommandMeta[] = [
  { name: "model", description: "Show or switch the ChatGPT model" },
  { name: "context", description: "Show context window usage" },
];

/** MCP connector, permissions, and project-task command metadata. */
export const MCP_COMMANDS: CommandMeta[] = [
  { name: "task", aliases: ["work"], description: "Send a project-agent task with MCP tool instructions" },
  { name: "permissions", description: "Show or switch MCP permission mode" },
  { name: "mcp", description: "Show MCP connector setup and exposed tools" },
  { name: "connector", description: "Open ChatGPT MCP connector setup" },
  { name: "review", description: "Ask ChatGPT to review local changes" },
];

/** Browser orchestration and terminal UI command metadata. */
export const BROWSER_COMMANDS: CommandMeta[] = [
  { name: "help", description: "List all available commands" },
  { name: "new", description: "Start a new ChatGPT conversation" },
  { name: "stop", description: "Stop the active ChatGPT response" },
  { name: "compact", description: "Ask ChatGPT for a concise progress summary" },
  { name: "commands", description: "List project/user custom commands" },
  { name: "logs", description: "Show the local bridge log file path" },
  { name: "status", description: "Show bridge status" },
  { name: "statusline", description: "Show status bar fields" },
  { name: "clear", description: "Clear the terminal chat view" },
  { name: "attach-image", description: "Attach a repo image file to ChatGPT" },
  { name: "screenshot", description: "Capture desktop/mobile screenshots for a URL" },
  { name: "ui-qa", description: "Capture UI screenshots and ask ChatGPT to review them" },
  { name: "diff", description: "Show current git diff" },
  { name: "exit", description: "Shutdown the bridge" },
];
