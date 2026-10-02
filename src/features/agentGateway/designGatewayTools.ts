import { basename, join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Schema } from "effect";
import type { Page } from "playwright";
import {
  createDesignProject,
  deleteDesignProject,
  downloadDesignProject,
  duplicateDesignProject,
  listDesignConversations,
  listDesignFiles,
  listDesignProjects,
  openDesignProjectTab,
  putDesignFiles,
  readDesignCatalog,
  readDesignConversation,
  readDesignState,
  removeDesignFiles,
  renameDesignConversation,
  sendDesignMessage,
  setDesignModel,
  shareDesignProject,
  startNewDesignConversation,
  updateDesignProject,
} from "@/features/providers";
import { downloadsDir, repositoryPath } from "@/features/store";
import { effectSchemaToMcpShape } from "@/features/tools";
import type { AskToolResult } from "./agentGatewaySchemas.ts";
import {
  type AskGatewayDeps,
  gatewayErrorMessage,
  gatewayJsonOutput,
  mcpTextFromGatewayReply,
} from "./askGatewayServer.ts";
import {
  DesignCatalogArgsSchema,
  DesignChooseModelArgsSchema,
  DesignCreateProjectArgsSchema,
  DesignDeleteProjectArgsSchema,
  DesignDownloadArgsSchema,
  DesignListProjectsArgsSchema,
  DesignProjectArgsSchema,
  DesignPutFilesArgsSchema,
  DesignReadConversationArgsSchema,
  DesignRemoveFilesArgsSchema,
  DesignRenameConversationArgsSchema,
  DesignSendArgsSchema,
  DesignShareArgsSchema,
  DesignStateArgsSchema,
  DesignUpdateProjectArgsSchema,
} from "./designGatewaySchemas.ts";

export const DESIGN_GATEWAY_TOOLS = [
  "design_state",
  "design_list_projects",
  "design_catalog",
  "design_choose_model",
  "design_list_files",
  "design_read_conversation",
  "design_open_project",
  "design_create_project",
  "design_send",
  "design_new_conversation",
  "design_rename_conversation",
  "design_update_project",
  "design_duplicate_project",
  "design_delete_project",
  "design_put_files",
  "design_remove_files",
  "design_download",
  "design_share",
] as const;

export type DesignGatewayTool = (typeof DESIGN_GATEWAY_TOOLS)[number];

const DEFAULT_TURN_TIMEOUT_SECONDS = 600;
const DEFAULT_READ_LIMIT = 20;
const DEFAULT_PROJECT_LIMIT = 50;

const runOnDesignPage = async <T>(
  deps: AskGatewayDeps,
  pageOp: (page: Page) => Promise<T>,
): Promise<AskToolResult> => {
  if (deps.withDesignPage === undefined) {
    return {
      ok: false,
      output: "Claude Design tools are not available in this gateway (no browser session).",
    };
  }
  try {
    return { ok: true, output: gatewayJsonOutput(await deps.withDesignPage(pageOp)) };
  } catch (error) {
    return { ok: false, output: gatewayErrorMessage(error) };
  }
};

const repoPaths = (deps: AskGatewayDeps, paths: readonly string[] | undefined): string[] => {
  if (paths === undefined) return [];
  return paths.map((path) => repositoryPath(deps.repoRoot, path));
};

const turnOptions = (
  deps: AskGatewayDeps,
  args: {
    readonly model?: string | undefined;
    readonly effort?: string | undefined;
    readonly attachments?: readonly string[] | undefined;
    readonly autoDecide?: boolean | undefined;
    readonly wait?: boolean | undefined;
    readonly timeoutSeconds?: number | undefined;
  },
) => {
  let timeoutSeconds = DEFAULT_TURN_TIMEOUT_SECONDS;
  if (args.timeoutSeconds !== undefined) timeoutSeconds = args.timeoutSeconds;
  return {
    model: args.model,
    effort: args.effort,
    attachments: repoPaths(deps, args.attachments),
    autoDecide: args.autoDecide === true,
    wait: args.wait !== false,
    timeoutMs: timeoutSeconds * 1000,
  };
};

const downloadDir = (deps: AskGatewayDeps, projectId: string, outDir: string | undefined) => {
  if (outDir !== undefined) return repositoryPath(deps.repoRoot, outDir);
  return join(downloadsDir(deps.repoRoot), "design", basename(projectId));
};

const decodeArgs = <A, I>(schema: Schema.Schema<A, I>, args: unknown): A => {
  return Schema.decodeUnknownSync(schema)(args);
};

