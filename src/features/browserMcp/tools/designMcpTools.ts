import { basename, join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Schema } from "effect";
import type { Page } from "playwright";
import { downloadsDir, repositoryPath } from "@/features/repoState/paths.ts";
import {
  readDesignCatalog,
  setDesignModel,
} from "@/features/webProviders/design/designComposer.ts";
import {
  createDesignProject,
  listDesignConversations,
  readDesignConversation,
  renameDesignConversation,
  sendDesignMessage,
  startNewDesignConversation,
} from "@/features/webProviders/design/designConversation.ts";
import { readDesignState } from "@/features/webProviders/design/designPage.ts";
import {
  downloadDesignProject,
  listDesignFiles,
  putDesignFiles,
  removeDesignFiles,
} from "@/features/webProviders/design/projects/designFiles.ts";
import {
  deleteDesignProject,
  duplicateDesignProject,
  listDesignProjects,
  shareDesignProject,
  updateDesignProject,
} from "@/features/webProviders/design/projects/designProjects.ts";
import { openDesignProjectTab } from "@/features/webProviders/design/projects/designTabs.ts";
import { effectSchemaToMcpShape } from "@/mcpSchema.ts";
import type { AskToolResult } from "../browserMcpSchemas.ts";
import {
  type BrowserMcpOperations,
  mcpErrorMessage,
  mcpJsonOutput,
  mcpTextReply,
} from "../browserMcpServer.ts";
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
} from "./designMcpSchemas.ts";

export type DesignMcpTool = (typeof DESIGN_MCP_TOOLS)[number];

