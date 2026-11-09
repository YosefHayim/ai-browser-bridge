import { join, resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Page } from "playwright";
import type { z } from "zod";
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
} from "@/providers/flow/flow-assets.ts";
import { generateClipFromFrame } from "@/providers/flow/flow-generate.ts";
import { downloadsDir } from "@/store/paths.ts";
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
} from "./agent-gateway-schemas.ts";
import {
  type AskGatewayDeps,
  gatewayErrorMessage,
  gatewayJsonOutput,
  mcpTextFromGatewayReply,
} from "./ask-gateway-server.ts";

export const FLOW_GATEWAY_TOOLS = [
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

export type FlowGatewayTool = (typeof FLOW_GATEWAY_TOOLS)[number];

const flowOutputDir = (deps: AskGatewayDeps, outDir: unknown): string => {
  const hasOutDir = typeof outDir === "string" && outDir.length > 0;
  if (hasOutDir) return resolve(outDir);

  return join(downloadsDir(deps.repoRoot), "flow");
};

const toolArgAsString = (value: unknown): string => {
  const isTypeString = typeof value === "string";
  if (isTypeString) return value;

  const isValueMissing = value === undefined || value === null;
  if (isValueMissing) return "";

  return String(value);
};

const runOnFlowPage = async <T>(
  deps: AskGatewayDeps,
  pageOp: (page: Page) => Promise<T>,
): Promise<AskToolResult> => {
  const isWithFlowPageMissing = deps.withFlowPage === undefined;
  if (isWithFlowPageMissing) {
    return {
      ok: false,
      output: "Flow tools are not available in this gateway (no browser-backed Flow session).",
    };
  }

  try {
    const pageOpValue = await deps.withFlowPage(pageOp);
    return { ok: true, output: gatewayJsonOutput(pageOpValue) };
  } catch (error) {
    return { ok: false, output: gatewayErrorMessage(error) };
  }
};

// Destructive verbs require confirm:true. Never throws — failures return { ok: false }.
export const handleFlowGatewayCall = async (
  deps: AskGatewayDeps,
  tool: FlowGatewayTool,
  args: Record<string, unknown>,
): Promise<AskToolResult> => {
  switch (tool) {
    case "flow_generate": {
      const startFramePath = toolArgAsString(args.startFramePath).trim();
      const prompt = toolArgAsString(args.prompt).trim();

      const isStartFramePathEmpty = startFramePath.length === 0;
      if (isStartFramePathEmpty) {
        return { ok: false, output: "flow_generate requires startFramePath (a local image path)." };
      }

      const isPromptEmpty = prompt.length === 0;
      if (isPromptEmpty) {
        return { ok: false, output: "flow_generate requires a non-empty prompt." };
      }

      const outDir = flowOutputDir(deps, args.outDir);
      const shouldDownload = args.download !== false;
      return runOnFlowPage(deps, async (page) => {
        const clip = await generateClipFromFrame(page, {
          startFramePath: resolve(startFramePath),
          prompt,
        });

        const isDownloadDisabled = shouldDownload === false;
        if (isDownloadDisabled) {
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
      const rawClipIds = args.clipIds;
      let requestedIds: string[] | undefined;

      const hasClipIds = Array.isArray(rawClipIds) && rawClipIds.length > 0;
      if (hasClipIds) {
        requestedIds = rawClipIds.map(String);
      }

      const outDir = flowOutputDir(deps, args.outDir);
      return runOnFlowPage(deps, async (page) => {
        let clipIds = requestedIds;

        const isClipIdsMissing = clipIds === undefined;
        if (isClipIdsMissing) {
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
            downloads.push({ id: clipId, ok: false, error: gatewayErrorMessage(error) });
          }
        }
        return downloads;
      });
    }
    case "flow_delete_clip": {
      const clipId = toolArgAsString(args.clipId);

      const isConfirmNotRequested = args.confirm !== true;
      if (isConfirmNotRequested) {
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
      const clipId = toolArgAsString(args.clipId);
      const name = toolArgAsString(args.name).trim();

      const isNameEmpty = name.length === 0;
      if (isNameEmpty) {
        return { ok: false, output: "flow_rename_clip requires a non-empty name." };
      }

      return runOnFlowPage(deps, async (page) => {
        await renameClip(page, clipId, name);
        return { id: clipId, name };
      });
    }
    case "flow_extend_clip": {
      const clipId = toolArgAsString(args.clipId);
      return runOnFlowPage(deps, async (page) => {
        await addClipToScene(page, clipId);
        return { id: clipId, addedTo: "scene" };
      });
    }
    case "flow_reuse_clip": {
      const clipId = toolArgAsString(args.clipId);
      return runOnFlowPage(deps, async (page) => {
        await addClipToPrompt(page, clipId);
        return { id: clipId, addedTo: "prompt" };
      });
    }
    case "flow_rename_project": {
      const name = toolArgAsString(args.name).trim();
      const isNameBlank = name.length === 0;
      if (isNameBlank) {
        return { ok: false, output: "flow_rename_project requires a non-empty name." };
      }

      return runOnFlowPage(deps, async (page) => {
        await renameFlowProject(page, name);
        return { name };
      });
    }
    case "flow_delete_project": {
      const isConfirmNotGiven = args.confirm !== true;
      if (isConfirmNotGiven) {
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
      const ingredientId = toolArgAsString(args.ingredientId);

      const isIngredientIdEmpty = ingredientId.length === 0;
      if (isIngredientIdEmpty) {
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

export const registerFlowGatewayTools = (mcp: McpServer, deps: AskGatewayDeps): void => {
  const registerFlowTool = (
    name: FlowGatewayTool,
    description: string,
    schema: z.ZodObject,
  ): void => {
    mcp.registerTool(
      name,
      {
        description,
        inputSchema: schema.shape,
      },
      async (args: Record<string, unknown>) =>
        mcpTextFromGatewayReply(await handleFlowGatewayCall(deps, name, args)),
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
