import { resolve } from "node:path";
import {
  addClipToPrompt,
  addClipToScene,
  clearIngredients,
  deleteClip,
  deleteFlowProject,
  downloadClip,
  generateClipFromFrame,
  listClips,
  listFlowProjects,
  listIngredients,
  removeIngredient,
  renameClip,
  renameFlowProject,
} from "@/features/providers";
import { effectSchemaToMcpShape } from "@/features/tools";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Schema } from "effect";
import type { Page } from "playwright";
import {
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
} from "./agentGatewaySchemas.ts";
import type { AskGatewayDeps } from "./askGatewayServer.ts";

/**
 * The outbound MCP tool names for Google Flow asset CRUD. These are the agent-facing
 * counterpart to the `bridge flow …` CLI: a pure-MCP client (no shell) drives the whole
 * clip/project lifecycle over `bridge serve`. Destructive verbs are confirm-gated.
 */
export type FlowGatewayTool =
  | "flow_generate"
  | "flow_list_clips"
  | "flow_list_projects"
  | "flow_download_clips"
  | "flow_delete_clip"
  | "flow_rename_clip"
  | "flow_extend_clip"
  | "flow_reuse_clip"
  | "flow_rename_project"
  | "flow_delete_project"
  | "flow_list_ingredients"
  | "flow_remove_ingredient"
  | "flow_clear_ingredients";

/**
 * Run one Flow page op through the injected `withFlowPage` seam and wrap the result as a
 * gateway `{ ok, output }`. The seam (supplied at the composition root) owns the engine
 * lifecycle — attach to the warm browser, hand over the Flow page, shut down keeping the
 * browser warm — so this feature stays browser-agnostic and unit-testable.
 */
const runFlowPageOp = async <T>(
  deps: AskGatewayDeps,
  op: (page: Page) => Promise<T>,
): Promise<{ ok: boolean; output: string }> => {
  if (!deps.withFlowPage) {
    return {
      ok: false,
      output: "Flow tools are not available in this gateway (no browser-backed Flow session).",
    };
  }
  try {
    const result = await deps.withFlowPage(op);
    const output = JSON.stringify(result);
    return { ok: true, output: output ?? "null" };
  } catch (err) {
    return { ok: false, output: err instanceof Error ? err.message : String(err) };
  }
};

/**
 * Dispatch one `flow_*` outbound MCP call to its Flow asset verb, gating destructive
 * verbs (`flow_delete_clip`, `flow_delete_project`) behind an explicit `confirm:true`.
 * Never throws — any failure (missing session, bad clip id, DOM change) is returned as
 * `{ ok: false }` so the tool reports it cleanly to the calling agent.
 *
 * @param deps - Gateway dependencies (supplies the `withFlowPage` browser seam).
 * @param tool - The `flow_*` tool being invoked.
 * @param args - The SDK-validated tool arguments.
 * @returns The keyed `{ ok, output }` result; `output` is JSON on success.
 * @example
 * ```ts
 * const res = await handleFlowGatewayCall(deps, "flow_list_clips", {});
 * ```
 */
export const handleFlowGatewayCall = async (
  deps: AskGatewayDeps,
  tool: FlowGatewayTool,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; output: string }> => {
  switch (tool) {
    case "flow_generate": {
      const startFramePath = String(args.startFramePath ?? "").trim();
      const prompt = String(args.prompt ?? "").trim();
      if (!startFramePath) {
        return { ok: false, output: "flow_generate requires startFramePath (a local image path)." };
      }
      if (!prompt) return { ok: false, output: "flow_generate requires a non-empty prompt." };
      const outDir = args.outDir ? resolve(String(args.outDir)) : resolve("downloads", "flow");
      return runFlowPageOp(deps, async (page) => {
        const clip = await generateClipFromFrame(page, {
          startFramePath: resolve(startFramePath),
          prompt,
        });
        const file =
          args.download === false ? undefined : await downloadClip(page, clip.id, outDir);
        return { id: clip.id, url: clip.url, file };
      });
    }
    case "flow_list_clips":
      return runFlowPageOp(deps, (page) => listClips(page));
    case "flow_list_projects":
      return runFlowPageOp(deps, (page) => listFlowProjects(page));
    case "flow_download_clips": {
      const ids = Array.isArray(args.clipIds) ? args.clipIds.map(String) : undefined;
      const outDir = args.outDir ? resolve(String(args.outDir)) : resolve("downloads", "flow");
      return runFlowPageOp(deps, async (page) => {
        const targets =
          ids && ids.length > 0 ? ids : (await listClips(page)).map((clip) => clip.id);
        const results: Array<{ id: string; ok: boolean; file?: string; error?: string }> = [];
        for (const id of targets) {
          try {
            results.push({ id, ok: true, file: await downloadClip(page, id, outDir) });
          } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            results.push({ id, ok: false, error });
          }
        }
        return results;
      });
    }
    case "flow_delete_clip": {
      const clipId = String(args.clipId ?? "");
      if (args.confirm !== true) {
        return {
          ok: false,
          output: `Refusing to delete clip ${clipId} without confirm:true (moves it to Flow's recoverable Trash).`,
        };
      }
      return runFlowPageOp(deps, async (page) => {
        await deleteClip(page, clipId);
        return { id: clipId, movedToTrash: true };
      });
    }
    case "flow_rename_clip": {
      const clipId = String(args.clipId ?? "");
      const name = String(args.name ?? "").trim();
      if (!name) return { ok: false, output: "flow_rename_clip requires a non-empty name." };
      return runFlowPageOp(deps, async (page) => {
        await renameClip(page, clipId, name);
        return { id: clipId, name };
      });
    }
    case "flow_extend_clip": {
      const clipId = String(args.clipId ?? "");
      return runFlowPageOp(deps, async (page) => {
        await addClipToScene(page, clipId);
        return { id: clipId, addedTo: "scene" };
      });
    }
    case "flow_reuse_clip": {
      const clipId = String(args.clipId ?? "");
      return runFlowPageOp(deps, async (page) => {
        await addClipToPrompt(page, clipId);
        return { id: clipId, addedTo: "prompt" };
      });
    }
    case "flow_rename_project": {
      const name = String(args.name ?? "").trim();
      if (!name) return { ok: false, output: "flow_rename_project requires a non-empty name." };
      return runFlowPageOp(deps, async (page) => {
        await renameFlowProject(page, name);
        return { name };
      });
    }
    case "flow_delete_project": {
      if (args.confirm !== true) {
        return {
          ok: false,
          output:
            "Refusing to delete the project without confirm:true (project delete is permanent).",
        };
      }
      return runFlowPageOp(deps, async (page) => {
        await deleteFlowProject(page);
        return { deleted: true };
      });
    }
    case "flow_list_ingredients":
      return runFlowPageOp(deps, (page) => listIngredients(page));
    case "flow_remove_ingredient": {
      const ingredientId = String(args.ingredientId ?? "");
      if (!ingredientId) {
        return { ok: false, output: "flow_remove_ingredient requires an ingredientId." };
      }
      return runFlowPageOp(deps, async (page) => {
        await removeIngredient(page, ingredientId);
        return { id: ingredientId, removed: true };
      });
    }
    case "flow_clear_ingredients":
      return runFlowPageOp(deps, async (page) => ({ removed: await clearIngredients(page) }));
  }
};

