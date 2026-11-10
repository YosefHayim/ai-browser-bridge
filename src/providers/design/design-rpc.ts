import type { Page } from "playwright";
import { z } from "zod";

// Claude Design's own Connect JSON service — the same calls the app makes from its tab,
// sent with the tab's cookies.
export const DESIGN_HOME_URL = "https://claude.ai/design";
const DESIGN_SERVICE_PATH = "/design/anthropic.omelette.api.v1alpha.OmeletteService";
const ORGANIZATION_COOKIE = "lastActiveOrg";
const SIGN_IN_HINT = "sign in at claude.ai in the bridge Chrome";

const DESIGN_RPC_METHODS = [
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

type DesignRpcRequest = {
  readonly method: DesignRpcMethod;
  readonly body: unknown;
  readonly organizationUuid: string;
};

type DesignRpcReply = { readonly status: number; readonly text: string };

// Connect JSON omits default values and encodes int64 as strings, so only identifiers
// are required and every enum stays a plain string.
const SharingSchema = z.object({
  viewMode: z.string().optional(),
  scope: z.string().optional(),
  linkPermission: z.string().optional(),
});

const DesignSystemRefSchema = z.object({ dsProjectId: z.string() });

const ModelPresetSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  description: z.string().optional(),
  effortOptions: z.array(z.object({ id: z.string(), name: z.string().optional() })).default([]),
});

export const MeReplySchema = z.object({
  modelPresets: z.array(ModelPresetSchema).default([]),
  defaultModelId: z.string().optional(),
});

export const OrgSettingsReplySchema = z.object({
  defaultDesignSystemProjectUuid: z.string().optional(),
});

const ProjectSummarySchema = z.object({
  projectId: z.string(),
  name: z.string().optional(),
  type: z.string().optional(),
  viewedAt: z.string().optional(),
  isOwned: z.boolean().optional(),
  isFavorite: z.boolean().optional(),
  publishedAt: z.string().optional(),
  sharing: SharingSchema.optional(),
});

export type DesignProjectSummaryWire = z.infer<typeof ProjectSummarySchema>;

export const ListProjectsReplySchema = z.object({
  items: z.array(ProjectSummarySchema).default([]),
  cursor: z.string().default(""),
});

export const GetProjectReplySchema = z.object({
  projectId: z.string(),
  name: z.string().optional(),
  type: z.string().optional(),
  sharing: SharingSchema.optional(),
  designSystems: z.array(DesignSystemRefSchema).default([]),
  callerCanEdit: z.boolean().optional(),
  callerCanDelete: z.boolean().optional(),
});

export const ProjectDataReplySchema = z.object({
  data: z.string().optional(),
  version: z.string().optional(),
});

export const ProjectIdReplySchema = z.object({ projectId: z.string() });

export const EmptyReplySchema = z.object({});

export const UpdateSharingReplySchema = z.object({ sharing: SharingSchema.optional() });

export const UpdateDesignSystemsReplySchema = z.object({
  designSystems: z.array(DesignSystemRefSchema).default([]),
});

export const ListFilesReplySchema = z.object({
  entries: z
    .array(
      z.object({
        path: z.string(),
        name: z.string().optional(),
        type: z.string().optional(),
        size: z.string().optional(),
        contentType: z.string().optional(),
        updatedAt: z.string().optional(),
      }),
    )
    .default([]),
  // Connect JSON omits zero values, so a missing total means unknown, not empty.
  total: z.number().optional(),
});

export const GetFileReplySchema = z.object({
  content: z.string().optional(),
  contentType: z.string().optional(),
});

export const WriteFilesReplySchema = z.object({
  files: z.array(z.object({ path: z.string(), version: z.string().optional() })).default([]),
});

export const DeleteFileReplySchema = z.object({
  deleted: z.number().default(0),
});

const ConnectErrorSchema = z.object({
  code: z.string().optional(),
  message: z.string().optional(),
});

// The project document the app keeps in GetProjectData (base64 JSON).
const ChatMessageSchema = z.object({
  id: z.string().optional(),
  role: z.string(),
  kind: z.string().optional(),
  content: z.string().optional(),
  timestamp: z.string().optional(),
  authorName: z.string().optional(),
});

const ChatSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  created: z.string().optional(),
  lastOpened: z.string().optional(),
  messages: z.array(ChatMessageSchema).default([]),
});

const ProjectDocumentSchema = z.object({
  name: z.string().optional(),
  chats: z.record(z.string(), ChatSchema).default({}),
  // "New chat" moves the open chat here; the history menu lists both.
  closedChats: z.array(ChatSchema).default([]),
  viewState: z.object({ activeChatId: z.string().optional() }).optional(),
});

