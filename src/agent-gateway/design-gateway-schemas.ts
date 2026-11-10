import { z } from "zod";
import { DESIGN_DOWNLOAD_FORMATS } from "@/providers/design/design-files.ts";
import {
  DESIGN_LINK_PERMISSIONS,
  DESIGN_PROJECT_KINDS,
  DESIGN_SHARE_ACCESS,
} from "@/providers/design/design-projects.ts";

const ProjectIdField = z
  .string()
  .min(1)
  .describe("Design project id from design_list_projects (the id in /design/p/<id>).");

const ConversationIdField = z
  .string()
  .min(1)
  .describe("Conversation id from design_read_conversation.");

const ConfirmField = z.boolean().optional().describe("Must be true — this cannot be undone.");

const RepoPathsField = (description: string) =>
  z.array(z.string().min(1)).optional().describe(description);

const DesignSystemIdsField = z
  .array(z.string())
  .optional()
  .describe("Design system project ids from design_catalog (empty array clears them).");

const TurnFields = {
  model: z
    .string()
    .optional()
    .describe('Model label or id from design_catalog, e.g. "Haiku 4.5" (More models included).'),
  effort: z.string().optional().describe("Effort level: Low, Medium, High, Extra, or Max."),
  attachments: RepoPathsField("Repo-relative files to attach to this message."),
  autoDecide: z
    .boolean()
    .optional()
    .describe("Answer Claude's clarifying questions with 'Decide for me'."),
  wait: z
    .boolean()
    .optional()
    .describe("Wait for the reply (default true). false returns while the turn runs."),
  timeoutSeconds: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Max seconds to wait for the reply (default 600)."),
};

export const DesignStatusArgumentsSchema = z.object({});

export const DesignChooseModelArgumentsSchema = z.object({
  projectId: ProjectIdField.optional().describe(
    "Project whose composer to set; omit for the home composer (new projects).",
  ),
  model: TurnFields.model,
  effort: TurnFields.effort,
});
export const DesignCatalogArgumentsSchema = z.object({});

export const DesignListProjectsArgumentsSchema = z.object({
  kind: z.enum(DESIGN_PROJECT_KINDS).optional().describe("projects (default) or design-systems."),
  query: z.string().optional().describe("Search by name."),
  limit: z.number().int().positive().optional(),
});

export const DesignProjectArgumentsSchema = z.object({ projectId: ProjectIdField });

export const DesignReadConversationArgumentsSchema = z.object({
  projectId: ProjectIdField,
  conversationId: ConversationIdField.optional(),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Most recent messages to return (default 20)."),
});

export const DesignCreateProjectArgumentsSchema = z.object({
  name: z.string().optional(),
  prompt: z
    .string()
    .min(1)
    .optional()
    .describe("First message. Omit to create a blank project without a turn."),
  template: z
    .string()
    .optional()
    .describe("Home template, e.g. Slides or Wireframe. The prompt completes its starter text."),
  designSystemIds: z
    .array(z.string())
    .optional()
    .describe(
      "Design system project ids from design_catalog. Only without a prompt: a blank project takes them, then design_send starts the turn.",
    ),
  ...TurnFields,
});

export const DesignSendArgumentsSchema = z.object({
  projectId: ProjectIdField,
  message: z.string().min(1),
  conversationId: ConversationIdField.optional(),
  designSystemIds: DesignSystemIdsField,
  ...TurnFields,
});

export const DesignRenameConversationArgumentsSchema = z.object({
  projectId: ProjectIdField,
  conversationId: ConversationIdField,
  title: z.string().min(1),
});

export const DesignUpdateProjectArgumentsSchema = z.object({
  projectId: ProjectIdField,
  name: z.string().min(1).optional(),
  favorite: z.boolean().optional(),
  designSystemIds: DesignSystemIdsField,
});

export const DesignDeleteProjectArgumentsSchema = z.object({
  projectId: ProjectIdField,
  confirm: ConfirmField,
});

export const DesignPutFilesArgumentsSchema = z.object({
  projectId: ProjectIdField,
  files: z
    .array(
      z.object({
        localPath: z.string().min(1).describe("Repo-relative file to upload."),
        path: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Path inside the project (default: the file name). Existing paths are replaced.",
          ),
      }),
    )
    .min(1),
});

export const DesignRemoveFilesArgumentsSchema = z.object({
  projectId: ProjectIdField,
  paths: z.array(z.string().min(1)).min(1),
  confirm: ConfirmField,
});

export const DesignDownloadArgumentsSchema = z.object({
  projectId: ProjectIdField,
  format: z
    .enum(DESIGN_DOWNLOAD_FORMATS)
    .optional()
    .describe("files (default) writes project files; zip writes the project archive."),
  paths: RepoPathsField("Project file paths for format files (default: every file)."),
  outDir: z
    .string()
    .optional()
    .describe("Repo-relative folder (default .bridge/downloads/design/<projectId>)."),
});

export const DesignShareArgumentsSchema = z.object({
  projectId: ProjectIdField,
  access: z
    .enum(DESIGN_SHARE_ACCESS)
    .describe("private (only you) or workspace (your organization)."),
  linkPermission: z.enum(DESIGN_LINK_PERMISSIONS).optional(),
});
