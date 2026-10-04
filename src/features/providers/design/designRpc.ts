import { Schema } from "effect";
import type { Page } from "playwright";

// Claude Design's own Connect JSON service — the same calls the app makes from its tab,
// sent with the tab's cookies.
export const DESIGN_HOME_URL = "https://claude.ai/design";
const DESIGN_SERVICE_PATH = "/design/anthropic.omelette.api.v1alpha.OmeletteService";
const ORGANIZATION_COOKIE = "lastActiveOrg";
const SIGN_IN_HINT = "sign in at claude.ai in the bridge Chrome";

export const DESIGN_RPC_METHODS = [
  "GetMe",
  "GetOrgSettings",
  "ListProjects",
  "GetProject",
  "GetProjectData",
  "UpdateProjectData",
  "CreateProject",
  "UpdateProject",
  "DuplicateProject",
  "DeleteProject",
  "SetProjectFavorite",
  "UpdateProjectDesignSystems",
  "UpdateSharing",
  "ListFiles",
  "GetFile",
  "WriteFiles",
  "DeleteFile",
] as const;

export type DesignRpcMethod = (typeof DESIGN_RPC_METHODS)[number];

export type DesignRpcRequest = {
  readonly method: DesignRpcMethod;
  readonly body: unknown;
  readonly organizationUuid: string;
};

type DesignRpcReply = { readonly status: number; readonly text: string };

// Connect JSON omits default values and encodes int64 as strings, so only identifiers
// are required and every enum stays a plain string.
const SharingSchema = Schema.Struct({
  viewMode: Schema.optional(Schema.String),
  scope: Schema.optional(Schema.String),
  linkPermission: Schema.optional(Schema.String),
});

const DesignSystemRefSchema = Schema.Struct({ dsProjectId: Schema.String });

const ModelPresetSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  effortOptions: Schema.optionalWith(
    Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.optional(Schema.String) })),
    { default: () => [] },
  ),
});

export const MeReplySchema = Schema.Struct({
  modelPresets: Schema.optionalWith(Schema.Array(ModelPresetSchema), { default: () => [] }),
  defaultModelId: Schema.optional(Schema.String),
});

export const OrgSettingsReplySchema = Schema.Struct({
  defaultDesignSystemProjectUuid: Schema.optional(Schema.String),
});

const ProjectSummarySchema = Schema.Struct({
  projectId: Schema.String,
  name: Schema.optional(Schema.String),
  type: Schema.optional(Schema.String),
  viewedAt: Schema.optional(Schema.String),
  isOwned: Schema.optional(Schema.Boolean),
  isFavorite: Schema.optional(Schema.Boolean),
  publishedAt: Schema.optional(Schema.String),
  sharing: Schema.optional(SharingSchema),
});

export type DesignProjectSummaryWire = typeof ProjectSummarySchema.Type;

export const ListProjectsReplySchema = Schema.Struct({
  items: Schema.optionalWith(Schema.Array(ProjectSummarySchema), { default: () => [] }),
  cursor: Schema.optionalWith(Schema.String, { default: () => "" }),
});

export const GetProjectReplySchema = Schema.Struct({
  projectId: Schema.String,
  name: Schema.optional(Schema.String),
  type: Schema.optional(Schema.String),
  sharing: Schema.optional(SharingSchema),
  designSystems: Schema.optionalWith(Schema.Array(DesignSystemRefSchema), { default: () => [] }),
  callerCanEdit: Schema.optional(Schema.Boolean),
  callerCanDelete: Schema.optional(Schema.Boolean),
});

export const ProjectDataReplySchema = Schema.Struct({
  data: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
});

export const ProjectIdReplySchema = Schema.Struct({ projectId: Schema.String });

export const EmptyReplySchema = Schema.Struct({});

export const UpdateSharingReplySchema = Schema.Struct({ sharing: Schema.optional(SharingSchema) });

export const UpdateDesignSystemsReplySchema = Schema.Struct({
  designSystems: Schema.optionalWith(Schema.Array(DesignSystemRefSchema), { default: () => [] }),
});

export const ListFilesReplySchema = Schema.Struct({
  entries: Schema.optionalWith(
    Schema.Array(
      Schema.Struct({
        path: Schema.String,
        name: Schema.optional(Schema.String),
        type: Schema.optional(Schema.String),
        size: Schema.optional(Schema.String),
        contentType: Schema.optional(Schema.String),
        updatedAt: Schema.optional(Schema.String),
      }),
    ),
    { default: () => [] },
  ),
  // Connect JSON omits zero values, so a missing total means unknown, not empty.
  total: Schema.optional(Schema.Number),
});

export const GetFileReplySchema = Schema.Struct({
  content: Schema.optional(Schema.String),
  contentType: Schema.optional(Schema.String),
});

export const WriteFilesReplySchema = Schema.Struct({
  files: Schema.optionalWith(
    Schema.Array(Schema.Struct({ path: Schema.String, version: Schema.optional(Schema.String) })),
    { default: () => [] },
  ),
});

export const DeleteFileReplySchema = Schema.Struct({
  deleted: Schema.optionalWith(Schema.Number, { default: () => 0 }),
});

const ConnectErrorSchema = Schema.parseJson(
  Schema.Struct({ code: Schema.optional(Schema.String), message: Schema.optional(Schema.String) }),
);

