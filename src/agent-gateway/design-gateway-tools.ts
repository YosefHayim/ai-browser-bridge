import { basename, join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Page } from "playwright";
import type { z } from "zod";
import type { AskToolReport } from "@/agent-gateway/agent-gateway-schemas.ts";
import type { AskGatewayCollaborators } from "@/agent-gateway/ask-gateway.ts";
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
} from "@/agent-gateway/design-gateway-schemas.ts";
import {
  readGatewayDocumentPrintout,
  readMcpFailureReply,
  readMcpReplyMessage,
} from "@/agent-gateway/gateway-replies.ts";
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
import { readErrorMessage } from "@/read-error-message.ts";
import { readDownloadsDirectory, readRepositoryPath } from "@/repo-files/paths.ts";

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

function decodeToolArguments<Arguments>(
  schema: z.ZodType<Arguments>,
  toolArguments: unknown,
): Arguments {
  return schema.parse(toolArguments);
}

export class DesignGatewayTools {
  // One Chrome drives every Design call; run them one at a time so menus never interleave.
  private designQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly collaborators: AskGatewayCollaborators) {}

  registerTools = (mcp: McpServer): void => {
    for (const tool of DESIGN_GATEWAY_TOOLS) {
      const definition = DESIGN_TOOL_DEFINITIONS[tool];
      mcp.registerTool(
        tool,
        {
          description: definition.description,
          inputSchema: definition.schema.shape,
        },
        async (toolArguments: Record<string, unknown>) => {
          try {
            const gatewayReply = await this.queueCall(tool, toolArguments);
            return readMcpReplyMessage(gatewayReply);
          } catch (error) {
            return readMcpFailureReply(error);
          }
        },
      );
    }
  };

  runCall = async (
    tool: DesignGatewayTool,
    unparsedToolArguments: unknown,
  ): Promise<AskToolReport> => {
    try {
      return await this.runDecodedCall(tool, unparsedToolArguments);
    } catch (error) {
      return { ok: false, output: readErrorMessage(error) };
    }
  };

  private queueCall = async (
    tool: DesignGatewayTool,
    toolArguments: Record<string, unknown>,
  ): Promise<AskToolReport> => {
    const previousCall = this.designQueue;
    const gatewayReply = this.runAfter(previousCall, tool, toolArguments);
    this.designQueue = gatewayReply;

    return gatewayReply;
  };

  private runAfter = async (
    previousCall: Promise<unknown>,
    tool: DesignGatewayTool,
    toolArguments: Record<string, unknown>,
  ): Promise<AskToolReport> => {
    try {
      await previousCall;
    } catch {
      // The previous call's own caller reports its failure; this call still runs.
    }

    return this.runCall(tool, toolArguments);
  };

  private listRepoPaths = (paths: readonly string[] | undefined): string[] => {
    const isPathsMissing = paths == null;
    if (isPathsMissing) return [];

    return paths.map((path) => readRepositoryPath(this.collaborators.repoRoot, path));
  };

  private turnSettings = (toolArguments: {
    readonly model?: string | undefined;
    readonly effort?: string | undefined;
    readonly attachments?: readonly string[] | undefined;
    readonly autoDecide?: boolean | undefined;
    readonly wait?: boolean | undefined;
    readonly timeoutSeconds?: number | undefined;
  }) => {
    const timeoutSeconds = toolArguments.timeoutSeconds ?? DEFAULT_TURN_TIMEOUT_SECONDS;

    const millisecondsPerSecond = 1000;

    return {
      model: toolArguments.model,
      effort: toolArguments.effort,
      attachments: this.listRepoPaths(toolArguments.attachments),
      autoDecide: toolArguments.autoDecide === true,
      wait: toolArguments.wait !== false,
      timeoutMilliseconds: timeoutSeconds * millisecondsPerSecond,
    };
  };

  private downloadDirectory = (projectId: string, outDirectory: string | undefined) => {
    const hasOutDirectory = outDirectory != null;
    if (hasOutDirectory) return readRepositoryPath(this.collaborators.repoRoot, outDirectory);

    const downloadsDirectory = readDownloadsDirectory(this.collaborators.repoRoot);
    const projectDirectoryName = basename(projectId);
    return join(downloadsDirectory, "design", projectDirectoryName);
  };

  private runDecodedCall = async (
    tool: DesignGatewayTool,
    unparsedToolArguments: unknown,
  ): Promise<AskToolReport> => {
    switch (tool) {
      case DESIGN_STATUS_TOOL_NAME:
        decodeToolArguments(DesignStatusArgumentsSchema, unparsedToolArguments);
        return runOnProviderPage(this.collaborators, "design", (page) => readDesignStatus(page));
      case DESIGN_LIST_PROJECTS_TOOL_NAME: {
        const toolArguments = decodeToolArguments(
          DesignListProjectsArgumentsSchema,
          unparsedToolArguments,
        );

        const limit = toolArguments.limit ?? DEFAULT_PROJECT_LIMIT;
        const kind = toolArguments.kind ?? "projects";

        return runOnProviderPage(this.collaborators, "design", (page) =>
          listDesignProjects(page, { kind, query: toolArguments.query, limit }),
        );
      }
      case DESIGN_CATALOG_TOOL_NAME:
        decodeToolArguments(DesignCatalogArgumentsSchema, unparsedToolArguments);
        return runOnProviderPage(this.collaborators, "design", (page) => readDesignCatalog(page));
      case DESIGN_CHOOSE_MODEL_TOOL_NAME: {
        const toolArguments = decodeToolArguments(
          DesignChooseModelArgumentsSchema,
          unparsedToolArguments,
        );

        const isModelChoiceEmpty = toolArguments.model == null && toolArguments.effort == null;
        if (isModelChoiceEmpty) {
          return { ok: false, output: "design_choose_model needs model, effort, or both." };
        }

        return runOnProviderPage(this.collaborators, "design", (page) =>
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
        return runOnProviderPage(this.collaborators, "design", (page) =>
          listDesignFiles(page, toolArguments.projectId),
        );
      }
      case DESIGN_READ_CONVERSATION_TOOL_NAME: {
        const toolArguments = decodeToolArguments(
          DesignReadConversationArgumentsSchema,
          unparsedToolArguments,
        );

        const limit = toolArguments.limit ?? DEFAULT_READ_LIMIT;

        return runOnProviderPage(this.collaborators, "design", async (page) => {
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
        return runOnProviderPage(this.collaborators, "design", async (page) => {
          const projectTab = await openDesignProjectTab(page, toolArguments.projectId);
          return { projectId: toolArguments.projectId, url: projectTab.url() };
        });
      }
      case DESIGN_CREATE_PROJECT_TOOL_NAME: {
        const toolArguments = decodeToolArguments(
          DesignCreateProjectArgumentsSchema,
          unparsedToolArguments,
        );
        return runOnProviderPage(this.collaborators, "design", (page) =>
          createDesignProject(page, {
            name: toolArguments.name,
            prompt: toolArguments.prompt,
            template: toolArguments.template,
            designSystemIds: toolArguments.designSystemIds,
            ...this.turnSettings(toolArguments),
          }),
        );
      }
      case DESIGN_SEND_TOOL_NAME: {
        const toolArguments = decodeToolArguments(DesignSendArgumentsSchema, unparsedToolArguments);
        return runOnProviderPage(this.collaborators, "design", (page) =>
          sendDesignMessage(page, {
            projectId: toolArguments.projectId,
            message: toolArguments.message,
            conversationId: toolArguments.conversationId,
            designSystemIds: toolArguments.designSystemIds,
            ...this.turnSettings(toolArguments),
          }),
        );
      }
      case DESIGN_NEW_CONVERSATION_TOOL_NAME: {
        const toolArguments = decodeToolArguments(
          DesignProjectArgumentsSchema,
          unparsedToolArguments,
        );
        return runOnProviderPage(this.collaborators, "design", async (page) => {
          const conversationId = await startNewDesignConversation(page, toolArguments.projectId);

          return { projectId: toolArguments.projectId, conversationId };
        });
      }
      case DESIGN_RENAME_CONVERSATION_TOOL_NAME: {
        const toolArguments = decodeToolArguments(
          DesignRenameConversationArgumentsSchema,
          unparsedToolArguments,
        );
        return runOnProviderPage(this.collaborators, "design", async (page) => {
          await renameDesignConversation(page, toolArguments);
          return { ...toolArguments, renamed: true };
        });
      }
      case DESIGN_UPDATE_PROJECT_TOOL_NAME: {
        const toolArguments = decodeToolArguments(
          DesignUpdateProjectArgumentsSchema,
          unparsedToolArguments,
        );
        return runOnProviderPage(this.collaborators, "design", (page) =>
          updateDesignProject(page, toolArguments),
        );
      }
      case DESIGN_DUPLICATE_PROJECT_TOOL_NAME: {
        const toolArguments = decodeToolArguments(
          DesignProjectArgumentsSchema,
          unparsedToolArguments,
        );
        return runOnProviderPage(this.collaborators, "design", async (page) => {
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

        return runOnProviderPage(this.collaborators, "design", async (page) => {
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
          const localPath = readRepositoryPath(this.collaborators.repoRoot, file.localPath);
          const path = file.path ?? basename(localPath);

          return { localPath, path };
        });
        return runOnProviderPage(this.collaborators, "design", (page) =>
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

        return runOnProviderPage(this.collaborators, "design", (page) =>
          removeDesignFiles(page, {
            projectId: toolArguments.projectId,
            paths: toolArguments.paths,
          }),
        );
      }
      case DESIGN_DOWNLOAD_TOOL_NAME: {
        const toolArguments = decodeToolArguments(
          DesignDownloadArgumentsSchema,
          unparsedToolArguments,
        );

        const format = toolArguments.format ?? "files";

        const outDirectory = this.downloadDirectory(toolArguments.projectId, toolArguments.outDir);
        return runOnProviderPage(this.collaborators, "design", async (page) => {
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
        const toolArguments = decodeToolArguments(
          DesignShareArgumentsSchema,
          unparsedToolArguments,
        );
        return runOnProviderPage(this.collaborators, "design", (page) =>
          shareDesignProject(page, {
            projectId: toolArguments.projectId,
            access: toolArguments.access,
            linkPermission: toolArguments.linkPermission,
          }),
        );
      }
    }
  };
}
