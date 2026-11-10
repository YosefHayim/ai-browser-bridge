import { PERMISSION_MODES, type PermissionMode } from "@/domain/permissions.ts";
import type { CommandSuggestionRule } from "./types.ts";

const OUT_FLAG = "--out";

const GET_ALL_SUBCOMMAND = "get all";

const WORD_KIND = "text";

const GET_SUBCOMMAND = "get";

const URL_KIND = "url";

const HTTPS_URL_PREFIX = "https://";

const SCOPE_KIND = "scope";

const COMMIT_SCOPE = "commit";

const BASE_BRANCH_SCOPE = "base";

const WORKING_TREE_SCOPE = "working";

const TASK_TITLE = "Task";

const REWIND_TITLE = "Rewind";

const RESUME_TITLE = "Resume";

const readPermissionModeDetail = (mode: PermissionMode): string => {
  const isModeAuto = mode === "auto";
  if (isModeAuto) return "allow narrow write/test tools";

  const isModeAsk = mode === "ask";
  if (isModeAsk) return "block until confirmation exists";

  return "read tools only";
};

export const COMMAND_SUGGESTION_RULES: Record<string, CommandSuggestionRule> = {
  help: { title: "Help", hint: "Press Enter to list commands." },
  conversations: {
    title: "Conversations",
    hint: "Press Enter to list browser conversations, or type a title/id filter.",
  },
  resume: {
    title: RESUME_TITLE,
    hint: "Choose --last, a local session id, or type a browser conversation title/id.",
  },
  open: {
    title: RESUME_TITLE,
    hint: "Alias for /resume. Choose --last, a local session id, or type a browser conversation title/id.",
  },
  new: { title: "New Conversation", hint: "Press Enter to start a new ChatGPT conversation." },
  model: { title: "Models", hint: "Choose a known model label, or type a browser model name." },
  rewind: {
    title: REWIND_TITLE,
    hint: "Type replacement prompt text, or choose --files/--both then a checkpoint id.",
  },
  retry: {
    title: REWIND_TITLE,
    hint: "Alias for /rewind. Type replacement prompt text, or choose --files/--both then a checkpoint id.",
  },
  stop: { title: "Stop", hint: "Press Enter to stop the active ChatGPT response." },
  compact: { title: "Compact", hint: "Press Enter to ask ChatGPT for a concise progress summary." },
  task: { title: TASK_TITLE, hint: "Type the project task. Use @ to mention files and folders." },
  work: {
    title: TASK_TITLE,
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
      detail: readPermissionModeDetail(mode),
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
      {
        value: WORKING_TREE_SCOPE,
        label: WORKING_TREE_SCOPE,
        kind: SCOPE_KIND,
        detail: "review current working tree",
      },
      {
        value: BASE_BRANCH_SCOPE,
        label: BASE_BRANCH_SCOPE,
        kind: SCOPE_KIND,
        detail: "review against base branch",
      },
      { value: COMMIT_SCOPE, label: COMMIT_SCOPE, kind: SCOPE_KIND, detail: "review a commit" },
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
    values: [{ value: HTTPS_URL_PREFIX, label: HTTPS_URL_PREFIX, kind: URL_KIND }],
  },
  "ui-qa": {
    title: "UI QA",
    hint: "Type a http:// or https:// URL to capture screenshots and request UI review.",
    values: [{ value: HTTPS_URL_PREFIX, label: HTTPS_URL_PREFIX, kind: URL_KIND }],
  },
  diff: { title: "Diff", hint: "Press Enter to ask ChatGPT to inspect the current git diff." },
  files: {
    title: "Files",
    hint: "Press Enter to list attachments, or type get <id> / get all [--out <dir>] to download.",
    values: [
      {
        value: GET_SUBCOMMAND,
        label: GET_SUBCOMMAND,
        kind: WORD_KIND,
        detail: "download an attachment by id, or 'all'",
      },
      {
        value: GET_ALL_SUBCOMMAND,
        label: GET_ALL_SUBCOMMAND,
        kind: WORD_KIND,
        detail: "download every attachment",
      },
      { value: OUT_FLAG, label: OUT_FLAG, kind: "flag", detail: "output directory for downloads" },
    ],
  },
  exit: { title: "Exit", hint: "Press Enter to shut down the bridge." },
};
