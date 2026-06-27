import type { ToolDef } from "../../domain/types.ts";
import {
  jsonResult,
  normalizeDownloadAll,
  normalizeSingleDownloadResult,
  optionalString,
} from "./attachment.normalize.ts";
import { loadDownloader, resolveConversationId, resolvePage } from "./attachment.resolve.ts";
import { z } from "zod";
import { loadManifest } from "../../providers/chatgpt/attachments/extract-messages.ts";

/** MCP tool for listing attachments captured in the active ChatGPT conversation. */
export const listAttachmentsTool: ToolDef = {
  name: "chatgpt_list_attachments",
  description: "List captured attachments in a ChatGPT conversation, including their assistant/user role.",
  annotations: { title: "List ChatGPT attachments", readOnlyHint: true, openWorldHint: false },
  parameters: { conversationId: z.string().optional().describe("Optional ChatGPT conversation id.") },
  handler: async (args) => jsonResult((await loadManifest(resolveConversationId(args))).attachments),
};

/** MCP tool for downloading one captured ChatGPT attachment. */
export const downloadAttachmentTool: ToolDef = {
  name: "chatgpt_download_attachment",
  description: "Download one captured attachment from the active ChatGPT conversation.",
  annotations: { title: "Download ChatGPT attachment", readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  parameters: {
    conversationId: z.string().optional().describe("Optional ChatGPT conversation id."),
    id: z.string().describe("Attachment id from chatgpt_list_attachments."),
    outDir: z.string().optional().describe("Optional output directory."),
  },
  handler: async (args) => {
    const outDir = optionalString(args.outDir);
    const raw = await (await loadDownloader()).downloadAttachment(
      resolvePage(args),
      resolveConversationId(args),
      String(args.id),
      outDir ? { outDir } : undefined,
    );
    return jsonResult(normalizeSingleDownloadResult(raw));
  },
};

/** MCP tool for downloading all or selected captured ChatGPT attachments. */
export const downloadAllAttachmentsTool: ToolDef = {
  name: "chatgpt_download_all",
  description: "Download all or selected captured attachments from the active ChatGPT conversation.",
  annotations: { title: "Download all ChatGPT attachments", readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  parameters: {
    conversationId: z.string().optional().describe("Optional ChatGPT conversation id."),
    outDir: z.string().optional().describe("Optional output directory."),
    ids: z.array(z.string()).optional().describe("Optional attachment ids to download."),
  },
  handler: async (args) => {
    const outDir = optionalString(args.outDir);
    const ids = Array.isArray(args.ids) ? args.ids.filter((id): id is string => typeof id === "string") : undefined;
    const raw = await (await loadDownloader()).downloadAll(resolvePage(args), resolveConversationId(args), {
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
