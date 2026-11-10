import { basename, join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Page } from "playwright";
import type { z } from "zod";
import { readDesignCatalog, setDesignModel } from "@/providers/design/design-composer.ts";
import {
  createDesignProject,
  listDesignConversations,
  readDesignConversation,
  renameDesignConversation,
  sendDesignMessage,
  startNewDesignConversation,
} from "@/providers/design/design-conversation.ts";
import {
  downloadDesignProject,
  listDesignFiles,
  putDesignFiles,
  removeDesignFiles,
} from "@/providers/design/design-files.ts";
import { readDesignStatus } from "@/providers/design/design-page.ts";
import {
  deleteDesignProject,
  duplicateDesignProject,
  listDesignProjects,
  shareDesignProject,
  updateDesignProject,
} from "@/providers/design/design-projects.ts";
import { openDesignProjectTab } from "@/providers/design/design-tabs.ts";
import { readDownloadsDirectory, readRepositoryPath } from "@/store/paths.ts";
import type { AskToolReport } from "./agent-gateway-schemas.ts";
import {
  type AskGatewayCollaborators,
  readGatewayDocumentPrintout,
  readGatewayErrorMessage,
  readMcpStringFromGatewayReply,
} from "./ask-gateway-server.ts";
import {
  DesignCatalogArgumentsSchema,
  DesignChooseModelArgumentsSchema,
  DesignCreateProjectArgumentsSchema,
  DesignDeleteProjectArgumentsSchema,
  DesignDownloadArgumentsSchema,
  DesignListProjectsArgumentsSchema,
  DesignProjectArgumentsSchema,
  DesignPutFilesArgumentsSchema,
  DesignReadConversationArgumentsSchema,
  DesignRemoveFilesArgumentsSchema,
  DesignRenameConversationArgumentsSchema,
  DesignSendArgumentsSchema,
  DesignShareArgumentsSchema,
  DesignStatusArgumentsSchema,
  DesignUpdateProjectArgumentsSchema,
} from "./design-gateway-schemas.ts";

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

const runOnDesignPage = async <Reply>(
  collaborators: AskGatewayCollaborators,
  pageOp: (page: Page) => Promise<Reply>,
): Promise<AskToolReport> => {
  const isWithDesignPageMissing = collaborators.withDesignPage == null;
  if (isWithDesignPageMissing) {
    return {
      ok: false,
      output: "Claude Design tools are not available in this gateway (no browser session).",
    };
  }

  try {
    const designPageReply = await collaborators.withDesignPage(pageOp);
    return { ok: true, output: readGatewayDocumentPrintout(designPageReply) };
  } catch (error) {
    return { ok: false, output: readGatewayErrorMessage(error) };
  }
};

const listRepoPaths = (
  collaborators: AskGatewayCollaborators,
  paths: readonly string[] | undefined,
): string[] => {
  const isPathsMissing = paths == null;
  if (isPathsMissing) return [];

  return paths.map((path) => readRepositoryPath(collaborators.repoRoot, path));
};

const turnSettings = (
  collaborators: AskGatewayCollaborators,
  toolArguments: {
    readonly model?: string | undefined;
    readonly effort?: string | undefined;
    readonly attachments?: readonly string[] | undefined;
    readonly autoDecide?: boolean | undefined;
    readonly wait?: boolean | undefined;
    readonly timeoutSeconds?: number | undefined;
  },
) => {
  let timeoutSeconds = DEFAULT_TURN_TIMEOUT_SECONDS;
  const hasTimeoutSeconds = toolArguments.timeoutSeconds != null;
  if (hasTimeoutSeconds) timeoutSeconds = toolArguments.timeoutSeconds;

  return {
    model: toolArguments.model,
    effort: toolArguments.effort,
    attachments: listRepoPaths(collaborators, toolArguments.attachments),
    autoDecide: toolArguments.autoDecide === true,
    wait: toolArguments.wait !== false,
    timeoutMs: timeoutSeconds * 1000,
  };
};

const downloadDirectory = (
  collaborators: AskGatewayCollaborators,
  projectId: string,
  outDirectory: string | undefined,
) => {
  const hasOutDirectory = outDirectory != null;
  if (hasOutDirectory) return readRepositoryPath(collaborators.repoRoot, outDirectory);

  const downloadsDirectory = readDownloadsDirectory(collaborators.repoRoot);
  const projectDirectoryName = basename(projectId);
  return join(downloadsDirectory, "design", projectDirectoryName);
};

