import { join, resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Schema } from "effect";
import type { Page } from "playwright";
import { downloadsDir } from "@/features/repoState/paths.ts";
import {
  addClipToPrompt,
  addClipToScene,
  clearIngredients,
  deleteClip,
  deleteFlowProject,
  downloadClip,
  listClips,
  listFlowProjects,
  listIngredients,
  removeIngredient,
  renameClip,
  renameFlowProject,
} from "@/features/webProviders/flow/flowAssets.ts";
import { generateClipFromFrame } from "@/features/webProviders/flow/flowGenerate.ts";
import { effectSchemaToMcpShape } from "@/mcpSchema.ts";
import {
  type AskToolResult,
  FlowClearIngredientsArgsSchema,
  FlowDeleteClipArgsSchema,
  FlowDeleteProjectArgsSchema,
  FlowDownloadClipsArgsSchema,
  FlowExtendClipArgsSchema,
  FlowGenerateArgsSchema,
  FlowListClipsArgsSchema,
  FlowListIngredientsArgsSchema,
  FlowListProjectsArgsSchema,
  FlowRemoveIngredientArgsSchema,
  FlowRenameClipArgsSchema,
  FlowRenameProjectArgsSchema,
  FlowReuseClipArgsSchema,
} from "../browserMcpSchemas.ts";
import {
  type BrowserMcpOperations,
  mcpErrorMessage,
  mcpJsonOutput,
  mcpTextReply,
} from "../browserMcpServer.ts";

export type FlowMcpTool = (typeof FLOW_MCP_TOOLS)[number];

export const FLOW_MCP_TOOLS = [
  "flow_generate",
  "flow_list_clips",
  "flow_list_projects",
  "flow_download_clips",
  "flow_delete_clip",
  "flow_rename_clip",
  "flow_extend_clip",
  "flow_reuse_clip",
  "flow_rename_project",
  "flow_delete_project",
  "flow_list_ingredients",
  "flow_remove_ingredient",
  "flow_clear_ingredients",
] as const;

const flowOutputDir = (deps: BrowserMcpOperations, outDir: unknown): string => {
  if (typeof outDir === "string" && outDir.length > 0) return resolve(outDir);
  return join(downloadsDir(deps.repoRoot), "flow");
};

const toolArgAsString = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  return String(value);
};

const runOnFlowPage = async <T>(
  deps: BrowserMcpOperations,
  pageOp: (page: Page) => Promise<T>,
): Promise<AskToolResult> => {
  if (deps.withFlowPage === undefined) {
    return {
      ok: false,
      output: "Flow tools are not available in this gateway (no browser-backed Flow session).",
    };
  }
  try {
    const pageOpValue = await deps.withFlowPage(pageOp);
    return { ok: true, output: mcpJsonOutput(pageOpValue) };
  } catch (error) {
    return { ok: false, output: mcpErrorMessage(error) };
  }
};

