import type { Page } from "playwright";
import { z } from "zod";
import { loadManifest } from "../../browser/attachments.ts";
import type { Attachment, ToolDef, ToolResult } from "../../types/types.ts";

const DOWNLOADER_MODULE = "../../browser/attachment-downloader.ts";

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

interface SingleDownloadResult {
  path: string;
  bytes: number;
}

/** MCP tool for listing attachments captured in the active ChatGPT conversation. */
export const listAttachmentsTool: ToolDef = {
  name: "chatgpt_list_attachments",
  description: "List captured attachments in a ChatGPT conversation, including their assistant/user role.",
  annotations: {
    title: "List ChatGPT attachments",
    readOnlyHint: true,
    openWorldHint: false,
  },
  parameters: {
    conversationId: z.string().optional().describe("Optional ChatGPT conversation id. Defaults to the active browser conversation."),
  },
  handler: async (args) => {
    const conversationId = resolveConversationId(args);
    const manifest = await loadManifest(conversationId);
    return jsonResult(manifest.attachments);
  },
};

/** MCP tool for downloading one captured ChatGPT attachment. */
export const downloadAttachmentTool: ToolDef = {
  name: "chatgpt_download_attachment",
  description: "Download one captured attachment from the active ChatGPT conversation.",
  annotations: {
    title: "Download ChatGPT attachment",
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  parameters: {
    conversationId: z.string().optional().describe("Optional ChatGPT conversation id. Defaults to the active browser conversation."),
    id: z.string().describe("Attachment id from chatgpt_list_attachments."),
    outDir: z.string().optional().describe("Optional output directory."),
  },
  handler: async (args) => {
    const page = resolvePage(args);
    const conversationId = resolveConversationId(args);
    const id = String(args.id);
    const outDir = optionalString(args.outDir);
    const downloader = await loadDownloader();
    const raw = await downloader.downloadAttachment(page, conversationId, id, outDir ? { outDir } : undefined);
    return jsonResult(normalizeSingleDownloadResult(raw));
  },
};

/** MCP tool for downloading all or selected captured ChatGPT attachments. */
export const downloadAllAttachmentsTool: ToolDef = {
  name: "chatgpt_download_all",
  description: "Download all or selected captured attachments from the active ChatGPT conversation.",
  annotations: {
    title: "Download all ChatGPT attachments",
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  parameters: {
    conversationId: z.string().optional().describe("Optional ChatGPT conversation id. Defaults to the active browser conversation."),
    outDir: z.string().optional().describe("Optional output directory."),
    ids: z.array(z.string()).optional().describe("Optional attachment ids to download."),
  },
  handler: async (args) => {
    const page = resolvePage(args);
    const conversationId = resolveConversationId(args);
    const outDir = optionalString(args.outDir);
    const ids = Array.isArray(args.ids) ? args.ids.filter((id): id is string => typeof id === "string") : undefined;
    const downloader = await loadDownloader();
    const raw = await downloader.downloadAll(page, conversationId, {
      ...(outDir ? { outDir } : {}),
      ...(ids ? { ids } : {}),
    });
    return jsonResult(normalizeDownloadAll(raw));
  },
};

/** All ChatGPT attachment MCP tools. */
export const attachmentTools: readonly ToolDef[] = [
  listAttachmentsTool,
  downloadAttachmentTool,
  downloadAllAttachmentsTool,
];

function resolveConversationId(args: Record<string, unknown>): string {
  const explicit = optionalString(args.conversationId);
  if (explicit) return explicit;
  const page = optionalPage(args._page);
  if (!page) throw new Error("No active ChatGPT browser page is available.");
  const match = /\/c\/([^/?#]+)/.exec(page.url());
  return match?.[1] ?? "current";
}

function resolvePage(args: Record<string, unknown>): Page {
  const page = optionalPage(args._page);
  if (!page) throw new Error("No active ChatGPT browser page is available.");
  return page;
}

function optionalPage(value: unknown): Page | null {
  if (!isRecord(value) || typeof value.url !== "function") return null;
  return value as unknown as Page;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

async function loadDownloader(): Promise<AttachmentDownloaderModule> {
  return await import(DOWNLOADER_MODULE) as AttachmentDownloaderModule;
}

function jsonResult(value: Attachment[] | SingleDownloadResult | DownloadResult[]): ToolResult {
  return { ok: true, output: JSON.stringify(value) };
}

function normalizeSingleDownloadResult(value: unknown): SingleDownloadResult {
  if (isRecord(value)) {
    return {
      path: typeof value.path === "string" ? value.path : "",
      bytes: typeof value.bytes === "number" ? value.bytes : 0,
    };
  }
  return { path: String(value), bytes: 0 };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
