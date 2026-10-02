import { Schema } from "effect";
import {
  DESIGN_DOWNLOAD_FORMATS,
  DESIGN_LINK_PERMISSIONS,
  DESIGN_PROJECT_KINDS,
  DESIGN_SHARE_ACCESS,
} from "@/features/providers";

const ProjectIdField = Schema.String.pipe(Schema.minLength(1)).annotations({
  description: "Design project id from design_list_projects (the id in /design/p/<id>).",
});

const ConversationIdField = Schema.String.pipe(Schema.minLength(1)).annotations({
  description: "Conversation id from design_read_conversation.",
});

const ConfirmField = Schema.optional(Schema.Boolean).annotations({
  description: "Must be true — this cannot be undone.",
});

const RepoPathsField = (description: string) =>
  Schema.optional(Schema.Array(Schema.String.pipe(Schema.minLength(1)))).annotations({
    description,
  });

const DesignSystemIdsField = Schema.optional(Schema.Array(Schema.String)).annotations({
  description: "Design system project ids from design_catalog (empty array clears them).",
});

const TurnFields = {
  model: Schema.optional(Schema.String).annotations({
    description: 'Model label or id from design_catalog, e.g. "Haiku 4.5" (More models included).',
  }),
  effort: Schema.optional(Schema.String).annotations({
    description: "Effort level: Low, Medium, High, Extra, or Max.",
  }),
  attachments: RepoPathsField("Repo-relative files to attach to this message."),
  autoDecide: Schema.optional(Schema.Boolean).annotations({
    description: "Answer Claude's clarifying questions with 'Decide for me'.",
  }),
  wait: Schema.optional(Schema.Boolean).annotations({
    description: "Wait for the reply (default true). false returns while the turn runs.",
  }),
  timeoutSeconds: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())).annotations({
    description: "Max seconds to wait for the reply (default 600).",
  }),
};

export const DesignStateArgsSchema = Schema.Struct({});

export const DesignChooseModelArgsSchema = Schema.Struct({
  projectId: Schema.optional(ProjectIdField).annotations({
    description: "Project whose composer to set; omit for the home composer (new projects).",
  }),
  model: TurnFields.model,
  effort: TurnFields.effort,
});
export const DesignCatalogArgsSchema = Schema.Struct({});

export const DesignListProjectsArgsSchema = Schema.Struct({
  kind: Schema.optional(Schema.Literal(...DESIGN_PROJECT_KINDS)).annotations({
    description: "projects (default) or design-systems.",
  }),
  query: Schema.optional(Schema.String).annotations({ description: "Search by name." }),
  limit: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())),
});

export const DesignProjectArgsSchema = Schema.Struct({ projectId: ProjectIdField });

export const DesignReadConversationArgsSchema = Schema.Struct({
  projectId: ProjectIdField,
  conversationId: Schema.optional(ConversationIdField),
  limit: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())).annotations({
    description: "Most recent messages to return (default 20).",
  }),
});

export const DesignCreateProjectArgsSchema = Schema.Struct({
  name: Schema.optional(Schema.String),
  prompt: Schema.optional(Schema.String.pipe(Schema.minLength(1))).annotations({
    description: "First message. Omit to create a blank project without a turn.",
  }),
  template: Schema.optional(Schema.String).annotations({
    description: "Home template, e.g. Slides or Wireframe. The prompt completes its starter text.",
  }),
  designSystemIds: Schema.optional(Schema.Array(Schema.String)).annotations({
    description:
      "Design system project ids from design_catalog. Only without a prompt: a blank project takes them, then design_send starts the turn.",
  }),
  ...TurnFields,
});

export const DesignSendArgsSchema = Schema.Struct({
  projectId: ProjectIdField,
  message: Schema.String.pipe(Schema.minLength(1)),
  conversationId: Schema.optional(ConversationIdField),
  designSystemIds: DesignSystemIdsField,
  ...TurnFields,
});

export const DesignRenameConversationArgsSchema = Schema.Struct({
  projectId: ProjectIdField,
  conversationId: ConversationIdField,
  title: Schema.String.pipe(Schema.minLength(1)),
});

export const DesignUpdateProjectArgsSchema = Schema.Struct({
  projectId: ProjectIdField,
  name: Schema.optional(Schema.String.pipe(Schema.minLength(1))),
  favorite: Schema.optional(Schema.Boolean),
  designSystemIds: DesignSystemIdsField,
});

export const DesignDeleteProjectArgsSchema = Schema.Struct({
  projectId: ProjectIdField,
  confirm: ConfirmField,
});

export const DesignPutFilesArgsSchema = Schema.Struct({
  projectId: ProjectIdField,
  files: Schema.Array(
    Schema.Struct({
      localPath: Schema.String.pipe(Schema.minLength(1)).annotations({
        description: "Repo-relative file to upload.",
      }),
      path: Schema.optional(Schema.String.pipe(Schema.minLength(1))).annotations({
        description:
          "Path inside the project (default: the file name). Existing paths are replaced.",
      }),
    }),
  ).pipe(Schema.minItems(1)),
});

export const DesignRemoveFilesArgsSchema = Schema.Struct({
  projectId: ProjectIdField,
  paths: Schema.Array(Schema.String.pipe(Schema.minLength(1))).pipe(Schema.minItems(1)),
  confirm: ConfirmField,
});

export const DesignDownloadArgsSchema = Schema.Struct({
  projectId: ProjectIdField,
  format: Schema.optional(Schema.Literal(...DESIGN_DOWNLOAD_FORMATS)).annotations({
    description: "files (default) writes project files; zip writes the project archive.",
  }),
  paths: RepoPathsField("Project file paths for format files (default: every file)."),
  outDir: Schema.optional(Schema.String).annotations({
    description: "Repo-relative folder (default .bridge/downloads/design/<projectId>).",
  }),
});

export const DesignShareArgsSchema = Schema.Struct({
  projectId: ProjectIdField,
  access: Schema.Literal(...DESIGN_SHARE_ACCESS).annotations({
    description: "private (only you) or workspace (your organization).",
  }),
  linkPermission: Schema.optional(Schema.Literal(...DESIGN_LINK_PERMISSIONS)),
});