export type DesignProjectDocument = z.infer<typeof ProjectDocumentSchema>;

export const readProjectDocumentFromBase64 = (encoded: string): DesignProjectDocument => {
  const decodedDocument = Buffer.from(encoded, "base64").toString("utf8");
  return ProjectDocumentSchema.parse(JSON.parse(decodedDocument));
};

const isClaudePage = (page: Page): boolean => {
  const isUrlInvalid = !URL.canParse(page.url());
  if (isUrlInvalid) return false;

  return new URL(page.url()).hostname === "claude.ai";
};

// Relative fetches and cookies need the tab on claude.ai; a fresh tab can be about:blank.
const ensureClaudeOrigin = async (page: Page): Promise<void> => {
  if (isClaudePage(page)) return;

  await page.goto(DESIGN_HOME_URL, { waitUntil: "domcontentloaded" });
};

const readDesignOrganizationUuid = async (page: Page): Promise<string> => {
  const cookies = await page.context().cookies("https://claude.ai");

  const organizationCookie = cookies.find((cookie) => cookie.name === ORGANIZATION_COOKIE);
  const isOrganizationCookieBlank =
    organizationCookie === undefined || organizationCookie.value.length === 0;
  if (isOrganizationCookieBlank) {
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

const createDesignRpcFailure = (method: DesignRpcMethod, reply: DesignRpcReply): Error => {
  const isAuthRejected = reply.status === 401 || reply.status === 403;
  if (isAuthRejected) {
    return new Error(`Claude Design ${method}: not signed in (${reply.status}) — ${SIGN_IN_HINT}.`);
  }

  let message = reply.text.slice(0, 200);
  try {
    const connectError = ConnectErrorSchema.parse(JSON.parse(reply.text));

    const hasConnectErrorMessage = connectError.message !== undefined;
    if (hasConnectErrorMessage) message = connectError.message;
  } catch {
    // Non-Connect bodies (HTML error pages) are reported raw.
  }
  return new Error(`Claude Design ${method} failed (${reply.status}): ${message}`);
};

export const callDesignRpc = async <Reply>(rpcCall: {
  readonly page: Page;
  readonly method: DesignRpcMethod;
  readonly body: unknown;
  readonly replySchema: z.ZodType<Reply>;
}): Promise<Reply> => {
  await ensureClaudeOrigin(rpcCall.page);
  const organizationUuid = await readDesignOrganizationUuid(rpcCall.page);

  const reply = await sendDesignRpc(rpcCall.page, {
    method: rpcCall.method,
    body: rpcCall.body,
    organizationUuid,
  });
  const isReplyFailed = reply.status < 200 || reply.status >= 300;
  if (isReplyFailed) throw createDesignRpcFailure(rpcCall.method, reply);

  try {
    const decodedReply: unknown = JSON.parse(reply.text);
    return rpcCall.replySchema.parse(decodedReply);
  } catch (error) {
    const isErrorObject = error instanceof Error;
    const reason = isErrorObject ? error.message.split("\n")[0] : String(error);
    throw new Error(`Claude Design ${rpcCall.method}: unexpected reply shape (${reason}).`);
  }
};

export const readDesignProjectUrl = (projectId: string): string => {
  return `${DESIGN_HOME_URL}/p/${encodeURIComponent(projectId)}`;
};

const PROJECT_PATH = /^\/design\/p\/(?<projectId>[\w-]+)(?:\/|$)/u;

export const readProjectIdFromDesignUrl = (url: string): string | undefined => {
  const isNotUrlParse = !URL.canParse(url);
  if (isNotUrlParse) return undefined;

  const { hostname, pathname } = new URL(url);
  const isHostnameNotClaudeAi = hostname !== "claude.ai";
  if (isHostnameNotClaudeAi) return undefined;

  return PROJECT_PATH.exec(pathname)?.groups?.projectId;
};

export const downloadDesignProjectZip = async (page: Page, projectId: string): Promise<Buffer> => {
  await ensureClaudeOrigin(page);
  const organizationUuid = await readDesignOrganizationUuid(page);

  const response = await page.request.get(
    `${DESIGN_HOME_URL}/v1/design/projects/${encodeURIComponent(projectId)}/download`,
    { headers: { "x-organization-uuid": organizationUuid } },
  );
  const isResponseFailed = !response.ok();
  if (isResponseFailed) {
    throw new Error(`Claude Design zip download failed (${response.status()}).`);
  }

  return response.body();
};
