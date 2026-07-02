import { PERMISSION_MODES } from "../../../domain/permissions.ts";
import type { CommandSuggestionRule } from "./types.ts";

/** Suggestion rules keyed by built-in slash command name. */
export const COMMAND_SUGGESTION_RULES: Record<string, CommandSuggestionRule> = {
  help: { title: "Help", hint: "Press Enter to list commands." },
  conversations: {
    title: "Conversations",
    hint: "Press Enter to list browser conversations, or type a title/id filter.",
  },
  resume: {
    title: "Resume",
    hint: "Choose --last, a local session id, or type a browser conversation title/id.",
  },
  open: {
    title: "Resume",
    hint: "Alias for /resume. Choose --last, a local session id, or type a browser conversation title/id.",
  },
  new: { title: "New Conversation", hint: "Press Enter to start a new ChatGPT conversation." },
  model: { title: "Models", hint: "Choose a known model label, or type a browser model name." },
  rewind: {
    title: "Rewind",
    hint: "Type replacement prompt text, or choose --files/--both then a checkpoint id.",
  },
  retry: {
    title: "Rewind",
    hint: "Alias for /rewind. Type replacement prompt text, or choose --files/--both then a checkpoint id.",
  },
  stop: { title: "Stop", hint: "Press Enter to stop the active ChatGPT response." },
  compact: { title: "Compact", hint: "Press Enter to ask ChatGPT for a concise progress summary." },
  task: { title: "Task", hint: "Type the project task. Use @ to mention files and folders." },
  work: {
    title: "Task",
    hint: "Alias for /task. Type the project task. Use @ to mention files and folders.",
  },
  commands: { title: "Custom Commands", hint: "Press Enter to list project/user custom commands." },
  context: { title: "Context", hint: "Press Enter to show context usage." },
  logs: { title: "Logs", hint: "Press Enter to show today's local bridge log path." },
  sessions: { title: "Sessions", hint: "Press Enter to list local bridge sessions." },
  transcript: {
    title: "Transcript",
    hint: "Choose a local session id, or press Enter for the current session.",
  },
  copy: {
    title: "Copy",
    hint: "Choose a local session id, or press Enter for the current session transcript.",
  },
  export: {
    title: "Export",
    hint: "Choose a session id, or type an output path ending in .md, .json, or .jsonl.",
  },
  permissions: {
    title: "Permissions",
    hint: "Choose the MCP tool permission mode.",
    values: PERMISSION_MODES.map((mode) => ({
      value: mode,
      label: mode,
      kind: "mode" as const,
      detail:
        mode === "auto"
          ? "allow narrow write/test tools"
          : mode === "ask"
            ? "block until confirmation exists"
            : "read tools only",
    })),
  },
  checkpoints: { title: "Checkpoints", hint: "Press Enter to list file checkpoints." },
  restore: {
    title: "Restore",
    hint: "Choose a checkpoint id, then optionally type repo paths to restore.",
  },
  review: {
    title: "Review",
    hint: "Choose review scope.",
    values: [
      { value: "working", label: "working", kind: "scope", detail: "review current working tree" },
      { value: "base", label: "base", kind: "scope", detail: "review against base branch" },
      { value: "commit", label: "commit", kind: "scope", detail: "review a commit" },
    ],
  },
  status: { title: "Status", hint: "Press Enter to show bridge status." },
  statusline: { title: "Statusline", hint: "Press Enter to show status bar fields." },
  mcp: {
    title: "MCP",
    hint: "Press Enter to show connector setup, exposed tools, and troubleshooting steps.",
  },
  connector: {
    title: "Connector",
    hint: "Press Enter to open ChatGPT Apps setup and fill the current Connector URL when possible.",
  },
  clear: {
    title: "Clear",
    hint: "Press Enter to clear the terminal chat view. Browser conversation and logs remain unchanged.",
  },
  "attach-image": {
    title: "Attach Image",
    hint: "Choose a repo image file. Directories are shown for navigation.",
  },
  screenshot: {
    title: "Screenshot",
    hint: "Type a http:// or https:// URL to capture desktop/mobile screenshots.",
    values: [{ value: "https://", label: "https://", kind: "url" }],
  },
  "ui-qa": {
    title: "UI QA",
    hint: "Type a http:// or https:// URL to capture screenshots and request UI review.",
    values: [{ value: "https://", label: "https://", kind: "url" }],
  },
  diff: { title: "Diff", hint: "Press Enter to ask ChatGPT to inspect the current git diff." },
  files: {
    title: "Files",
    hint: "Press Enter to list attachments, or type get <id> / get all [--out <dir>] to download.",
    values: [
      {
        value: "get",
        label: "get",
        kind: "text",
        detail: "download an attachment by id, or 'all'",
      },
      { value: "get all", label: "get all", kind: "text", detail: "download every attachment" },
      { value: "--out", label: "--out", kind: "flag", detail: "output directory for downloads" },
    ],
  },
  exit: { title: "Exit", hint: "Press Enter to shut down the bridge." },
};