const decodeToolArguments = <Arguments>(
  schema: z.ZodType<Arguments>,
  toolArguments: unknown,
): Arguments => {
  return schema.parse(toolArguments);
};

const runDecodedDesignCall = async (
  collaborators: AskGatewayCollaborators,
  tool: DesignGatewayTool,
  unparsedToolArguments: unknown,
): Promise<AskToolReport> => {
  switch (tool) {
    case "design_state":
      decodeArgs(DesignStateArgsSchema, rawArgs);
      return runOnDesignPage(deps, (page) => readDesignStatus(page));
    case "design_list_projects": {
      const toolArguments = decodeToolArguments(
        DesignListProjectsArgumentsSchema,
        unparsedToolArguments,
      );

      let limit = DEFAULT_PROJECT_LIMIT;
      const hasLimit = toolArguments.limit != null;
      if (hasLimit) limit = toolArguments.limit;

      let kind: "projects" | "design-systems" = "projects";
      const hasKind = toolArguments.kind != null;
      if (hasKind) kind = toolArguments.kind;

      return runOnDesignPage(collaborators, (page) =>
        listDesignProjects(page, { kind, query: toolArguments.query, limit }),
      );
    }
    case "design_catalog":
      decodeToolArguments(DesignCatalogArgumentsSchema, unparsedToolArguments);
      return runOnDesignPage(collaborators, (page) => readDesignCatalog(page));
    case "design_choose_model": {
      const toolArguments = decodeToolArguments(
        DesignChooseModelArgumentsSchema,
        unparsedToolArguments,
      );
      const isModelChoiceEmpty = toolArguments.model == null && toolArguments.effort == null;
      if (isModelChoiceEmpty) {
        return { ok: false, output: "design_choose_model needs model, effort, or both." };
      }

      return runOnDesignPage(collaborators, (page) =>
        setDesignModel(page, {
          projectId: toolArguments.projectId,
          model: toolArguments.model,
          effort: toolArguments.effort,
        }),
      );
    }
    case "design_list_files": {
      const toolArguments = decodeToolArguments(
        DesignProjectArgumentsSchema,
        unparsedToolArguments,
      );
      return runOnDesignPage(collaborators, (page) =>
        listDesignFiles(page, toolArguments.projectId),
      );
    }
    case "design_read_conversation": {
      const toolArguments = decodeToolArguments(
        DesignReadConversationArgumentsSchema,
        unparsedToolArguments,
      );

      let limit = DEFAULT_READ_LIMIT;
      const hasLimitArg = toolArguments.limit != null;
      if (hasLimitArg) limit = toolArguments.limit;

      return runOnDesignPage(collaborators, async (page) => ({
        conversations: await listDesignConversations(page, toolArguments.projectId),
        ...(await readDesignConversation(page, {
          projectId: toolArguments.projectId,
          conversationId: toolArguments.conversationId,
          limit,
        })),
      }));
    }
    case "design_open_project": {
      const toolArguments = decodeToolArguments(
        DesignProjectArgumentsSchema,
        unparsedToolArguments,
      );
      return runOnDesignPage(collaborators, async (page) => {
        const projectTab = await openDesignProjectTab(page, toolArguments.projectId);
        return { projectId: toolArguments.projectId, url: projectTab.url() };
      });
    }
    case "design_create_project": {
      const toolArguments = decodeToolArguments(
        DesignCreateProjectArgumentsSchema,
        unparsedToolArguments,
      );
      return runOnDesignPage(collaborators, (page) =>
        createDesignProject(page, {
          name: toolArguments.name,
          prompt: toolArguments.prompt,
          template: toolArguments.template,
          designSystemIds: toolArguments.designSystemIds,
          ...turnSettings(collaborators, toolArguments),
        }),
      );
    }
    case "design_send": {
      const toolArguments = decodeToolArguments(DesignSendArgumentsSchema, unparsedToolArguments);
      return runOnDesignPage(collaborators, (page) =>
        sendDesignMessage(page, {
          projectId: toolArguments.projectId,
          message: toolArguments.message,
          conversationId: toolArguments.conversationId,
          designSystemIds: toolArguments.designSystemIds,
          ...turnSettings(collaborators, toolArguments),
        }),
      );
    }
    case "design_new_conversation": {
      const toolArguments = decodeToolArguments(
        DesignProjectArgumentsSchema,
        unparsedToolArguments,
      );
      return runOnDesignPage(collaborators, async (page) => ({
        projectId: toolArguments.projectId,
        conversationId: await startNewDesignConversation(page, toolArguments.projectId),
      }));
    }
    case "design_rename_conversation": {
      const toolArguments = decodeToolArguments(
        DesignRenameConversationArgumentsSchema,
        unparsedToolArguments,
      );
      return runOnDesignPage(collaborators, async (page) => {
        await renameDesignConversation(page, toolArguments);
        return { ...toolArguments, renamed: true };
      });
    }
    case "design_update_project": {
      const toolArguments = decodeToolArguments(
        DesignUpdateProjectArgumentsSchema,
        unparsedToolArguments,
      );
      return runOnDesignPage(collaborators, (page) => updateDesignProject(page, toolArguments));
    }
    case "design_duplicate_project": {
      const toolArguments = decodeToolArguments(
        DesignProjectArgumentsSchema,
        unparsedToolArguments,
      );
      return runOnDesignPage(collaborators, async (page) => ({
        projectId: await duplicateDesignProject(page, toolArguments.projectId),
      }));
    }
    case "design_delete_project": {
      const toolArguments = decodeToolArguments(
        DesignDeleteProjectArgumentsSchema,
        unparsedToolArguments,
      );
      const isConfirmNotRequested = toolArguments.confirm !== true;
      if (isConfirmNotRequested) {
        return {
          ok: false,
          output: `Refusing to delete Design project ${toolArguments.projectId} without confirm:true (permanent).`,
        };
      }

      return runOnDesignPage(collaborators, async (page) => {
        await deleteDesignProject(page, toolArguments.projectId);
        return { projectId: toolArguments.projectId, deleted: true };
      });
    }
    case "design_put_files": {
      const toolArguments = decodeToolArguments(
        DesignPutFilesArgumentsSchema,
        unparsedToolArguments,
      );
      const uploads = toolArguments.files.map((file) => {
        const localPath = readRepositoryPath(collaborators.repoRoot, file.localPath);
        let path = basename(localPath);

        const hasFilePath = file.path != null;
        if (hasFilePath) path = file.path;

        return { localPath, path };
      });
      return runOnDesignPage(collaborators, (page) =>
        putDesignFiles(page, { projectId: toolArguments.projectId, uploads }),
      );
    }
    case "design_remove_files": {
      const toolArguments = decodeToolArguments(
        DesignRemoveFilesArgumentsSchema,
        unparsedToolArguments,
      );
      const isConfirmNotGiven = toolArguments.confirm !== true;
      if (isConfirmNotGiven) {
        return {
          ok: false,
          output: `Refusing to delete ${toolArguments.paths.length} file(s) from ${toolArguments.projectId} without confirm:true.`,
        };
      }

      return runOnDesignPage(collaborators, (page) =>
        removeDesignFiles(page, { projectId: toolArguments.projectId, paths: toolArguments.paths }),
      );
    }
    case "design_download": {
      const toolArguments = decodeToolArguments(
        DesignDownloadArgumentsSchema,
        unparsedToolArguments,
      );

      let format: "files" | "zip" = "files";
      const hasFormat = toolArguments.format != null;
      if (hasFormat) format = toolArguments.format;

      const outDirectory = downloadDirectory(
        collaborators,
        toolArguments.projectId,
        toolArguments.outDir,
      );
      return runOnDesignPage(collaborators, async (page) => ({
        files: await downloadDesignProject(page, {
          projectId: toolArguments.projectId,
          format,
          paths: toolArguments.paths,
          outDir: outDirectory,
        }),
      }));
    }
    case "design_share": {
      const toolArguments = decodeToolArguments(DesignShareArgumentsSchema, unparsedToolArguments);
      return runOnDesignPage(collaborators, (page) =>
        shareDesignProject(page, {
          projectId: toolArguments.projectId,
          access: toolArguments.access,
          linkPermission: toolArguments.linkPermission,
        }),
      );
    }
  }
};