// Destructive verbs require confirm:true. Never throws — failures return { ok: false }.
export const handleFlowMcpCall = async (
  deps: BrowserMcpOperations,
  tool: FlowMcpTool,
  flowToolRequest: Record<string, unknown>,
): Promise<AskToolResult> => {
  switch (tool) {
    case "flow_generate": {
      const startFramePath = toolArgAsString(flowToolRequest.startFramePath).trim();
      const prompt = toolArgAsString(flowToolRequest.prompt).trim();
      if (startFramePath.length === 0) {
        return { ok: false, output: "flow_generate requires startFramePath (a local image path)." };
      }
      if (prompt.length === 0) {
        return { ok: false, output: "flow_generate requires a non-empty prompt." };
      }
      const outDir = flowOutputDir(deps, flowToolRequest.outDir);
      const shouldDownload = flowToolRequest.download !== false;
      return runOnFlowPage(deps, async (page) => {
        const clip = await generateClipFromFrame(page, {
          startFramePath: resolve(startFramePath),
          prompt,
        });
        if (shouldDownload === false) {
          return { id: clip.id, url: clip.url, file: undefined };
        }
        const file = await downloadClip(page, clip.id, outDir);
        return { id: clip.id, url: clip.url, file };
      });
    }
    case "flow_list_clips":
      return runOnFlowPage(deps, (page) => listClips(page));
    case "flow_list_projects":
      return runOnFlowPage(deps, (page) => listFlowProjects(page));
    case "flow_download_clips": {
      const rawClipIds = flowToolRequest.clipIds;
      let requestedIds: string[] | undefined;
      if (Array.isArray(rawClipIds) && rawClipIds.length > 0) {
        requestedIds = rawClipIds.map(String);
      }
      const outDir = flowOutputDir(deps, flowToolRequest.outDir);
      return runOnFlowPage(deps, async (page) => {
        let clipIds = requestedIds;
        if (clipIds === undefined) {
          clipIds = (await listClips(page)).map((clip) => clip.id);
        }
        const downloads: Array<{ id: string; ok: boolean; file?: string; error?: string }> = [];
        for (const clipId of clipIds) {
          try {
            downloads.push({
              id: clipId,
              ok: true,
              file: await downloadClip(page, clipId, outDir),
            });
          } catch (error) {
            downloads.push({ id: clipId, ok: false, error: mcpErrorMessage(error) });
          }
        }
        return downloads;
      });
    }
    case "flow_delete_clip": {
      const clipId = toolArgAsString(flowToolRequest.clipId);
      if (flowToolRequest.confirm !== true) {
        return {
          ok: false,
          output: `Refusing to delete clip ${clipId} without confirm:true (moves it to Flow's recoverable Trash).`,
        };
      }
      return runOnFlowPage(deps, async (page) => {
        await deleteClip(page, clipId);
        return { id: clipId, movedToTrash: true };
      });
    }
    case "flow_rename_clip": {
      const clipId = toolArgAsString(flowToolRequest.clipId);
      const name = toolArgAsString(flowToolRequest.name).trim();
      if (name.length === 0) {
        return { ok: false, output: "flow_rename_clip requires a non-empty name." };
      }
      return runOnFlowPage(deps, async (page) => {
        await renameClip(page, clipId, name);
        return { id: clipId, name };
      });
    }
    case "flow_extend_clip": {
      const clipId = toolArgAsString(flowToolRequest.clipId);
      return runOnFlowPage(deps, async (page) => {
        await addClipToScene(page, clipId);
        return { id: clipId, addedTo: "scene" };
      });
    }
    case "flow_reuse_clip": {
      const clipId = toolArgAsString(flowToolRequest.clipId);
      return runOnFlowPage(deps, async (page) => {
        await addClipToPrompt(page, clipId);
        return { id: clipId, addedTo: "prompt" };
      });
    }
    case "flow_rename_project": {
      const name = toolArgAsString(flowToolRequest.name).trim();
      if (name.length === 0) {
        return { ok: false, output: "flow_rename_project requires a non-empty name." };
      }
      return runOnFlowPage(deps, async (page) => {
        await renameFlowProject(page, name);
        return { name };
      });
    }
    case "flow_delete_project": {
      if (flowToolRequest.confirm !== true) {
        return {
          ok: false,
          output:
            "Refusing to delete the project without confirm:true (project delete is permanent).",
        };
      }
      return runOnFlowPage(deps, async (page) => {
        await deleteFlowProject(page);
        return { deleted: true };
      });
    }
    case "flow_list_ingredients":
      return runOnFlowPage(deps, (page) => listIngredients(page));
    case "flow_remove_ingredient": {
      const ingredientId = toolArgAsString(flowToolRequest.ingredientId);
      if (ingredientId.length === 0) {
        return { ok: false, output: "flow_remove_ingredient requires an ingredientId." };
      }
      return runOnFlowPage(deps, async (page) => {
        await removeIngredient(page, ingredientId);
        return { id: ingredientId, removed: true };
      });
    }
    case "flow_clear_ingredients":
      return runOnFlowPage(deps, async (page) => ({ removed: await clearIngredients(page) }));
  }
};

export const registerFlowMcpTools = (mcp: McpServer, deps: BrowserMcpOperations): void => {
  const registerFlowTool = (
    name: FlowMcpTool,
    description: string,
    schema: Schema.Schema.Any,
  ): void => {
    mcp.registerTool(
      name,
      {
        description,
        inputSchema: effectSchemaToMcpShape(schema),
      },
      async (flowToolRequest: Record<string, unknown>) =>
        mcpTextReply(await handleFlowMcpCall(deps, name, flowToolRequest)),
    );
  };

  registerFlowTool(
    "flow_generate",
    "Generate a Veo clip from a Start keyframe image + a shot prompt (image-to-video), then download the mp4.",
    FlowGenerateArgsSchema,
  );
  registerFlowTool(
    "flow_list_clips",
    "List the rendered clips in the current Flow project (id + mp4 URL).",
    FlowListClipsArgsSchema,
  );
  registerFlowTool(
    "flow_list_projects",
    "List the Flow projects in the sidebar (id + title + URL).",
    FlowListProjectsArgsSchema,
  );
  registerFlowTool(
    "flow_download_clips",
    "Download clip mp4s to the target repo's .bridge/downloads/flow directory (all clips, or the given clipIds).",
    FlowDownloadClipsArgsSchema,
  );
  registerFlowTool(
    "flow_delete_clip",
    "Move a clip to Flow's recoverable Trash (requires confirm:true).",
    FlowDeleteClipArgsSchema,
  );
  registerFlowTool("flow_rename_clip", "Rename a clip.", FlowRenameClipArgsSchema);
  registerFlowTool(
    "flow_extend_clip",
    "Add a clip to a scene (Flow's 'Add to scene' / extend).",
    FlowExtendClipArgsSchema,
  );
  registerFlowTool(
    "flow_reuse_clip",
    "Add a clip back to the prompt as input ('Add to prompt').",
    FlowReuseClipArgsSchema,
  );
  registerFlowTool(
    "flow_rename_project",
    "Rename the current Flow project.",
    FlowRenameProjectArgsSchema,
  );
  registerFlowTool(
    "flow_delete_project",
    "Permanently delete the current Flow project (requires confirm:true; not a Trash move).",
    FlowDeleteProjectArgsSchema,
  );
  registerFlowTool(
    "flow_list_ingredients",
    "List the reference images (ingredients) attached to the current prompt.",
    FlowListIngredientsArgsSchema,
  );
  registerFlowTool(
    "flow_remove_ingredient",
    "Detach one ingredient from the current prompt.",
    FlowRemoveIngredientArgsSchema,
  );
  registerFlowTool(
    "flow_clear_ingredients",
    "Detach every ingredient from the current prompt.",
    FlowClearIngredientsArgsSchema,
  );
};
