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
import { readDownloadsDirectory } from "@/store/paths.ts";
import {
  type AskToolReport,
  FlowClearIngredientsArgumentsSchema,
  FlowDeleteClipArgumentsSchema,
  FlowDeleteProjectArgumentsSchema,
  FlowDownloadClipsArgumentsSchema,
  FlowExtendClipArgumentsSchema,
  FlowGenerateArgumentsSchema,
  FlowListClipsArgumentsSchema,
  FlowListIngredientsArgumentsSchema,
  FlowListProjectsArgumentsSchema,
  FlowRemoveIngredientArgumentsSchema,
  FlowRenameClipArgumentsSchema,
  FlowRenameProjectArgumentsSchema,
  FlowReuseClipArgumentsSchema,
} from "./agent-gateway-schemas.ts";
import {
  type AskGatewayCollaborators,
  readGatewayDocumentPrintout,
  readGatewayErrorMessage,
  readMcpReplyMessage,
} from "./ask-gateway-server.ts";

const FLOW_CLEAR_INGREDIENTS_TOOL_NAME = "flow_clear_ingredients";

const FLOW_REMOVE_INGREDIENT_TOOL_NAME = "flow_remove_ingredient";

const FLOW_LIST_INGREDIENTS_TOOL_NAME = "flow_list_ingredients";

const FLOW_DELETE_PROJECT_TOOL_NAME = "flow_delete_project";

const FLOW_RENAME_PROJECT_TOOL_NAME = "flow_rename_project";

const FLOW_REUSE_CLIP_TOOL_NAME = "flow_reuse_clip";

const FLOW_EXTEND_CLIP_TOOL_NAME = "flow_extend_clip";

const FLOW_RENAME_CLIP_TOOL_NAME = "flow_rename_clip";

const FLOW_DELETE_CLIP_TOOL_NAME = "flow_delete_clip";

const FLOW_DOWNLOAD_CLIPS_TOOL_NAME = "flow_download_clips";

const FLOW_LIST_PROJECTS_TOOL_NAME = "flow_list_projects";

const FLOW_LIST_CLIPS_TOOL_NAME = "flow_list_clips";

const FLOW_GENERATE_TOOL_NAME = "flow_generate";

export const FLOW_GATEWAY_TOOLS = [
  FLOW_GENERATE_TOOL_NAME,
  FLOW_LIST_CLIPS_TOOL_NAME,
  FLOW_LIST_PROJECTS_TOOL_NAME,
  FLOW_DOWNLOAD_CLIPS_TOOL_NAME,
  FLOW_DELETE_CLIP_TOOL_NAME,
  FLOW_RENAME_CLIP_TOOL_NAME,
  FLOW_EXTEND_CLIP_TOOL_NAME,
  FLOW_REUSE_CLIP_TOOL_NAME,
  FLOW_RENAME_PROJECT_TOOL_NAME,
  FLOW_DELETE_PROJECT_TOOL_NAME,
  FLOW_LIST_INGREDIENTS_TOOL_NAME,
  FLOW_REMOVE_INGREDIENT_TOOL_NAME,
  FLOW_CLEAR_INGREDIENTS_TOOL_NAME,
] as const;

export type FlowGatewayTool = (typeof FLOW_GATEWAY_TOOLS)[number];

const readFlowPrintoutDirectory = (
  collaborators: AskGatewayCollaborators,
  outDirectory: unknown,
): string => {
  const hasOutDirectory = typeof outDirectory === "string" && outDirectory.length > 0;
  if (hasOutDirectory) return resolve(outDirectory);

  const downloadsDirectory = readDownloadsDirectory(collaborators.repoRoot);
  return join(downloadsDirectory, "flow");
};

const readToolArgAsString = (field: unknown): string => {
  const isTypeString = typeof field === "string";
  if (isTypeString) return field;

  const isArgumentMissing = field == null;
  if (isArgumentMissing) return "";

  return String(field);
};

const runOnFlowPage = async <Reply>(
  collaborators: AskGatewayCollaborators,
  pageOp: (page: Page) => Promise<Reply>,
): Promise<AskToolReport> => {
  const isWithFlowPageMissing = collaborators.withFlowPage == null;
  if (isWithFlowPageMissing) {
    return {
      ok: false,
      output: "Flow tools are not available in this gateway (no browser-backed Flow session).",
    };
  }

  try {
    const flowPageReport = await collaborators.withFlowPage(pageOp);
    return { ok: true, output: readGatewayDocumentPrintout(flowPageReport) };
  } catch (error) {
    return { ok: false, output: readGatewayErrorMessage(error) };
  }
};