/**
 * Register the `flow_*` asset-CRUD tools on an outbound MCP server, each delegating to
 * {@link handleFlowGatewayCall}. Called from {@link createAskGatewayServer} so the Flow
 * lifecycle is available to pure-MCP agents alongside `ask` / `search_conversations`.
 *
 * @param mcp - The outbound MCP server to register tools on.
 * @param deps - Gateway dependencies threaded into each handler.
 * @returns Nothing; tools are registered as a side effect.
 * @example
 * ```ts
 * registerFlowGatewayTools(mcp, deps);
 * ```
 */
export const registerFlowGatewayTools = (mcp: McpServer, deps: AskGatewayDeps): void => {
  const respond = (result: { ok: boolean; output: string }) => ({
    content: [{ type: "text" as const, text: result.output }],
    isError: !result.ok,
  });
  const register = (
    name: FlowGatewayTool,
    description: string,
    schema: Schema.Schema.Any,
  ): void => {
    mcp.tool(
      name,
      description,
      effectSchemaToMcpShape(schema),
      {},
      async (args: Record<string, unknown>) =>
        respond(await handleFlowGatewayCall(deps, name, args)),
    );
  };

  register(
    "flow_generate",
    "Generate a Veo clip from a Start keyframe image + a shot prompt (image-to-video), then download the mp4.",
    FlowGenerateArgsSchema,
  );
  register(
    "flow_list_clips",
    "List the rendered clips in the current Flow project (id + mp4 URL).",
    FlowListClipsArgsSchema,
  );
  register(
    "flow_list_projects",
    "List the Flow projects in the sidebar (id + title + URL).",
    FlowListProjectsArgsSchema,
  );
  register(
    "flow_download_clips",
    "Download clip mp4s to ./downloads/flow (all clips, or the given clipIds).",
    FlowDownloadClipsArgsSchema,
  );
  register(
    "flow_delete_clip",
    "Move a clip to Flow's recoverable Trash (requires confirm:true).",
    FlowDeleteClipArgsSchema,
  );
  register("flow_rename_clip", "Rename a clip.", FlowRenameClipArgsSchema);
  register(
    "flow_extend_clip",
    "Add a clip to a scene (Flow's 'Add to scene' / extend).",
    FlowExtendClipArgsSchema,
  );
  register(
    "flow_reuse_clip",
    "Add a clip back to the prompt as input ('Add to prompt').",
    FlowReuseClipArgsSchema,
  );
  register("flow_rename_project", "Rename the current Flow project.", FlowRenameProjectArgsSchema);
  register(
    "flow_delete_project",
    "Permanently delete the current Flow project (requires confirm:true; not a Trash move).",
    FlowDeleteProjectArgsSchema,
  );
  register(
    "flow_list_ingredients",
    "List the reference images (ingredients) attached to the current prompt.",
    FlowListIngredientsArgsSchema,
  );
  register(
    "flow_remove_ingredient",
    "Detach one ingredient from the current prompt.",
    FlowRemoveIngredientArgsSchema,
  );
  register(
    "flow_clear_ingredients",
    "Detach every ingredient from the current prompt.",
    FlowClearIngredientsArgsSchema,
  );
};
