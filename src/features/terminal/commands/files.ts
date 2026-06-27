import type { Page } from "playwright";
import { loadManifest } from "../../providers/chatgpt/attachments/extract-messages.ts";
import type { CommandContext, CommandDef } from "../../domain/types.ts";
import {
  conversationIdFromPage,
  currentPage,
  printError,
} from "./files.helpers.ts";
import { printAttachmentTable, splitArgs } from "./files.format.ts";
import { handleFilesDownload } from "./files.download.helpers.ts";

/** CLI slash command for listing and downloading ChatGPT attachments. */
export const filesCommand: CommandDef = {
  name: "files",
  description: "List or download ChatGPT conversation attachments",
  handler: (...args: [string, CommandContext]) => handleFilesCommand({ args: args[0], ctx: args[1] }),
};

/** Dispatch `/files` list or download subcommands. */
async function handleFilesCommand(input: { args: string; ctx: CommandContext }): Promise<void> {
  const context = await loadFilesContext(input);
  const parts = splitArgs(input.args);
  if (parts.length === 0) return printAttachmentTable(context.manifest.attachments);
  await routeFilesDownload({ parts, context });
}

/** Load manifest and page context for `/files`. */
async function loadFilesContext(input: { args: string; ctx: CommandContext }) {
  const page = currentPage(input.ctx);
  const conversationId = page ? conversationIdFromPage(page) : "current";
  const manifest = await loadManifest(conversationId);
  return { page, conversationId, manifest };
}

/** Route `/files get` download requests or print usage errors. */
async function routeFilesDownload(input: {
  parts: string[];
  context: { page: Page | null; conversationId: string; manifest: Awaited<ReturnType<typeof loadManifest>> };
}): Promise<void> {
  if (input.parts[0] !== "get") return console.log("Usage: /files [get <id>|get all [--out <dir>]]");
  if (!input.parts[1]) return console.log("Usage: /files get <id> or /files get all [--out <dir>]");
  if (!input.context.page) return printError("Browser not connected. Cannot download attachments.");
  await handleFilesDownload({
    page: input.context.page,
    conversationId: input.context.conversationId,
    parts: input.parts,
    manifestIds: input.context.manifest.attachments.map((item) => item.id),
  });
}
