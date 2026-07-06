/**
 * Effect Schema versions of tool argument shapes.
 *
 * These mirror the Zod schemas used by the MCP SDK boundary in
 * `internal/mcpServer.ts` and are intended for internal validation,
 * type derivation, and any future Effect-native tool handling.
 *
 * @module
 */
import { Schema } from "effect";

// ---------------------------------------------------------------------------
// read_file
// ---------------------------------------------------------------------------

export const ReadFileArgsSchema = Schema.Struct({
  path: Schema.String.annotations({ description: "Repo-relative file path." }),
  start_line: Schema.optional(
    Schema.Number.annotations({ description: "1-based line number to start reading." }),
  ),
  max_lines: Schema.optional(
    Schema.Number.annotations({ description: "Maximum number of lines to read." }),
  ),
});
export type ReadFileArgs = Schema.Schema.Type<typeof ReadFileArgsSchema>;

// ---------------------------------------------------------------------------
// grep_code
// ---------------------------------------------------------------------------

export const GrepCodeArgsSchema = Schema.Struct({
  pattern: Schema.String.annotations({ description: "The ripgrep search pattern." }),
  path: Schema.String.annotations({ description: "Repo-relative path to search." }),
  glob: Schema.optional(
    Schema.String.annotations({ description: "Optional ripgrep glob, e.g. '*.ts'." }),
  ),
});
export type GrepCodeArgs = Schema.Schema.Type<typeof GrepCodeArgsSchema>;

// ---------------------------------------------------------------------------
// apply_patch
// ---------------------------------------------------------------------------

export const ApplyPatchArgsSchema = Schema.Struct({
  patch: Schema.String.annotations({
    description: "Unified diff patch compatible with git apply.",
  }),
});
export type ApplyPatchArgs = Schema.Schema.Type<typeof ApplyPatchArgsSchema>;

// ---------------------------------------------------------------------------
// run_tests
// ---------------------------------------------------------------------------

export const RunTestsArgsSchema = Schema.Struct({
  command: Schema.String.annotations({
    description: "Allowed test command, e.g. 'npm test' or 'pytest'.",
  }),
});
export type RunTestsArgs = Schema.Schema.Type<typeof RunTestsArgsSchema>;

// ---------------------------------------------------------------------------
// git_diff (no parameters)
// ---------------------------------------------------------------------------

export const GitDiffArgsSchema = Schema.Struct({});
export type GitDiffArgs = Schema.Schema.Type<typeof GitDiffArgsSchema>;

// ---------------------------------------------------------------------------
// chatgpt_list_attachments
// ---------------------------------------------------------------------------

export const ListAttachmentsArgsSchema = Schema.Struct({
  conversationId: Schema.optional(
    Schema.String.annotations({ description: "Optional ChatGPT conversation id." }),
  ),
});
export type ListAttachmentsArgs = Schema.Schema.Type<typeof ListAttachmentsArgsSchema>;

// ---------------------------------------------------------------------------
// chatgpt_download_attachment
// ---------------------------------------------------------------------------

export const DownloadAttachmentArgsSchema = Schema.Struct({
  conversationId: Schema.optional(
    Schema.String.annotations({ description: "Optional ChatGPT conversation id." }),
  ),
  id: Schema.String.annotations({ description: "Attachment id from chatgpt_list_attachments." }),
  outDir: Schema.optional(
    Schema.String.annotations({
      description:
        "Optional output directory; defaults to the repo-local .bridge/downloads/<conversationId> (git-ignored).",
    }),
  ),
});
export type DownloadAttachmentArgs = Schema.Schema.Type<typeof DownloadAttachmentArgsSchema>;

// ---------------------------------------------------------------------------
// chatgpt_download_all
// ---------------------------------------------------------------------------

export const DownloadAllAttachmentsArgsSchema = Schema.Struct({
  conversationId: Schema.optional(
    Schema.String.annotations({ description: "Optional ChatGPT conversation id." }),
  ),
  outDir: Schema.optional(
    Schema.String.annotations({
      description:
        "Optional output directory; defaults to the repo-local .bridge/downloads/<conversationId> (git-ignored).",
    }),
  ),
  ids: Schema.optional(
    Schema.Array(Schema.String).annotations({
      description: "Optional attachment ids to download.",
    }),
  ),
});
export type DownloadAllAttachmentsArgs = Schema.Schema.Type<
  typeof DownloadAllAttachmentsArgsSchema
>;
