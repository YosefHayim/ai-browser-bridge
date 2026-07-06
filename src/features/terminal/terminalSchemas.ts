/**
 * Effect Schema definitions for the terminal feature.
 *
 * These schemas provide runtime validation and type derivation for the CLI
 * option interfaces consumed by Commander commands and the headless runners.
 * The existing implementations (`cliRunner.ts`, `registerCli.ts`) remain
 * unchanged — these schemas are additive and exported through the door.
 *
 * @module
 */
import { Schema } from "effect";

// ---------------------------------------------------------------------------
// CommonCliOptions
// ---------------------------------------------------------------------------

/**
 * Schema for the common CLI flags shared by interactive and headless commands.
 */
export const CommonCliOptionsSchema = Schema.Struct({
  repo: Schema.optional(Schema.String).annotations({
    description: "Target repository path.",
  }),
  port: Schema.optional(Schema.String).annotations({
    description: "MCP listen port.",
  }),
  provider: Schema.optional(Schema.String).annotations({
    description: "Browser provider id.",
  }),
});

/**
 * CommonCliOptions type derived from the schema.
 */
export type CommonCliOptionsFromSchema = Schema.Schema.Type<typeof CommonCliOptionsSchema>;

// ---------------------------------------------------------------------------
// AskOptions
// ---------------------------------------------------------------------------

/**
 * Schema for the non-interactive `bridge ask` command options.
 */
export const AskOptionsSchema = Schema.Struct({
  repo: Schema.optional(Schema.String).annotations({
    description: "Target repository path.",
  }),
  port: Schema.optional(Schema.String).annotations({
    description: "MCP listen port.",
  }),
  provider: Schema.optional(Schema.String).annotations({
    description: "Browser provider id.",
  }),
  fresh: Schema.optional(Schema.Boolean).annotations({
    description: "Start a fresh conversation before sending.",
  }),
  model: Schema.optional(Schema.String).annotations({
    description: 'Switch model before sending (e.g. "GPT-4o" or "Gemini Flash").',
  }),
  tools: Schema.optional(Schema.Boolean).annotations({
    description: "Bring up the tunnel + connector so ChatGPT can call local MCP tools.",
  }),
  json: Schema.optional(Schema.Boolean).annotations({
    description: "Emit a JSON object instead of plain reply text.",
  }),
  timeout: Schema.optional(Schema.String).annotations({
    description: "Max seconds to wait for the reply.",
  }),
  conversation: Schema.optional(Schema.String).annotations({
    description: "Conversation id or full ChatGPT URL to open before asking (omit with --fresh).",
  }),
  attach: Schema.optional(Schema.Array(Schema.String)).annotations({
    description: "Repo-relative image paths to attach in ChatGPT before sending the prompt.",
  }),
  images: Schema.optional(Schema.String).annotations({
    description: "Number of images to wait for when the prompt asks ChatGPT to generate images.",
  }),
  strict: Schema.optional(Schema.Boolean).annotations({
    description:
      "With a multi-provider fan-out, exit non-zero if any provider fails (default: only if all fail).",
  }),
});

/**
 * AskOptions type derived from the schema.
 */
export type AskOptionsFromSchema = Schema.Schema.Type<typeof AskOptionsSchema>;

// ---------------------------------------------------------------------------
// ServeOptions
// ---------------------------------------------------------------------------

/**
 * Schema for the `bridge serve` outbound MCP gateway command options.
 */
export const ServeOptionsSchema = Schema.Struct({
  repo: Schema.optional(Schema.String).annotations({
    description: "Target repository path.",
  }),
  port: Schema.optional(Schema.String).annotations({
    description: "MCP listen port.",
  }),
  provider: Schema.optional(Schema.String).annotations({
    description: "Browser provider id.",
  }),
  timeout: Schema.optional(Schema.String).annotations({
    description: "Default per-provider reply timeout in seconds when a caller omits it.",
  }),
});

/**
 * ServeOptions type derived from the schema.
 */