export const runFlowGatewayCall = async (
  collaborators: AskGatewayCollaborators,
  tool: FlowGatewayTool,
  toolArguments: Record<string, unknown>,
): Promise<AskToolReport> => {
  switch (tool) {
    case FLOW_GENERATE_TOOL_NAME: {
      const startFramePath = readToolArgAsString(toolArguments.startFramePath).trim();
      const prompt = readToolArgAsString(toolArguments.prompt).trim();

      const isStartFramePathEmpty = startFramePath.length === 0;
      if (isStartFramePathEmpty) {
        return { ok: false, output: "flow_generate requires startFramePath (a local image path)." };
      }

      const isPromptEmpty = prompt.length === 0;
      if (isPromptEmpty) {
        return { ok: false, output: "flow_generate requires a non-empty prompt." };
      }

      const outDirectory = readFlowPrintoutDirectory(collaborators, toolArguments.outDir);
      const shouldDownload = toolArguments.download !== false;
      return runOnFlowPage(collaborators, async (page) => {
        const clip = await generateClipFromFrame(page, {
          startFramePath: resolve(startFramePath),
          prompt,
        });

        const isDownloadDisabled = shouldDownload === false;
        if (isDownloadDisabled) {
          return { id: clip.id, url: clip.url, file: undefined };
        }

        const file = await downloadClip(page, clip.id, outDirectory);
        return { id: clip.id, url: clip.url, file };
      });
    }
    case FLOW_LIST_CLIPS_TOOL_NAME:
      return runOnFlowPage(collaborators, (page) => listClips(page));
    case FLOW_LIST_PROJECTS_TOOL_NAME:
      return runOnFlowPage(collaborators, (page) => listFlowProjects(page));
    case FLOW_DOWNLOAD_CLIPS_TOOL_NAME: {
      const unparsedClipIds = toolArguments.clipIds;
      let requestedIds: string[] | undefined;

      const hasClipIds = Array.isArray(unparsedClipIds) && unparsedClipIds.length > 0;
      if (hasClipIds) {
        requestedIds = unparsedClipIds.map(String);
      }

      const outDirectory = readFlowPrintoutDirectory(collaborators, toolArguments.outDir);
      return runOnFlowPage(collaborators, async (page) => {
        let clipIds = requestedIds;

        const isClipIdsMissing = clipIds == null;
        if (isClipIdsMissing) {
          clipIds = (await listClips(page)).map((clip) => clip.id);
        }

        const downloads: Array<{ id: string; ok: boolean; file?: string; error?: string }> = [];
        for (const clipId of clipIds) {
          try {
            downloads.push({
              id: clipId,
              ok: true,
              file: await downloadClip(page, clipId, outDirectory),
            });
          } catch (error) {
            const errorMessage = readGatewayErrorMessage(error);
            downloads.push({ id: clipId, ok: false, error: errorMessage });
          }
        }
        return downloads;
      });
    }
    case FLOW_DELETE_CLIP_TOOL_NAME: {
      const clipId = readToolArgAsString(toolArguments.clipId);

      const isConfirmNotRequested = toolArguments.confirm !== true;
      if (isConfirmNotRequested) {
        return {
          ok: false,
          output: `Refusing to delete clip ${clipId} without confirm:true (moves it to Flow's recoverable Trash).`,
        };
      }

      return runOnFlowPage(collaborators, async (page) => {
        await deleteClip(page, clipId);
        return { id: clipId, movedToTrash: true };
      });
    }
    case FLOW_RENAME_CLIP_TOOL_NAME: {
      const clipId = readToolArgAsString(toolArguments.clipId);
      const name = readToolArgAsString(toolArguments.name).trim();

      const isNameEmpty = name.length === 0;
      if (isNameEmpty) {
        return { ok: false, output: "flow_rename_clip requires a non-empty name." };
      }

      return runOnFlowPage(collaborators, async (page) => {
        await renameClip(page, clipId, name);
        return { id: clipId, name };
      });
    }
    case FLOW_EXTEND_CLIP_TOOL_NAME: {
      const clipId = readToolArgAsString(toolArguments.clipId);
      return runOnFlowPage(collaborators, async (page) => {
        await addClipToScene(page, clipId);
        return { id: clipId, addedTo: "scene" };
      });
    }
    case FLOW_REUSE_CLIP_TOOL_NAME: {
      const clipId = readToolArgAsString(toolArguments.clipId);
      return runOnFlowPage(collaborators, async (page) => {
        await addClipToPrompt(page, clipId);
        return { id: clipId, addedTo: "prompt" };
      });
    }
    case FLOW_RENAME_PROJECT_TOOL_NAME: {
      const name = readToolArgAsString(toolArguments.name).trim();

      const isNameBlank = name.length === 0;
      if (isNameBlank) {
        return { ok: false, output: "flow_rename_project requires a non-empty name." };
      }

      return runOnFlowPage(collaborators, async (page) => {
        await renameFlowProject(page, name);
        return { name };
      });
    }
    case FLOW_DELETE_PROJECT_TOOL_NAME: {
      const isConfirmNotGiven = toolArguments.confirm !== true;
      if (isConfirmNotGiven) {
        return {
          ok: false,
          output:
            "Refusing to delete the project without confirm:true (project delete is permanent).",
        };
      }

      return runOnFlowPage(collaborators, async (page) => {
        await deleteFlowProject(page);
        return { deleted: true };
      });
    }
    case FLOW_LIST_INGREDIENTS_TOOL_NAME:
      return runOnFlowPage(collaborators, (page) => listIngredients(page));
    case FLOW_REMOVE_INGREDIENT_TOOL_NAME: {
      const ingredientId = readToolArgAsString(toolArguments.ingredientId);

      const isIngredientIdEmpty = ingredientId.length === 0;
      if (isIngredientIdEmpty) {
        return { ok: false, output: "flow_remove_ingredient requires an ingredientId." };
      }

      return runOnFlowPage(collaborators, async (page) => {
        await removeIngredient(page, ingredientId);
        return { id: ingredientId, removed: true };
      });
    }
    case FLOW_CLEAR_INGREDIENTS_TOOL_NAME:
      return runOnFlowPage(collaborators, async (page) => ({
        removed: await clearIngredients(page),
      }));
  }
};

