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
import type { AskGatewayCollaborators } from "./ask-gateway-server.ts";
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
import {
  readGatewayDocumentPrintout,
  readGatewayErrorMessage,
  readMcpReplyMessage,
} from "./gateway-replies.ts";

const DESIGN_SHARE_TOOL_NAME = "design_share";

const DESIGN_DOWNLOAD_TOOL_NAME = "design_download";

const DESIGN_REMOVE_FILES_TOOL_NAME = "design_remove_files";

const DESIGN_PUT_FILES_TOOL_NAME = "design_put_files";

const DESIGN_DELETE_PROJECT_TOOL_NAME = "design_delete_project";

const DESIGN_DUPLICATE_PROJECT_TOOL_NAME = "design_duplicate_project";

const DESIGN_UPDATE_PROJECT_TOOL_NAME = "design_update_project";

const DESIGN_RENAME_CONVERSATION_TOOL_NAME = "design_rename_conversation";

const DESIGN_NEW_CONVERSATION_TOOL_NAME = "design_new_conversation";

const DESIGN_SEND_TOOL_NAME = "design_send";

const DESIGN_CREATE_PROJECT_TOOL_NAME = "design_create_project";

const DESIGN_OPEN_PROJECT_TOOL_NAME = "design_open_project";

const DESIGN_READ_CONVERSATION_TOOL_NAME = "design_read_conversation";

const DESIGN_LIST_FILES_TOOL_NAME = "design_list_files";

const DESIGN_CHOOSE_MODEL_TOOL_NAME = "design_choose_model";

const DESIGN_CATALOG_TOOL_NAME = "design_catalog";

const DESIGN_LIST_PROJECTS_TOOL_NAME = "design_list_projects";

const DESIGN_STATUS_TOOL_NAME = "design_state";

