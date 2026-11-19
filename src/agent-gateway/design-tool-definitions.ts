import type { z } from "zod";
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
import type { DesignGatewayTool } from "@/agent-gateway/design-gateway-tools.ts";

export const DESIGN_TOOL_DEFINITIONS: Record<
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
