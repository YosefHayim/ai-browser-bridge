import { z } from "zod";

const DOWNLOAD_DIRECTORY_DESCRIPTION =
  "Optional output directory; defaults to the canonical repo root's .bridge/downloads/<conversationId>.";

const OPTIONAL_CONVERSATION_ID_DESCRIPTION = "Optional ChatGPT conversation id.";

export const ReadFileArgumentListSchema = z.object({
  path: z.string().describe("Repo-relative file path."),
  start_line: z.number().describe("1-based line number to start reading.").optional(),
  max_lines: z.number().describe("Maximum number of lines to read.").optional(),
});

export const GrepCodeArgumentListSchema = z.object({
  pattern: z.string().describe("The ripgrep search pattern."),
  path: z.string().describe("Repo-relative path to search."),
  glob: z.string().describe("Optional ripgrep glob, e.g. '*.ts'.").optional(),
});

export const ApplyPatchArgumentListSchema = z.object({
  patch: z.string().describe("Unified diff patch accepted by git apply."),
});

export const RunTestsArgumentListSchema = z.object({
  command: z.string().describe("Allowed test command, e.g. 'npm test' or 'pytest'."),
});

export const GitDiffArgumentListSchema = z.object({});

export const ListAttachmentsArgumentListSchema = z.object({
  conversationId: z.string().describe(OPTIONAL_CONVERSATION_ID_DESCRIPTION).optional(),
});

export const DownloadAttachmentArgumentListSchema = z.object({
  conversationId: z.string().describe(OPTIONAL_CONVERSATION_ID_DESCRIPTION).optional(),
  id: z.string().describe("Attachment id from chatgpt_list_attachments."),
  outDir: z.string().describe(DOWNLOAD_DIRECTORY_DESCRIPTION).optional(),
});

export const DownloadAllAttachmentsArgumentListSchema = z.object({
  conversationId: z.string().describe(OPTIONAL_CONVERSATION_ID_DESCRIPTION).optional(),
  outDir: z.string().describe(DOWNLOAD_DIRECTORY_DESCRIPTION).optional(),
  ids: z.array(z.string()).describe("Optional attachment ids to download.").optional(),
});