const handleDecodedDesignCall = async (
  deps: AskGatewayDeps,
  tool: DesignGatewayTool,
  rawArgs: unknown,
): Promise<AskToolResult> => {
  switch (tool) {
    case "design_state":
      decodeArgs(DesignStateArgsSchema, rawArgs);
      return runOnDesignPage(deps, (page) => readDesignState(page));
    case "design_list_projects": {
      const args = decodeArgs(DesignListProjectsArgsSchema, rawArgs);
      let limit = DEFAULT_PROJECT_LIMIT;
      if (args.limit !== undefined) limit = args.limit;
      let kind: "projects" | "design-systems" = "projects";
      if (args.kind !== undefined) kind = args.kind;
      return runOnDesignPage(deps, (page) =>
        listDesignProjects(page, { kind, query: args.query, limit }),
      );
    }
    case "design_catalog":
      decodeArgs(DesignCatalogArgsSchema, rawArgs);
      return runOnDesignPage(deps, (page) => readDesignCatalog(page));
    case "design_choose_model": {
      const args = decodeArgs(DesignChooseModelArgsSchema, rawArgs);
      return runOnDesignPage(deps, (page) =>
        setDesignModel(page, { projectId: args.projectId, model: args.model, effort: args.effort }),
      );
    }
    case "design_list_files": {
      const args = decodeArgs(DesignProjectArgsSchema, rawArgs);
      return runOnDesignPage(deps, (page) => listDesignFiles(page, args.projectId));
    }
    case "design_read_conversation": {
      const args = decodeArgs(DesignReadConversationArgsSchema, rawArgs);
      let limit = DEFAULT_READ_LIMIT;
      if (args.limit !== undefined) limit = args.limit;
      return runOnDesignPage(deps, async (page) => ({
        conversations: await listDesignConversations(page, args.projectId),
        ...(await readDesignConversation(page, {
          projectId: args.projectId,
          conversationId: args.conversationId,
          limit,
        })),
      }));
    }
    case "design_open_project": {
      const args = decodeArgs(DesignProjectArgsSchema, rawArgs);
      return runOnDesignPage(deps, async (page) => {
        const projectTab = await openDesignProjectTab(page, args.projectId);
        return { projectId: args.projectId, url: projectTab.url() };
      });
    }
    case "design_create_project": {
      const args = decodeArgs(DesignCreateProjectArgsSchema, rawArgs);
      return runOnDesignPage(deps, (page) =>
        createDesignProject(page, {
          name: args.name,
          prompt: args.prompt,
          template: args.template,
          designSystemIds: args.designSystemIds,
          ...turnOptions(deps, args),
        }),
      );
    }
    case "design_send": {
      const args = decodeArgs(DesignSendArgsSchema, rawArgs);
      return runOnDesignPage(deps, (page) =>
        sendDesignMessage(page, {
          projectId: args.projectId,
          message: args.message,
          conversationId: args.conversationId,
          designSystemIds: args.designSystemIds,
          ...turnOptions(deps, args),
        }),
      );
    }
    case "design_new_conversation": {
      const args = decodeArgs(DesignProjectArgsSchema, rawArgs);
      return runOnDesignPage(deps, async (page) => ({
        projectId: args.projectId,
        conversationId: await startNewDesignConversation(page, args.projectId),
      }));
    }
    case "design_rename_conversation": {
      const args = decodeArgs(DesignRenameConversationArgsSchema, rawArgs);
      return runOnDesignPage(deps, async (page) => {
        await renameDesignConversation(page, args);
        return { ...args, renamed: true };
      });
    }
    case "design_update_project": {
      const args = decodeArgs(DesignUpdateProjectArgsSchema, rawArgs);
      return runOnDesignPage(deps, (page) => updateDesignProject(page, args));
    }
    case "design_duplicate_project": {
      const args = decodeArgs(DesignProjectArgsSchema, rawArgs);
      return runOnDesignPage(deps, async (page) => ({
        projectId: await duplicateDesignProject(page, args.projectId),
      }));
    }
    case "design_delete_project": {
      const args = decodeArgs(DesignDeleteProjectArgsSchema, rawArgs);
      if (args.confirm !== true) {
        return {
          ok: false,
          output: `Refusing to delete Design project ${args.projectId} without confirm:true (permanent).`,
        };
      }
      return runOnDesignPage(deps, async (page) => {
        await deleteDesignProject(page, args.projectId);
        return { projectId: args.projectId, deleted: true };
      });
    }
    case "design_put_files": {
      const args = decodeArgs(DesignPutFilesArgsSchema, rawArgs);
      const uploads = args.files.map((file) => {
        const localPath = repositoryPath(deps.repoRoot, file.localPath);
        let path = basename(localPath);
        if (file.path !== undefined) path = file.path;
        return { localPath, path };
      });
      return runOnDesignPage(deps, (page) =>
        putDesignFiles(page, { projectId: args.projectId, uploads }),
      );
    }
    case "design_remove_files": {
      const args = decodeArgs(DesignRemoveFilesArgsSchema, rawArgs);
      if (args.confirm !== true) {
        return {
          ok: false,
          output: `Refusing to delete ${args.paths.length} file(s) from ${args.projectId} without confirm:true.`,
        };
      }
      return runOnDesignPage(deps, (page) =>
        removeDesignFiles(page, { projectId: args.projectId, paths: args.paths }),
      );
    }
    case "design_download": {
      const args = decodeArgs(DesignDownloadArgsSchema, rawArgs);
      let format: "files" | "zip" = "files";
      if (args.format !== undefined) format = args.format;
      const outDir = downloadDir(deps, args.projectId, args.outDir);
      return runOnDesignPage(deps, async (page) => ({
        files: await downloadDesignProject(page, {
          projectId: args.projectId,
          format,
          paths: args.paths,
          outDir,
        }),
      }));
    }
    case "design_share": {
      const args = decodeArgs(DesignShareArgsSchema, rawArgs);
      return runOnDesignPage(deps, (page) =>
        shareDesignProject(page, {
          projectId: args.projectId,
          access: args.access,
          linkPermission: args.linkPermission,
        }),
      );
    }
  }
};

