/** Common CLI flags shared by interactive and headless commands. */
export interface CommonCliOptions {
  /** Target repository path. */
  repo?: string;
  /** MCP listen port. */
  port?: string;
  /** Browser provider id. */
  provider?: string;
}

/** Options for the non-interactive `bridge ask` command. */
export interface AskOptions extends CommonCliOptions {
  /** Start a fresh conversation before sending. */
  fresh?: boolean;
  /** Switch model before sending (e.g. "GPT-4o" or "Gemini Flash"). */
  model?: string;
  /** Bring up the tunnel + connector so ChatGPT can call local MCP tools. */
  tools?: boolean;
  /** Emit a JSON object instead of plain reply text. */
  json?: boolean;
  /** Max seconds to wait for the reply. */
  timeout?: string;
  /** Conversation id or full ChatGPT URL to open before asking (omit with --fresh). */
  conversation?: string;
  /** Repo-relative image paths to attach in ChatGPT before sending the prompt. */
  attach?: string[];
  /** Number of images to wait for when the prompt asks ChatGPT to generate images. */
  images?: string;
  /** With a multi-provider fan-out, exit non-zero if any provider fails (default: only if all fail). */
  strict?: boolean;
  /** Fan-out task file, `@file`, or inline JSON array; runs several Conversations at once. */
  batch?: string;
  /** Fan-out: max Conversations in flight at once (default 1 — serial). */
  maxConcurrency?: string;
  /** Fan-out: max tasks to run and return per call (pagination window). */
  limit?: string;
  /** Fan-out: tasks to skip before running (pagination cursor). */
  offset?: string;
  /** Fan-out: truncate each reply to this many characters for context safety. */
  maxReplyChars?: string;
}

/** Options for the `bridge serve` outbound MCP gateway command. */
export interface ServeOptions extends CommonCliOptions {
  /** Default per-provider reply timeout in seconds when a caller omits it. */
  timeout?: string;
}

/** Options for the non-interactive `bridge download` command. */
export interface DownloadCmdOptions extends CommonCliOptions {
  /** Conversation id to read from; defaults to the current page's `/c/<id>`. */
  conversation?: string;
  /** Output directory; defaults to `./downloads/<conversationId>` when omitted. */
  out?: string;
  /** Specific attachment id(s); omit to download every attachment. */
  id?: string[];
  /** Rescan conversation attachments into manifest without downloading files. */
  scan?: boolean;
  /** Emit a JSON array of results instead of plain lines. */
  json?: boolean;
}

/** Shape of a single attachment download outcome, success or failure. */
export interface DownloadResult {
  id?: string;
  path: string;
  bytes: number;
  error?: string;
}

/** Options for the non-interactive `bridge chrome start` command. */
export interface ChromeStartOptions {
  repo?: string;
  provider?: string;
}

/** Options for `bridge status` and `bridge chrome status`. */
export interface BrowserStatusOptions {
  /** Emit JSON instead of human-readable lines. */
  json?: boolean;
}

/** Options for `bridge cache` subcommands. */
export interface CacheCmdOptions {
  /** Chrome profile root; defaults to the shared bridge profile root. */
  profile?: string;
  /** Emit JSON instead of human-readable lines. */
  json?: boolean;
  /** Preview deletions without removing files. */
  dryRun?: boolean;
  /** Confirm destructive cache pruning. */
  yes?: boolean;
}

/** Options for `bridge project` subcommands (ChatGPT Projects). */
export interface ProjectCmdOptions extends CommonCliOptions {
  /** Emit JSON instead of human-readable lines. */
  json?: boolean;
  /** Optional project instructions applied on create. */
  instructions?: string;
}

/** Options for `bridge chat` subcommands (list / move conversations). */
export interface ChatCmdOptions extends CommonCliOptions {
  /** Emit JSON instead of human-readable lines. */
  json?: boolean;
  /** List only loose, project-less conversations (the sidebar Recents). */
  orphans?: boolean;
  /** Destination project name for `chat move`. */
  project?: string;
  /** Conversation id(s) for batch `chat move`/`chat archive` in one session (variadic → array). */
  id?: string[];
  /** Maximum search results. */
  limit?: string;
  /** Open the best search match in the browser. */
  open?: boolean;
}

/** Options for `bridge task` subcommands (ChatGPT Scheduled tasks). */
export interface TaskCmdOptions extends CommonCliOptions {
  /** Emit JSON instead of human-readable lines. */
  json?: boolean;
  /** Recurring cadence phrase, e.g. "day" or "weekday at 9am". */
  every?: string;
  /** One-off run time phrase, e.g. "tomorrow at 9am". */
  at?: string;
}

/** Options for `bridge flow` subcommands (Google Flow / Veo asset CRUD). */
export interface FlowCmdOptions extends CommonCliOptions {
  /** Emit JSON instead of human-readable lines. */
  json?: boolean;
  /** Target clip id(s) for download/delete/rename/extend/reuse (variadic → always an array). */
  id?: string[];
  /** New name for the rename verbs. */
  name?: string;
  /** Output directory for downloads (default: ./downloads/flow). */
  out?: string;
  /** Confirm a destructive verb (delete clip / delete project). */
  yes?: boolean;
}
