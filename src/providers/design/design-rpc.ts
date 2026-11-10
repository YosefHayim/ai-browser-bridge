import type { Page } from "playwright";
import { z } from "zod";

// Calls Claude Design's own Connect JSON service, with the tab's cookies.
export const DESIGN_HOME_URL = "https://claude.ai/design";
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

// Connect JSON omits defaults and sends int64 as strings, so only identifiers are required.
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

export const ProjectDetailsReplySchema = z.object({
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
  const parsedDocument = JSON.parse(decodedDocument);
  return ProjectDocumentSchema.parse(parsedDocument);
};

const isClaudePage = (page: Page): boolean => {
  const pageUrl = page.url();

  const isUrlInvalid = !URL.canParse(pageUrl);
  if (isUrlInvalid) return false;

  const currentPageUrl = page.url();
  return new URL(currentPageUrl).hostname === "claude.ai";
};

// Relative fetches and cookies need the tab on claude.ai; a fresh tab can be about:blank.
const ensureClaudeOrigin = async (page: Page): Promise<void> => {
  if (isClaudePage(page)) return;

  await page.goto(DESIGN_HOME_URL, { waitUntil: "domcontentloaded" });
};

const readDesignOrganizationUuid = async (page: Page): Promise<string> => {
  const cookies = await page.context().cookies("https://claude.ai");

  const organizationCookie = cookies.find((cookie) => cookie.name === "lastActiveOrg");

  const isOrganizationCookieBlank =
    organizationCookie === undefined || organizationCookie.value.length === 0;
  if (isOrganizationCookieBlank) {
    throw new Error(`Claude Design: no active organization — ${SIGN_IN_HINT}.`);
  }

  return organizationCookie.value;
};

const sendDesignRpc = (page: Page, request: DesignRpcRequest): Promise<DesignRpcReply> => {
  return page.evaluate(
    async ({ method, body: callArguments, organizationUuid, servicePath }) => {
      const reply = await fetch(`${servicePath}/${method}`, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "connect-protocol-version": "1",
          "x-organization-uuid": organizationUuid,
        },
        body: JSON.stringify(callArguments),
      });

      return { status: reply.status, text: await reply.text() };
    },
    { ...request, servicePath: "/design/anthropic.omelette.api.v1alpha.OmeletteService" },
  );
};

const createDesignRpcFailure = (method: DesignRpcMethod, reply: DesignRpcReply): Error => {
  const forbiddenStatus = 403;

  const unauthorizedStatus = 401;

  const isAuthRejected = reply.status === unauthorizedStatus || reply.status === forbiddenStatus;
  if (isAuthRejected) {
    return new Error(`Claude Design ${method}: not signed in (${reply.status}) — ${SIGN_IN_HINT}.`);
  }

  const maxReplyCharacters = 200;

  let message = reply.text.slice(0, maxReplyCharacters);
  try {
    const parsedReply = JSON.parse(reply.text);
    const connectError = ConnectErrorSchema.parse(parsedReply);

    const connectMessage = connectError.message;
    const hasConnectErrorMessage = connectMessage != null;
    if (hasConnectErrorMessage) message = connectMessage;
  } catch (error) {
    // Non-Connect bodies (HTML error pages, or JSON without a Connect message) are reported raw.
    const isUnexpectedError = !(error instanceof SyntaxError || error instanceof z.ZodError);
    if (isUnexpectedError) throw error;
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
  const firstFailureStatus = 300;

  const firstSuccessStatus = 200;

  const isReplyFailed = reply.status < firstSuccessStatus || reply.status >= firstFailureStatus;
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

export const readProjectIdFromDesignUrl = (url: string): string | undefined => {
  const isNotUrlParse = !URL.canParse(url);
  if (isNotUrlParse) return undefined;

  const { hostname, pathname } = new URL(url);

  const isHostnameNotClaudeAi = hostname !== "claude.ai";
  if (isHostnameNotClaudeAi) return undefined;

  return /^\/design\/p\/(?<projectId>[\w-]+)(?:\/|$)/u.exec(pathname)?.groups?.projectId;
};

export const downloadDesignProjectZip = async (page: Page, projectId: string): Promise<Buffer> => {
  await ensureClaudeOrigin(page);
  const organizationUuid = await readDesignOrganizationUuid(page);

  const reply = await page.request.get(
    `${DESIGN_HOME_URL}/v1/design/projects/${encodeURIComponent(projectId)}/download`,
    { headers: { "x-organization-uuid": organizationUuid } },
  );

  const isReplyFailed = !reply.ok();
  if (isReplyFailed) {
    throw new Error(`Claude Design zip download failed (${reply.status()}).`);
  }

  return reply.body();
};