// The project document the app keeps in GetProjectData (base64 JSON).
const ChatMessageSchema = Schema.Struct({
  id: Schema.optional(Schema.String),
  role: Schema.String,
  kind: Schema.optional(Schema.String),
  content: Schema.optional(Schema.String),
  timestamp: Schema.optional(Schema.String),
  authorName: Schema.optional(Schema.String),
});

const ChatSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.optional(Schema.String),
  created: Schema.optional(Schema.String),
  lastOpened: Schema.optional(Schema.String),
  messages: Schema.optionalWith(Schema.Array(ChatMessageSchema), { default: () => [] }),
});

export const ProjectDocumentSchema = Schema.Struct({
  name: Schema.optional(Schema.String),
  chats: Schema.optionalWith(Schema.Record({ key: Schema.String, value: ChatSchema }), {
    default: () => ({}),
  }),
  // "New chat" moves the open chat here; the history menu lists both.
  closedChats: Schema.optionalWith(Schema.Array(ChatSchema), { default: () => [] }),
  viewState: Schema.optional(Schema.Struct({ activeChatId: Schema.optional(Schema.String) })),
});

export type DesignProjectDocument = typeof ProjectDocumentSchema.Type;

const decodeProjectDocument = Schema.decodeUnknownSync(Schema.parseJson(ProjectDocumentSchema));

export const projectDocumentFromBase64 = (encoded: string): DesignProjectDocument => {
  return decodeProjectDocument(Buffer.from(encoded, "base64").toString("utf8"));
};

const isClaudePage = (page: Page): boolean => {
  if (!URL.canParse(page.url())) return false;
  return new URL(page.url()).hostname === "claude.ai";
};

// Relative fetches and cookies need the tab on claude.ai; a fresh tab can be about:blank.
const ensureClaudeOrigin = async (page: Page): Promise<void> => {
  if (isClaudePage(page)) return;
  await page.goto(DESIGN_HOME_URL, { waitUntil: "domcontentloaded" });
};

export const designOrganizationUuid = async (page: Page): Promise<string> => {
  const cookies = await page.context().cookies("https://claude.ai");
  const organizationCookie = cookies.find((cookie) => cookie.name === ORGANIZATION_COOKIE);
  if (organizationCookie === undefined || organizationCookie.value.length === 0) {
    throw new Error(`Claude Design: no active organization — ${SIGN_IN_HINT}.`);
  }
  return organizationCookie.value;
};

const sendDesignRpc = (page: Page, request: DesignRpcRequest): Promise<DesignRpcReply> => {
  return page.evaluate(
    async ({ method, body, organizationUuid, servicePath }) => {
      const response = await fetch(`${servicePath}/${method}`, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "connect-protocol-version": "1",
          "x-organization-uuid": organizationUuid,
        },
        body: JSON.stringify(body),
      });
      return { status: response.status, text: await response.text() };
    },
    { ...request, servicePath: DESIGN_SERVICE_PATH },
  );
};

const designRpcFailure = (method: DesignRpcMethod, reply: DesignRpcReply): Error => {
  if (reply.status === 401 || reply.status === 403) {
    return new Error(`Claude Design ${method}: not signed in (${reply.status}) — ${SIGN_IN_HINT}.`);
  }
  let message = reply.text.slice(0, 200);
  try {
    const connectError = Schema.decodeUnknownSync(ConnectErrorSchema)(reply.text);
    if (connectError.message !== undefined) message = connectError.message;
  } catch {
    // Non-Connect bodies (HTML error pages) are reported raw.
  }
  return new Error(`Claude Design ${method} failed (${reply.status}): ${message}`);
};

export const callDesignRpc = async <A, I>(input: {
  readonly page: Page;
  readonly method: DesignRpcMethod;
  readonly body: unknown;
  readonly replySchema: Schema.Schema<A, I>;
}): Promise<A> => {
  await ensureClaudeOrigin(input.page);
  const organizationUuid = await designOrganizationUuid(input.page);
  const reply = await sendDesignRpc(input.page, {
    method: input.method,
    body: input.body,
    organizationUuid,
  });
  if (reply.status < 200 || reply.status >= 300) throw designRpcFailure(input.method, reply);
  try {
    return Schema.decodeUnknownSync(Schema.parseJson(input.replySchema))(reply.text);
  } catch (error) {
    const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
    throw new Error(`Claude Design ${input.method}: unexpected reply shape (${reason}).`);
  }
};

export const designProjectUrl = (projectId: string): string => {
  return `${DESIGN_HOME_URL}/p/${encodeURIComponent(projectId)}`;
};

const PROJECT_PATH = /^\/design\/p\/(?<projectId>[\w-]+)(?:\/|$)/u;

export const projectIdFromDesignUrl = (url: string): string | undefined => {
  if (!URL.canParse(url)) return undefined;
  const { hostname, pathname } = new URL(url);
  if (hostname !== "claude.ai") return undefined;
  return PROJECT_PATH.exec(pathname)?.groups?.projectId;
};

export const downloadDesignProjectZip = async (page: Page, projectId: string): Promise<Buffer> => {
  await ensureClaudeOrigin(page);
  const organizationUuid = await designOrganizationUuid(page);
  const response = await page.request.get(
    `${DESIGN_HOME_URL}/v1/design/projects/${encodeURIComponent(projectId)}/download`,
    { headers: { "x-organization-uuid": organizationUuid } },
  );
  if (!response.ok()) {
    throw new Error(`Claude Design zip download failed (${response.status()}).`);
  }
  return response.body();
};
