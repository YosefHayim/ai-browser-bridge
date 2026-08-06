/** Common CLI flags shared by interactive and headless commands. */
export type CliOptions = {
  /** Target repository path. */
  readonly repo?: string;
  /** MCP listen port. */
  readonly port?: string;
  /** Browser provider id. */
  readonly provider?: string;
};

/**
 * Flags selecting which Chrome debug session a command drives. Set both to run a
 * second signed-in account in parallel (e.g. Brave on 9222 + Chrome on 9223).
 */
export type BrowserTargetOptions = {
  /** Chrome remote-debugging port to attach/spawn on. Defaults to the shared bridge port (9222). */
  readonly debugPort?: string;
  /** Chrome user-data-dir to attach/spawn. Defaults to the shared bridge profile root. */
  readonly profile?: string;
};

/** Options for the non-interactive `bridge ask` command. */
export type AskOptions = CliOptions &
  BrowserTargetOptions & {
    /** Start a fresh conversation before sending. */
    readonly fresh?: boolean;
    /** Switch model before sending (e.g. "GPT-4o" or "Gemini Flash"). */
    readonly model?: string;
    /** Bring up the tunnel + connector so ChatGPT can call local MCP tools. */
    readonly tools?: boolean;
    /** Emit a JSON object instead of plain reply text. */
    readonly json?: boolean;
    /** Max seconds to wait for the reply. */
    readonly timeout?: string;
    /** Conversation id or full ChatGPT URL to open before asking (omit with --fresh). */
    readonly conversation?: string;
    /** Repo-relative image paths to attach in ChatGPT before sending the prompt. */
    readonly attach?: readonly string[];
    /** Number of images to wait for when the prompt asks ChatGPT to generate images. */
    readonly images?: string;
    /** With a multi-provider fan-out, exit non-zero if any provider fails (default: only if all fail). */
    readonly strict?: boolean;
    /** Fan-out task file, `@file`, or inline JSON array; runs several Conversations at once. */
    readonly fanOut?: string;
    /** Fan-out: max Conversations in flight at once (default 1 — serial). */
    readonly maxConcurrency?: string;
    /** Fan-out: max tasks to run and return per call (pagination window). */
    readonly limit?: string;
    /** Fan-out: tasks to skip before running (pagination cursor). */
    readonly offset?: string;
    /** Fan-out: truncate each reply to this many characters for context safety. */
    readonly maxReplyChars?: string;
  };

/** Options for the `bridge serve` outbound MCP gateway command. */
export type ServeOptions = CliOptions & {
  /** Default per-provider reply timeout in seconds when a caller omits it. */
  readonly timeout?: string;
};

/** Options for the non-interactive `bridge download` command. */
export type DownloadCmdOptions = CliOptions &
  BrowserTargetOptions & {
    /** Conversation id to read from; defaults to the current page's `/c/<id>`. */
    readonly conversation?: string;
    /** Output directory; defaults to `<repo>/.bridge/downloads/<conversationId>`. */
    readonly out?: string;
    /** Specific attachment id(s); omit to download every attachment. */
    readonly id?: readonly string[];
    /** Rescan conversation attachments into manifest without downloading files. */
    readonly scan?: boolean;
    /** Emit a JSON array of results instead of plain lines. */
    readonly json?: boolean;
  };

/** Shape of a single attachment download outcome, success or failure. */
export type DownloadResult = {
  readonly id?: string;
  readonly path: string;
  readonly bytes: number;
  readonly error?: string;
};

/** Options for the non-interactive `bridge chrome start` command. */
export type ChromeStartOptions = BrowserTargetOptions & {
  readonly repo?: string;
  readonly provider?: string;
};

/** Options for `bridge status` and `bridge chrome status`. */
export type BrowserStatusOptions = {
  /** Emit JSON instead of human-readable lines. */
  readonly json?: boolean;
};

/** Options for `bridge cache` subcommands. */
export type CacheCmdOptions = {
  /** Chrome profile root; defaults to the shared bridge profile root. */
  readonly profile?: string;
  /** Emit JSON instead of human-readable lines. */
  readonly json?: boolean;
  /** Preview deletions without removing files. */
  readonly dryRun?: boolean;
  /** Confirm destructive cache pruning. */
  readonly yes?: boolean;
};

/** Options for `bridge project` subcommands (ChatGPT Projects). */
export type ProjectCmdOptions = CliOptions &
  BrowserTargetOptions & {
    /** Emit JSON instead of human-readable lines. */
    readonly json?: boolean;
    /** Optional project instructions applied on create. */
    readonly instructions?: string;
    /** New name for `project rename`. */
    readonly to?: string;
    /** Confirm `project delete` (permanently deletes the project's chats). */
    readonly yes?: boolean;
  };

/** Options for `bridge chat` subcommands (list / move conversations). */
export type ChatCmdOptions = CliOptions &
  BrowserTargetOptions & {
    /** Emit JSON instead of human-readable lines. */
    readonly json?: boolean;
    /** List only loose, project-less conversations (the sidebar Recents). */
    readonly orphans?: boolean;
    /** Destination project name for `chat move`. */
    readonly project?: string;
    /** Conversation ids for one multi-chat move or archive operation. */
    readonly id?: readonly string[];
    /** Maximum search results. */
    readonly limit?: string;
    /** Open the best search match in the browser. */
    readonly open?: boolean;
  };

/** Options for `bridge task` subcommands (ChatGPT Scheduled tasks). */
export type TaskCmdOptions = CliOptions &
  BrowserTargetOptions & {
    /** Emit JSON instead of human-readable lines. */
    readonly json?: boolean;
    /** Recurring cadence phrase, e.g. "day" or "weekday at 9am". */
    readonly every?: string;
    /** One-off run time phrase, e.g. "tomorrow at 9am". */
    readonly at?: string;
  };

/** Options for `bridge chatgpt` subcommands (render-state recon; ChatGPT only). */
export type ChatgptCmdOptions = CliOptions & {
  /** Emit JSON instead of human-readable lines. */
  readonly json?: boolean;
  /** Report every ChatGPT tab in the browser instead of just the active one. */
  readonly allTabs?: boolean;
};

/** Options for `bridge flow` subcommands (Google Flow / Veo asset CRUD). */
export type FlowCmdOptions = CliOptions &
  BrowserTargetOptions & {
    /** Emit JSON instead of human-readable lines. */
    readonly json?: boolean;
    /** Target clip id(s) for download/delete/rename/extend/reuse (variadic → always an array). */
    readonly id?: readonly string[];
    /** New name for the rename verbs. */
    readonly name?: string;
    /** Output directory for downloads (default: `<repo>/.bridge/downloads/flow`). */
    readonly out?: string;
    /** Confirm a destructive verb (delete clip / delete project). */
    readonly yes?: boolean;
    /** Start keyframe image path for `bridge flow generate` (image-to-video). */
    readonly start?: string;
    /** Shot / motion prompt for `bridge flow generate`. */
    readonly prompt?: string;
  };