export type ServeOptionsFromSchema = Schema.Schema.Type<typeof ServeOptionsSchema>;

// ---------------------------------------------------------------------------
// DownloadCmdOptions
// ---------------------------------------------------------------------------

/**
 * Schema for the non-interactive `bridge download` command options.
 */
export const DownloadCmdOptionsSchema = Schema.Struct({
  repo: Schema.optional(Schema.String).annotations({
    description: "Target repository path.",
  }),
  port: Schema.optional(Schema.String).annotations({
    description: "MCP listen port.",
  }),
  provider: Schema.optional(Schema.String).annotations({
    description: "Browser provider id.",
  }),
  conversation: Schema.optional(Schema.String).annotations({
    description: "Conversation id to read from; defaults to the current page's `/c/<id>`.",
  }),
  out: Schema.optional(Schema.String).annotations({
    description: "Output directory; defaults to `./downloads/<conversationId>` when omitted.",
  }),
  id: Schema.optional(Schema.Array(Schema.String)).annotations({
    description: "Specific attachment id(s); omit to download every attachment.",
  }),
  scan: Schema.optional(Schema.Boolean).annotations({
    description: "Rescan conversation attachments into manifest without downloading files.",
  }),
  json: Schema.optional(Schema.Boolean).annotations({
    description: "Emit a JSON array of results instead of plain lines.",
  }),
});

/**
 * DownloadCmdOptions type derived from the schema.
 */
export type DownloadCmdOptionsFromSchema = Schema.Schema.Type<typeof DownloadCmdOptionsSchema>;

// ---------------------------------------------------------------------------
// ChromeStartOptions
// ---------------------------------------------------------------------------

/**
 * Schema for the non-interactive `bridge chrome start` command options.
 */
export const ChromeStartOptionsSchema = Schema.Struct({
  repo: Schema.optional(Schema.String).annotations({
    description: "Target repository path.",
  }),
  provider: Schema.optional(Schema.String).annotations({
    description: "Browser provider id to open.",
  }),
});

/**
 * ChromeStartOptions type derived from the schema.
 */
export type ChromeStartOptionsFromSchema = Schema.Schema.Type<typeof ChromeStartOptionsSchema>;

// ---------------------------------------------------------------------------
// BrowserStatusOptions
// ---------------------------------------------------------------------------

/**
 * Schema for `bridge status` and `bridge chrome status` options.
 */
export const BrowserStatusOptionsSchema = Schema.Struct({
  json: Schema.optional(Schema.Boolean).annotations({
    description: "Emit JSON instead of human-readable lines.",
  }),
});

/**
 * BrowserStatusOptions type derived from the schema.
 */
export type BrowserStatusOptionsFromSchema = Schema.Schema.Type<typeof BrowserStatusOptionsSchema>;

// ---------------------------------------------------------------------------
// CacheCmdOptions
// ---------------------------------------------------------------------------

/**
 * Schema for `bridge cache` subcommand options.
 */
export const CacheCmdOptionsSchema = Schema.Struct({
  profile: Schema.optional(Schema.String).annotations({
    description: "Chrome profile root; defaults to the shared bridge profile.",
  }),
  json: Schema.optional(Schema.Boolean).annotations({
    description: "Emit JSON instead of human-readable lines.",
  }),
  dryRun: Schema.optional(Schema.Boolean).annotations({
    description: "Preview deletions without removing files.",
  }),
  yes: Schema.optional(Schema.Boolean).annotations({
    description: "Confirm destructive generated-cache pruning.",
  }),
});

/**
 * CacheCmdOptions type derived from the schema.
 */
export type CacheCmdOptionsFromSchema = Schema.Schema.Type<typeof CacheCmdOptionsSchema>;

// ---------------------------------------------------------------------------
// ProjectCmdOptions
// ---------------------------------------------------------------------------

/**
 * Schema for `bridge project` subcommand options (ChatGPT Projects).
 */
