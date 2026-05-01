import type { Page } from "playwright";
import { loadManifest } from "../../browser/attachments.ts";
import type { Attachment, CommandContext, CommandDef } from "../../types/types.ts";

const RED = "\u001b[31m";
const RESET = "\u001b[0m";
const DOWNLOADER_MODULE = "../../browser/attachment-downloader.ts";

interface RuntimeOrchestrator {
  page?: Page | null;
}

interface AttachmentDownloaderModule {
  downloadAttachment: (
    page: Page,
    conversationId: string,
    id: string,
    opts?: { outDir?: string },
  ) => Promise<unknown>;
  downloadAll: (
    page: Page,
    conversationId: string,
    opts?: { outDir?: string; ids?: string[] },
  ) => Promise<unknown>;
}

interface DownloadResult {
  id?: string;
  path: string;
  bytes: number;
  error?: string;
}

/** CLI slash command for listing and downloading ChatGPT attachments. */
export const filesCommand: CommandDef = {
  name: "files",
  description: "List or download ChatGPT conversation attachments",
  handler: async (args: string, ctx: CommandContext) => {
    const page = currentPage(ctx);
    const conversationId = page ? conversationIdFromPage(page) : "current";
    const manifest = await loadManifest(conversationId);
    const parts = splitArgs(args);

    if (parts.length === 0) {
      printAttachmentTable(manifest.attachments);
      return;
    }

    if (parts[0] !== "get") {
      console.log("Usage: /files [get <id>|get all [--out <dir>]]");
      return;
    }

    if (!parts[1]) {
      console.log("Usage: /files get <id> or /files get all [--out <dir>]");
      return;
    }

    if (!page) {
      printError("Browser not connected. Cannot download attachments.");
      return;
    }

    const outDir = parseOutDir(parts.slice(2));
    const downloader = await loadDownloader();

    if (parts[1] === "all") {
      const raw = await downloader.downloadAll(page, conversationId, outDir ? { outDir } : undefined);
      const results = normalizeDownloadAll(raw);
      const succeeded = results.filter((result) => !result.error).length;
      const failed = results.length - succeeded;
      console.log(`Downloaded ${succeeded}/${results.length} attachments${failed > 0 ? ` (${failed} failed)` : ""}.`);
      for (const result of results) {
        if (result.error) {
          printError(`${result.id ?? "unknown"}: ${result.error}`);
        } else {
          console.log(`${result.id ?? "attachment"} -> ${result.path} (${result.bytes} bytes)`);
        }
      }
      return;
    }

    const id = parts[1];
    if (!manifest.attachments.some((attachment) => attachment.id === id)) {
      printError(`No attachment with id "${id}".`);
      return;
    }

    const raw = await downloader.downloadAttachment(page, conversationId, id, outDir ? { outDir } : undefined);
    const result = normalizeDownloadResult(raw, id);
    console.log(result.path);
  },
};

function currentPage(ctx: CommandContext): Page | null {
  const orchestrator = ctx.orchestrator as CommandContext["orchestrator"] & RuntimeOrchestrator;
  return orchestrator.page ?? null;
}

function conversationIdFromPage(page: Page): string {
  const match = /\/c\/([^/?#]+)/.exec(page.url());
  return match?.[1] ?? "current";
}

function printAttachmentTable(attachments: Attachment[]): void {
  if (attachments.length === 0) {
    console.log("No attachments captured in this conversation yet.");
    return;
  }

  const rows = [
    ["id", "role", "kind", "filename", "message"],
    ...attachments.map((attachment) => [
      attachment.id,
      attachment.role,
      attachment.kind,
      attachment.filename ?? "",
      String(attachment.messageIndex),
    ]),
  ];
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
  for (const row of rows) {
    console.log(row.map((cell, column) => cell.padEnd(widths[column])).join("  "));
  }
}

function printError(message: string): void {
  console.error(`${RED}${message}${RESET}`);
}

async function loadDownloader(): Promise<AttachmentDownloaderModule> {
  return await import(DOWNLOADER_MODULE) as AttachmentDownloaderModule;
}

function normalizeDownloadAll(value: unknown): DownloadResult[] {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => normalizeDownloadResult(item, `attachment-${index + 1}`));
}

function normalizeDownloadResult(value: unknown, fallbackId: string): DownloadResult {
  if (isRecord(value)) {
    const id = typeof value.id === "string" ? value.id : fallbackId;
    const path = typeof value.path === "string" ? value.path : "";
    const bytes = typeof value.bytes === "number" ? value.bytes : 0;
    const error = typeof value.error === "string" ? value.error : undefined;
    return { id, path, bytes, error };
  }
  return { id: fallbackId, path: String(value), bytes: 0 };
}

function parseOutDir(args: string[]): string | undefined {
  const outIndex = args.indexOf("--out");
  if (outIndex === -1) return undefined;
  return args[outIndex + 1];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function splitArgs(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  for (const char of input.trim()) {
    if ((char === "'" || char === '"') && quote === null) {
      quote = char;
      continue;
    }
    if (char === quote) {
      quote = null;
      continue;
    }
    if (/\s/.test(char) && quote === null) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (current) args.push(current);
  return args;
}