export const DESIGN_GATEWAY_TOOLS = [
  DESIGN_STATUS_TOOL_NAME,
  DESIGN_LIST_PROJECTS_TOOL_NAME,
  DESIGN_CATALOG_TOOL_NAME,
  DESIGN_CHOOSE_MODEL_TOOL_NAME,
  DESIGN_LIST_FILES_TOOL_NAME,
  DESIGN_READ_CONVERSATION_TOOL_NAME,
  DESIGN_OPEN_PROJECT_TOOL_NAME,
  DESIGN_CREATE_PROJECT_TOOL_NAME,
  DESIGN_SEND_TOOL_NAME,
  DESIGN_NEW_CONVERSATION_TOOL_NAME,
  DESIGN_RENAME_CONVERSATION_TOOL_NAME,
  DESIGN_UPDATE_PROJECT_TOOL_NAME,
  DESIGN_DUPLICATE_PROJECT_TOOL_NAME,
  DESIGN_DELETE_PROJECT_TOOL_NAME,
  DESIGN_PUT_FILES_TOOL_NAME,
  DESIGN_REMOVE_FILES_TOOL_NAME,
  DESIGN_DOWNLOAD_TOOL_NAME,
  DESIGN_SHARE_TOOL_NAME,
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
  const timeoutSeconds = toolArguments.timeoutSeconds ?? DEFAULT_TURN_TIMEOUT_SECONDS;

  const millisecondsPerSecond = 1000;

  return {
    model: toolArguments.model,
    effort: toolArguments.effort,
    attachments: listRepoPaths(collaborators, toolArguments.attachments),
    autoDecide: toolArguments.autoDecide === true,
    wait: toolArguments.wait !== false,
    timeoutMilliseconds: timeoutSeconds * millisecondsPerSecond,
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
    case DESIGN_STATUS_TOOL_NAME:
      decodeToolArguments(DesignStatusArgumentsSchema, unparsedToolArguments);
      return runOnDesignPage(collaborators, (page) => readDesignStatus(page));
    case DESIGN_LIST_PROJECTS_TOOL_NAME: {
      const toolArguments = decodeToolArguments(
        DesignListProjectsArgumentsSchema,
        unparsedToolArguments,
      );

      const limit = toolArguments.limit ?? DEFAULT_PROJECT_LIMIT;
      const kind = toolArguments.kind ?? "projects";

      return runOnDesignPage(collaborators, (page) =>
        listDesignProjects(page, { kind, query: toolArguments.query, limit }),
      );
    }
    case DESIGN_CATALOG_TOOL_NAME:
      decodeToolArguments(DesignCatalogArgumentsSchema, unparsedToolArguments);
      return runOnDesignPage(collaborators, (page) => readDesignCatalog(page));
    case DESIGN_CHOOSE_MODEL_TOOL_NAME: {
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
    case DESIGN_LIST_FILES_TOOL_NAME: {
      const toolArguments = decodeToolArguments(
        DesignProjectArgumentsSchema,
        unparsedToolArguments,
      );
      return runOnDesignPage(collaborators, (page) =>
        listDesignFiles(page, toolArguments.projectId),
      );
    }
    case DESIGN_READ_CONVERSATION_TOOL_NAME: {
      const toolArguments = decodeToolArguments(
        DesignReadConversationArgumentsSchema,
        unparsedToolArguments,
      );

      const limit = toolArguments.limit ?? DEFAULT_READ_LIMIT;

      return runOnDesignPage(collaborators, async (page) => {
        const conversations = await listDesignConversations(page, toolArguments.projectId);

        const conversationDetails = await readDesignConversation(page, {
          projectId: toolArguments.projectId,
          conversationId: toolArguments.conversationId,
          limit,
        });

        return { conversations, ...conversationDetails };
      });
    }
    case DESIGN_OPEN_PROJECT_TOOL_NAME: {
      const toolArguments = decodeToolArguments(
        DesignProjectArgumentsSchema,
        unparsedToolArguments,
      );
      return runOnDesignPage(collaborators, async (page) => {
        const projectTab = await openDesignProjectTab(page, toolArguments.projectId);
        return { projectId: toolArguments.projectId, url: projectTab.url() };
      });
    }
    case DESIGN_CREATE_PROJECT_TOOL_NAME: {
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
    case DESIGN_SEND_TOOL_NAME: {
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
    case DESIGN_NEW_CONVERSATION_TOOL_NAME: {
      const toolArguments = decodeToolArguments(
        DesignProjectArgumentsSchema,
        unparsedToolArguments,
      );
      return runOnDesignPage(collaborators, async (page) => {
        const conversationId = await startNewDesignConversation(page, toolArguments.projectId);

        return { projectId: toolArguments.projectId, conversationId };
      });
    }
    case DESIGN_RENAME_CONVERSATION_TOOL_NAME: {
      const toolArguments = decodeToolArguments(
        DesignRenameConversationArgumentsSchema,
        unparsedToolArguments,
      );
      return runOnDesignPage(collaborators, async (page) => {
        await renameDesignConversation(page, toolArguments);
        return { ...toolArguments, renamed: true };
      });
    }
    case DESIGN_UPDATE_PROJECT_TOOL_NAME: {
      const toolArguments = decodeToolArguments(
        DesignUpdateProjectArgumentsSchema,
        unparsedToolArguments,
      );
      return runOnDesignPage(collaborators, (page) => updateDesignProject(page, toolArguments));
    }
    case DESIGN_DUPLICATE_PROJECT_TOOL_NAME: {
      const toolArguments = decodeToolArguments(
        DesignProjectArgumentsSchema,
        unparsedToolArguments,
      );
      return runOnDesignPage(collaborators, async (page) => {
        const projectId = await duplicateDesignProject(page, toolArguments.projectId);

        return { projectId };
      });
    }
    case DESIGN_DELETE_PROJECT_TOOL_NAME: {
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
    case DESIGN_PUT_FILES_TOOL_NAME: {
      const toolArguments = decodeToolArguments(
        DesignPutFilesArgumentsSchema,
        unparsedToolArguments,
      );
      const uploads = toolArguments.files.map((file) => {
        const localPath = readRepositoryPath(collaborators.repoRoot, file.localPath);
        const path = file.path ?? basename(localPath);

        return { localPath, path };
      });
      return runOnDesignPage(collaborators, (page) =>
        putDesignFiles(page, { projectId: toolArguments.projectId, uploads }),
      );
    }
    case DESIGN_REMOVE_FILES_TOOL_NAME: {
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
    case DESIGN_DOWNLOAD_TOOL_NAME: {
      const toolArguments = decodeToolArguments(
        DesignDownloadArgumentsSchema,
        unparsedToolArguments,
      );

      const format = toolArguments.format ?? "files";

      const outDirectory = downloadDirectory(
        collaborators,
        toolArguments.projectId,
        toolArguments.outDir,
      );
      return runOnDesignPage(collaborators, async (page) => {
        const files = await downloadDesignProject(page, {
          projectId: toolArguments.projectId,
          format,
          paths: toolArguments.paths,
          outDir: outDirectory,
        });

        return { files };
      });
    }
    case DESIGN_SHARE_TOOL_NAME: {
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

        const settledGatewayReply = await gatewayReply;
        return readMcpReplyMessage(settledGatewayReply);
      },
    );
  }
};