// Destructive tools require confirm:true. Never throws — failures return { ok: false }.
export const handleDesignGatewayCall = async (
  deps: AskGatewayDeps,
  tool: DesignGatewayTool,
  rawArgs: unknown,
): Promise<AskToolResult> => {
  try {
    return await handleDecodedDesignCall(deps, tool, rawArgs);
  } catch (error) {
    return { ok: false, output: gatewayErrorMessage(error) };
  }
};

const DESIGN_TOOL_DEFINITIONS: Record<
  DesignGatewayTool,
  { readonly description: string; readonly schema: Schema.Schema.Any }
> = {
  design_state: {
    description:
      "Where Claude Design is: home or project page, project, model + effort, whether a turn is running, open Design tabs, the actions available here, and the Share destinations left to you.",
    schema: DesignStateArgsSchema,
  },
  design_list_projects: {
    description: "List Claude Design projects (or design systems) with id, name, url, sharing.",
    schema: DesignListProjectsArgsSchema,
  },
  design_catalog: {
    description:
      "Choices for new work: home templates, models with effort levels (incl. More models), and design systems.",
    schema: DesignCatalogArgsSchema,
  },
  design_choose_model: {
    description:
      "Pick the model (incl. More models) and effort in a project's composer, or on home for new projects. Like the UI, it becomes your Claude Design default.",
    schema: DesignChooseModelArgsSchema,
  },
  design_list_files: {
    description: "List the files in a Design project.",
    schema: DesignProjectArgsSchema,
  },
  design_read_conversation: {
    description:
      "Read a project's Conversations and the latest messages — what you asked and what Claude replied.",
    schema: DesignReadConversationArgsSchema,
  },
  design_open_project: {
    description: "Open (or focus) the project's tab in the bridge Chrome.",
    schema: DesignProjectArgsSchema,
  },
  design_create_project: {
    description:
      "Create a Design project. With a prompt: home composer with optional template, model, effort, and attachments, then wait for Claude's first reply. Without: a blank project.",
    schema: DesignCreateProjectArgsSchema,
  },
  design_send: {
    description:
      "Send a message in a project's Conversation (optional model, effort, design systems, attachments) and return Claude's reply. status is replied, running, or waiting-for-answer. For long turns pass wait:false, then poll design_read_conversation.",
    schema: DesignSendArgsSchema,
  },
  design_new_conversation: {
    description: "Start a new Conversation in a project and return its id.",
    schema: DesignProjectArgsSchema,
  },
  design_rename_conversation: {
    description: "Rename a Conversation in a project.",
    schema: DesignRenameConversationArgsSchema,
  },
  design_update_project: {
    description: "Rename a project, star/unstar it, or set its design systems.",
    schema: DesignUpdateProjectArgsSchema,
  },
  design_duplicate_project: {
    description: "Duplicate a project and return the copy's id.",
    schema: DesignProjectArgsSchema,
  },
  design_delete_project: {
    description: "Permanently delete a project (requires confirm:true).",
    schema: DesignDeleteProjectArgsSchema,
  },
  design_put_files: {
    description: "Add repo files to a project; an existing path is replaced.",
    schema: DesignPutFilesArgsSchema,
  },
  design_remove_files: {
    description: "Delete files from a project (requires confirm:true).",
    schema: DesignRemoveFilesArgsSchema,
  },
  design_download: {
    description:
      "Download project files, or the whole project as a zip, into the repo (.bridge/downloads/design by default).",
    schema: DesignDownloadArgsSchema,
  },
  design_share: {
    description:
      "Set who can open the project (private or workspace, with view/comment/edit) and return its link.",
    schema: DesignShareArgsSchema,
  },
};

export const registerDesignGatewayTools = (mcp: McpServer, deps: AskGatewayDeps): void => {
  // One Chrome drives every Design call; run them one at a time so menus never interleave.
  let designQueue: Promise<unknown> = Promise.resolve();
  for (const tool of DESIGN_GATEWAY_TOOLS) {
    const definition = DESIGN_TOOL_DEFINITIONS[tool];
    mcp.registerTool(
      tool,
      {
        description: definition.description,
        inputSchema: effectSchemaToMcpShape(definition.schema),
      },
      async (args: Record<string, unknown>) => {
        const gatewayReply = designQueue.then(() => handleDesignGatewayCall(deps, tool, args));
        designQueue = gatewayReply;
        return mcpTextFromGatewayReply(await gatewayReply);
      },
    );
  }
};