export const registerFlowGatewayTools = (
  mcp: McpServer,
  collaborators: AskGatewayCollaborators,
): void => {
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
      async (toolArguments: Record<string, unknown>) =>
        readMcpReplyMessage(await runFlowGatewayCall(collaborators, name, toolArguments)),
    );
  };

  registerFlowTool(
    FLOW_GENERATE_TOOL_NAME,
    "Generate a Veo clip from a Start keyframe image + a shot prompt (image-to-video), then download the mp4.",
    FlowGenerateArgumentsSchema,
  );
  registerFlowTool(
    FLOW_LIST_CLIPS_TOOL_NAME,
    "List the rendered clips in the current Flow project (id + mp4 URL).",
    FlowListClipsArgumentsSchema,
  );
  registerFlowTool(
    FLOW_LIST_PROJECTS_TOOL_NAME,
    "List the Flow projects in the sidebar (id + title + URL).",
    FlowListProjectsArgumentsSchema,
  );
  registerFlowTool(
    FLOW_DOWNLOAD_CLIPS_TOOL_NAME,
    "Download clip mp4s to the target repo's .bridge/downloads/flow directory (all clips, or the given clipIds).",
    FlowDownloadClipsArgumentsSchema,
  );
  registerFlowTool(
    FLOW_DELETE_CLIP_TOOL_NAME,
    "Move a clip to Flow's recoverable Trash (requires confirm:true).",
    FlowDeleteClipArgumentsSchema,
  );
  registerFlowTool(FLOW_RENAME_CLIP_TOOL_NAME, "Rename a clip.", FlowRenameClipArgumentsSchema);
  registerFlowTool(
    FLOW_EXTEND_CLIP_TOOL_NAME,
    "Add a clip to a scene (Flow's 'Add to scene' / extend).",
    FlowExtendClipArgumentsSchema,
  );
  registerFlowTool(
    FLOW_REUSE_CLIP_TOOL_NAME,
    "Add a clip back to the prompt as input ('Add to prompt').",
    FlowReuseClipArgumentsSchema,
  );
  registerFlowTool(
    FLOW_RENAME_PROJECT_TOOL_NAME,
    "Rename the current Flow project.",
    FlowRenameProjectArgumentsSchema,
  );
  registerFlowTool(
    FLOW_DELETE_PROJECT_TOOL_NAME,
    "Permanently delete the current Flow project (requires confirm:true; not a Trash move).",
    FlowDeleteProjectArgumentsSchema,
  );
  registerFlowTool(
    FLOW_LIST_INGREDIENTS_TOOL_NAME,
    "List the reference images (ingredients) attached to the current prompt.",
    FlowListIngredientsArgumentsSchema,
  );
  registerFlowTool(
    FLOW_REMOVE_INGREDIENT_TOOL_NAME,
    "Detach one ingredient from the current prompt.",
    FlowRemoveIngredientArgumentsSchema,
  );
  registerFlowTool(
    FLOW_CLEAR_INGREDIENTS_TOOL_NAME,
    "Detach every ingredient from the current prompt.",
    FlowClearIngredientsArgumentsSchema,
  );
};