export const ProjectCmdOptionsSchema = Schema.Struct({
  repo: Schema.optional(Schema.String).annotations({
    description: "Target repository path.",
  }),
  port: Schema.optional(Schema.String).annotations({
    description: "MCP listen port.",
  }),
  provider: Schema.optional(Schema.String).annotations({
    description: "Browser provider id.",
  }),
  json: Schema.optional(Schema.Boolean).annotations({
    description: "Emit JSON instead of human-readable lines.",
  }),
  instructions: Schema.optional(Schema.String).annotations({
    description: "Optional project instructions applied on create.",
  }),
});

/**
 * ProjectCmdOptions type derived from the schema.
 */
export type ProjectCmdOptionsFromSchema = Schema.Schema.Type<typeof ProjectCmdOptionsSchema>;

// ---------------------------------------------------------------------------
// ChatCmdOptions
// ---------------------------------------------------------------------------

/**
 * Schema for `bridge chat` subcommand options (list / move conversations).
 */
export const ChatCmdOptionsSchema = Schema.Struct({
  repo: Schema.optional(Schema.String).annotations({
    description: "Target repository path.",
  }),
  port: Schema.optional(Schema.String).annotations({
    description: "MCP listen port.",
  }),
  provider: Schema.optional(Schema.String).annotations({
    description: "Browser provider id.",
  }),
  json: Schema.optional(Schema.Boolean).annotations({
    description: "Emit JSON instead of human-readable lines.",
  }),
  orphans: Schema.optional(Schema.Boolean).annotations({
    description: "List only loose, project-less conversations (the sidebar Recents).",
  }),
  project: Schema.optional(Schema.String).annotations({
    description: "Destination project name for `chat move`.",
  }),
  limit: Schema.optional(Schema.String).annotations({
    description: "Maximum search results.",
  }),
  open: Schema.optional(Schema.Boolean).annotations({
    description: "Open the best search match in the browser.",
  }),
});

/**
 * ChatCmdOptions type derived from the schema.
 */
export type ChatCmdOptionsFromSchema = Schema.Schema.Type<typeof ChatCmdOptionsSchema>;

// ---------------------------------------------------------------------------
// TaskCmdOptions
// ---------------------------------------------------------------------------

/**
 * Schema for `bridge task` subcommand options (ChatGPT Scheduled tasks).
 */
export const TaskCmdOptionsSchema = Schema.Struct({
  repo: Schema.optional(Schema.String).annotations({
    description: "Target repository path.",
  }),
  port: Schema.optional(Schema.String).annotations({
    description: "MCP listen port.",
  }),
  provider: Schema.optional(Schema.String).annotations({
    description: "Browser provider id.",
  }),
  json: Schema.optional(Schema.Boolean).annotations({
    description: "Emit JSON instead of human-readable lines.",
  }),
  every: Schema.optional(Schema.String).annotations({
    description: 'Recurring cadence phrase, e.g. "day" or "weekday at 9am".',
  }),
  at: Schema.optional(Schema.String).annotations({
    description: 'One-off run time phrase, e.g. "tomorrow at 9am".',
  }),
});

/**
 * TaskCmdOptions type derived from the schema.
 */
export type TaskCmdOptionsFromSchema = Schema.Schema.Type<typeof TaskCmdOptionsSchema>;

// ---------------------------------------------------------------------------
// DownloadResult
// ---------------------------------------------------------------------------

/**
 * Schema for a single attachment download outcome, success or failure.
 */
export const DownloadResultSchema = Schema.Struct({
  id: Schema.optional(Schema.String).annotations({
    description: "Attachment identifier.",
  }),
  path: Schema.String.annotations({
    description: "Local file path where the download was saved.",
  }),
  bytes: Schema.Number.annotations({
    description: "Size in bytes of the downloaded file.",
  }),
  error: Schema.optional(Schema.String).annotations({
    description: "Error message if the download failed.",
  }),
});

/**
 * DownloadResult type derived from the schema.
 */
export type DownloadResultFromSchema = Schema.Schema.Type<typeof DownloadResultSchema>;
