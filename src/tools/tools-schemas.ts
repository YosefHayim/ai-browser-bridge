import { z } from "zod";

export const ReadFileArgsSchema = z.object({
  path: z.string().describe("Repo-relative file path."),
  start_line: z.number().describe("1-based line number to start reading.").optional(),
  max_lines: z.number().describe("Maximum number of lines to read.").optional(),
});

export const GrepCodeArgsSchema = z.object({
  pattern: z.string().describe("The ripgrep search pattern."),
  path: z.string().describe("Repo-relative path to search."),
  glob: z.string().describe("Optional ripgrep glob, e.g. '*.ts'.").optional(),
});

export const ApplyPatchArgsSchema = z.object({
  patch: z.string().describe("Unified diff patch accepted by git apply."),
});

export const RunTestsArgsSchema = z.object({
  command: z.string().describe("Allowed test command, e.g. 'npm test' or 'pytest'."),
});

export const GitDiffArgsSchema = z.object({});

export const ListAttachmentsArgsSchema = z.object({
  conversationId: z.string().describe("Optional ChatGPT conversation id.").optional(),
});

export const DownloadAttachmentArgsSchema = z.object({
  conversationId: z.string().describe("Optional ChatGPT conversation id.").optional(),
  id: z.string().describe("Attachment id from chatgpt_list_attachments."),
  outDir: z
    .string()
    .describe(
      "Optional output directory; defaults to the canonical repo root's .bridge/downloads/<conversationId>.",
    )
    .optional(),
});

export const DownloadAllAttachmentsArgsSchema = z.object({
  conversationId: z.string().describe("Optional ChatGPT conversation id.").optional(),
  outDir: z
    .string()
    .describe(
      "Optional output directory; defaults to the canonical repo root's .bridge/downloads/<conversationId>.",
    )
    .optional(),
  ids: z.array(z.string()).describe("Optional attachment ids to download.").optional(),
});
