export type BuiltinCommandName =
  | "files"
  | "conversations"
  | "resume"
  | "sessions"
  | "transcript"
  | "copy"
  | "export"
  | "checkpoints"
  | "restore"
  | "rewind"
  | "model"
  | "context"
  | "task"
  | "permissions"
  | "mcp"
  | "connector"
  | "review"
  | "help"
  | "new"
  | "stop"
  | "compact"
  | "commands"
  | "logs"
  | "status"
  | "statusline"
  | "clear"
  | "attach-image"
  | "screenshot"
  | "ui-qa"
  | "diff"
  | "exit";

export type SlashCommand = {
  readonly name: BuiltinCommandName;
  readonly aliases?: readonly string[];
  readonly hidden?: boolean;
  readonly description: string;
};

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { name: "files", description: "List or download ChatGPT conversation attachments" },
  { name: "conversations", description: "List and open ChatGPT conversations" },
  {
    name: "resume",
    aliases: ["open"],
    description: "Resume a browser conversation or local session",
  },
  { name: "sessions", description: "List local bridge sessions" },
  { name: "transcript", description: "Print local session transcript" },
  { name: "copy", description: "Copy local session transcript to clipboard" },
  { name: "export", description: "Export local session transcript" },
  { name: "checkpoints", description: "List file checkpoints" },
  { name: "restore", description: "Restore files from a checkpoint" },
  {
    name: "rewind",
    aliases: ["retry"],
    description: "Edit the last prompt, or restore checkpoint files",
  },
  { name: "model", description: "Show or switch the ChatGPT model" },
  { name: "context", description: "Show context window usage" },
  {
    name: "task",
    aliases: ["work"],
    description: "Send a project-agent task with MCP tool instructions",
  },
  { name: "permissions", description: "Show or switch MCP permission mode" },
  { name: "mcp", description: "Show MCP connector setup and exposed tools" },
  { name: "connector", description: "Open ChatGPT MCP connector setup" },
  { name: "review", description: "Ask ChatGPT to review local changes" },
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