// Destructive tools require confirm:true. Never throws — failures return { ok: false }.
export const runDesignGatewayCall = async (
  collaborators: AskGatewayCollaborators,
  tool: DesignGatewayTool,
  unparsedToolArguments: unknown,
): Promise<AskToolReport> => {
  try {
    return await runDecodedDesignCall(collaborators, tool, unparsedToolArguments);
  } catch (error) {
    return { ok: false, output: readGatewayErrorMessage(error) };
  }
};

const DESIGN_TOOL_DEFINITIONS: Record<
  DesignGatewayTool,
  { readonly description: string; readonly schema: z.ZodObject }
> = {
  design_state: {
    description:
      "Where Claude Design is: home or project page, project, model + effort, whether a turn is running, open Design tabs, the actions available here, and the Share destinations left to you.",
    schema: DesignStatusArgumentsSchema,
  },
  design_list_projects: {
    description: "List Claude Design projects (or design systems) with id, name, url, sharing.",
    schema: DesignListProjectsArgumentsSchema,
  },
  design_catalog: {
    description:
      "Choices for new work: home templates, models with effort levels (incl. More models), and design systems.",
    schema: DesignCatalogArgumentsSchema,
  },
  design_choose_model: {
    description:
      "Pick the model (incl. More models) and effort in a project's composer, or on home for new projects. Like the UI, it becomes your Claude Design default.",
    schema: DesignChooseModelArgumentsSchema,
  },
  design_list_files: {
    description: "List the files in a Design project.",
    schema: DesignProjectArgumentsSchema,
  },
  design_read_conversation: {
    description:
      "Read a project's Conversations and the latest messages — what you asked and what Claude replied.",
    schema: DesignReadConversationArgumentsSchema,
  },
  design_open_project: {
    description: "Open (or focus) the project's tab in the bridge Chrome.",
    schema: DesignProjectArgumentsSchema,
  },
  design_create_project: {
    description:
      "Create a Design project. With a prompt: home composer with optional template, model, effort, and attachments, then wait for Claude's first reply. Without: a blank project.",
    schema: DesignCreateProjectArgumentsSchema,
  },
  design_send: {
    description:
      "Send a message in a project's Conversation (optional model, effort, design systems, attachments) and return Claude's reply. status is replied, running, or waiting-for-answer. For long turns pass wait:false, then poll design_read_conversation.",
    schema: DesignSendArgumentsSchema,
  },
  design_new_conversation: {
    description: "Start a new Conversation in a project and return its id.",
    schema: DesignProjectArgumentsSchema,
  },
  design_rename_conversation: {
    description: "Rename a Conversation in a project.",
    schema: DesignRenameConversationArgumentsSchema,
  },
  design_update_project: {
    description: "Rename a project, star/unstar it, or set its design systems.",
    schema: DesignUpdateProjectArgumentsSchema,
  },
  design_duplicate_project: {
    description: "Duplicate a project and return the copy's id.",
    schema: DesignProjectArgumentsSchema,
  },
  design_delete_project: {
    description: "Permanently delete a project (requires confirm:true).",
    schema: DesignDeleteProjectArgumentsSchema,
  },
  design_put_files: {
    description: "Add repo files to a project; an existing path is replaced.",
    schema: DesignPutFilesArgumentsSchema,
  },
  design_remove_files: {
    description: "Delete files from a project (requires confirm:true).",
    schema: DesignRemoveFilesArgumentsSchema,
  },
  design_download: {
    description:
      "Download project files, or the whole project as a zip, into the repo (.bridge/downloads/design by default).",
    schema: DesignDownloadArgumentsSchema,
  },
  design_share: {
    description:
      "Set who can open the project (private or workspace, with view/comment/edit) and return its link.",
    schema: DesignShareArgumentsSchema,
  },
};

export const registerDesignGatewayTools = (
  mcp: McpServer,
  collaborators: AskGatewayCollaborators,
): void => {
  // One Chrome drives every Design call; run them one at a time so menus never interleave.
  let designQueue: Promise<unknown> = Promise.resolve();
  for (const tool of DESIGN_GATEWAY_TOOLS) {
    const definition = DESIGN_TOOL_DEFINITIONS[tool];
    mcp.registerTool(
      tool,
      {
        description: definition.description,
        inputSchema: definition.schema.shape,
      },
      async (toolArguments: Record<string, unknown>) => {
        const runAfterPreviousCall = async () => {
          await designQueue;
          return runDesignGatewayCall(collaborators, tool, toolArguments);
        };
        const gatewayReply = runAfterPreviousCall();
        designQueue = gatewayReply;
        return readMcpStringFromGatewayReply(await gatewayReply);
      },
    );
  }
};