export const DESIGN_MCP_TOOLS = [
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

const DEFAULT_TURN_TIMEOUT_SECONDS = 600;

const DEFAULT_READ_LIMIT = 20;

const DEFAULT_PROJECT_LIMIT = 50;

const runOnDesignPage = async <T>(
  deps: BrowserMcpOperations,
  pageOp: (page: Page) => Promise<T>,
): Promise<AskToolResult> => {
  if (deps.withDesignPage === undefined) {
    return {
      ok: false,
      output: "Claude Design tools are not available in this gateway (no browser session).",
    };
  }
  try {
    return { ok: true, output: mcpJsonOutput(await deps.withDesignPage(pageOp)) };
  } catch (error) {
    return { ok: false, output: mcpErrorMessage(error) };
  }
};

const repoPaths = (deps: BrowserMcpOperations, paths: readonly string[] | undefined): string[] => {
  if (paths === undefined) return [];
  return paths.map((path) => repositoryPath(deps.repoRoot, path));
};

const turnOptions = (
  deps: BrowserMcpOperations,
  commandArguments: {
    readonly model?: string | undefined;
    readonly effort?: string | undefined;
    readonly attachments?: readonly string[] | undefined;
    readonly autoDecide?: boolean | undefined;
    readonly wait?: boolean | undefined;
    readonly timeoutSeconds?: number | undefined;
  },
) => {
  let timeoutSeconds = DEFAULT_TURN_TIMEOUT_SECONDS;
  if (commandArguments.timeoutSeconds !== undefined)
    timeoutSeconds = commandArguments.timeoutSeconds;
  return {
    model: commandArguments.model,
    effort: commandArguments.effort,
    attachments: repoPaths(deps, commandArguments.attachments),
    autoDecide: commandArguments.autoDecide === true,
    wait: commandArguments.wait !== false,
    timeoutMs: timeoutSeconds * 1000,
  };
};

const downloadDir = (deps: BrowserMcpOperations, projectId: string, outDir: string | undefined) => {
  if (outDir !== undefined) return repositoryPath(deps.repoRoot, outDir);
  return join(downloadsDir(deps.repoRoot), "design", basename(projectId));
};

const decodeArgs = <A, I>(schema: Schema.Schema<A, I>, designToolRequest: unknown): A => {
  return Schema.decodeUnknownSync(schema)(designToolRequest);
};

const handleDecodedDesignCall = async (
  deps: BrowserMcpOperations,
  tool: DesignMcpTool,
  unvalidatedDesignRequest: unknown,
): Promise<AskToolResult> => {
  switch (tool) {
    case "design_state":
      decodeArgs(DesignStateArgsSchema, unvalidatedDesignRequest);
      return runOnDesignPage(deps, (page) => readDesignState(page));
    case "design_list_projects": {
      const listProjectsRequest = decodeArgs(
        DesignListProjectsArgsSchema,
        unvalidatedDesignRequest,
      );
      let limit = DEFAULT_PROJECT_LIMIT;
      if (listProjectsRequest.limit !== undefined) limit = listProjectsRequest.limit;
      let kind: "projects" | "design-systems" = "projects";
      if (listProjectsRequest.kind !== undefined) kind = listProjectsRequest.kind;
      return runOnDesignPage(deps, (page) =>
        listDesignProjects(page, { kind, query: listProjectsRequest.query, limit }),
      );
    }
    case "design_catalog":
      decodeArgs(DesignCatalogArgsSchema, unvalidatedDesignRequest);
      return runOnDesignPage(deps, (page) => readDesignCatalog(page));
    case "design_choose_model": {
      const chooseModelRequest = decodeArgs(DesignChooseModelArgsSchema, unvalidatedDesignRequest);
      if (chooseModelRequest.model === undefined && chooseModelRequest.effort === undefined) {
        return { ok: false, output: "design_choose_model needs model, effort, or both." };
      }
      return runOnDesignPage(deps, (page) =>
        setDesignModel(page, {
          projectId: chooseModelRequest.projectId,
          model: chooseModelRequest.model,
          effort: chooseModelRequest.effort,
        }),
      );
    }
    case "design_list_files": {
      const projectRequest = decodeArgs(DesignProjectArgsSchema, unvalidatedDesignRequest);
      return runOnDesignPage(deps, (page) => listDesignFiles(page, projectRequest.projectId));
    }
    case "design_read_conversation": {
      const readConversationRequest = decodeArgs(
        DesignReadConversationArgsSchema,
        unvalidatedDesignRequest,
      );
      let limit = DEFAULT_READ_LIMIT;
      if (readConversationRequest.limit !== undefined) limit = readConversationRequest.limit;
      return runOnDesignPage(deps, async (page) => ({
        conversations: await listDesignConversations(page, readConversationRequest.projectId),
        ...(await readDesignConversation(page, {
          projectId: readConversationRequest.projectId,
          conversationId: readConversationRequest.conversationId,
          limit,
        })),
      }));
    }
    case "design_open_project": {
      const projectRequest = decodeArgs(DesignProjectArgsSchema, unvalidatedDesignRequest);
      return runOnDesignPage(deps, async (page) => {
        const projectTab = await openDesignProjectTab(page, projectRequest.projectId);
        return { projectId: projectRequest.projectId, url: projectTab.url() };
      });
    }
    case "design_create_project": {
      const createProjectRequest = decodeArgs(
        DesignCreateProjectArgsSchema,
        unvalidatedDesignRequest,
      );
      return runOnDesignPage(deps, (page) =>
        createDesignProject(page, {
          name: createProjectRequest.name,
          prompt: createProjectRequest.prompt,
          template: createProjectRequest.template,
          designSystemIds: createProjectRequest.designSystemIds,
          ...turnOptions(deps, createProjectRequest),
        }),
      );
    }
    case "design_send": {
      const sendRequest = decodeArgs(DesignSendArgsSchema, unvalidatedDesignRequest);
      return runOnDesignPage(deps, (page) =>
        sendDesignMessage(page, {
          projectId: sendRequest.projectId,
          message: sendRequest.message,
          conversationId: sendRequest.conversationId,
          designSystemIds: sendRequest.designSystemIds,
          ...turnOptions(deps, sendRequest),
        }),
      );
    }
    case "design_new_conversation": {
      const projectRequest = decodeArgs(DesignProjectArgsSchema, unvalidatedDesignRequest);
      return runOnDesignPage(deps, async (page) => ({
        projectId: projectRequest.projectId,
        conversationId: await startNewDesignConversation(page, projectRequest.projectId),
      }));
    }
    case "design_rename_conversation": {
      const renameConversationRequest = decodeArgs(
        DesignRenameConversationArgsSchema,
        unvalidatedDesignRequest,
      );
      return runOnDesignPage(deps, async (page) => {
        await renameDesignConversation(page, renameConversationRequest);
        return { ...renameConversationRequest, renamed: true };
      });
    }
    case "design_update_project": {
      const updateProjectRequest = decodeArgs(
        DesignUpdateProjectArgsSchema,
        unvalidatedDesignRequest,
      );
      return runOnDesignPage(deps, (page) => updateDesignProject(page, updateProjectRequest));
    }
    case "design_duplicate_project": {
      const projectRequest = decodeArgs(DesignProjectArgsSchema, unvalidatedDesignRequest);
      return runOnDesignPage(deps, async (page) => ({
        projectId: await duplicateDesignProject(page, projectRequest.projectId),
      }));
    }
    case "design_delete_project": {
      const deleteProjectRequest = decodeArgs(
        DesignDeleteProjectArgsSchema,
        unvalidatedDesignRequest,
      );
      if (deleteProjectRequest.confirm !== true) {
        return {
          ok: false,
          output: `Refusing to delete Design project ${deleteProjectRequest.projectId} without confirm:true (permanent).`,
        };
      }
      return runOnDesignPage(deps, async (page) => {
        await deleteDesignProject(page, deleteProjectRequest.projectId);
        return { projectId: deleteProjectRequest.projectId, deleted: true };
      });
    }
    case "design_put_files": {
      const putFilesRequest = decodeArgs(DesignPutFilesArgsSchema, unvalidatedDesignRequest);
      const uploads = putFilesRequest.files.map((file) => {
        const localPath = repositoryPath(deps.repoRoot, file.localPath);
        let path = basename(localPath);
        if (file.path !== undefined) path = file.path;
        return { localPath, path };
      });
      return runOnDesignPage(deps, (page) =>
        putDesignFiles(page, { projectId: putFilesRequest.projectId, uploads }),
      );
    }
    case "design_remove_files": {
      const removeFilesRequest = decodeArgs(DesignRemoveFilesArgsSchema, unvalidatedDesignRequest);
      if (removeFilesRequest.confirm !== true) {
        return {
          ok: false,
          output: `Refusing to delete ${removeFilesRequest.paths.length} file(s) from ${removeFilesRequest.projectId} without confirm:true.`,
        };
      }
      return runOnDesignPage(deps, (page) =>
        removeDesignFiles(page, {
          projectId: removeFilesRequest.projectId,
          paths: removeFilesRequest.paths,
        }),
      );
    }
    case "design_download": {
      const downloadRequest = decodeArgs(DesignDownloadArgsSchema, unvalidatedDesignRequest);
      let format: "files" | "zip" = "files";
      if (downloadRequest.format !== undefined) format = downloadRequest.format;
      const outDir = downloadDir(deps, downloadRequest.projectId, downloadRequest.outDir);
      return runOnDesignPage(deps, async (page) => ({
        files: await downloadDesignProject(page, {
          projectId: downloadRequest.projectId,
          format,
          paths: downloadRequest.paths,
          outDir,
        }),
      }));
    }
    case "design_share": {
      const shareRequest = decodeArgs(DesignShareArgsSchema, unvalidatedDesignRequest);
      return runOnDesignPage(deps, (page) =>
        shareDesignProject(page, {
          projectId: shareRequest.projectId,
          access: shareRequest.access,
          linkPermission: shareRequest.linkPermission,
        }),
      );
    }
  }
};

// Destructive tools require confirm:true. Never throws — failures return { ok: false }.
export const handleDesignMcpCall = async (
  deps: BrowserMcpOperations,
  tool: DesignMcpTool,
  unvalidatedDesignRequest: unknown,
): Promise<AskToolResult> => {
  try {
    return await handleDecodedDesignCall(deps, tool, unvalidatedDesignRequest);
  } catch (error) {
    return { ok: false, output: mcpErrorMessage(error) };
  }
};

const DESIGN_TOOL_DEFINITIONS: Record<
  DesignMcpTool,
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

export const registerDesignMcpTools = (mcp: McpServer, deps: BrowserMcpOperations): void => {
  // One Chrome drives every Design call; run them one at a time so menus never interleave.
  let designQueue: Promise<unknown> = Promise.resolve();
  for (const tool of DESIGN_MCP_TOOLS) {
    const definition = DESIGN_TOOL_DEFINITIONS[tool];
    mcp.registerTool(
      tool,
      {
        description: definition.description,
        inputSchema: effectSchemaToMcpShape(definition.schema),
      },
      async (designToolRequest: Record<string, unknown>) => {
        const mcpReply = designQueue.then(() => handleDesignMcpCall(deps, tool, designToolRequest));
        designQueue = mcpReply;
        return mcpTextReply(await mcpReply);
      },
    );
  }
};
