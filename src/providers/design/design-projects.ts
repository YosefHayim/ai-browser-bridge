import type { Page } from "playwright";
import {
  callDesignRpc,
  type DesignProjectSummaryWire,
  EmptyReplySchema,
  GetProjectReplySchema,
  ListProjectsReplySchema,
  ProjectIdReplySchema,
  readDesignProjectUrl,
  UpdateDesignSystemsReplySchema,
  UpdateSharingReplySchema,
} from "./design-rpc.ts";

const WIRE_SCOPE_ORG = "SCOPE_ORG";

const VIEW_PERMISSION = "view";

const WORKSPACE_ACCESS = "workspace";

const DESIGN_SYSTEMS_KIND = "design-systems";

const PROJECTS_KEY = "projects";

export const DESIGN_PROJECT_KINDS = [PROJECTS_KEY, DESIGN_SYSTEMS_KIND] as const;
export type DesignProjectKind = (typeof DESIGN_PROJECT_KINDS)[number];

export const DESIGN_SHARE_ACCESS = ["private", WORKSPACE_ACCESS] as const;
export type DesignShareAccess = (typeof DESIGN_SHARE_ACCESS)[number];

export const DESIGN_LINK_PERMISSIONS = [VIEW_PERMISSION, "comment", "edit"] as const;
export type DesignLinkPermission = (typeof DESIGN_LINK_PERMISSIONS)[number];

export type DesignSharing = {
  readonly access: DesignShareAccess;
  readonly linkPermission: DesignLinkPermission | undefined;
};

export type DesignProject = {
  readonly id: string;
  readonly name: string;
  readonly kind: DesignProjectKind;
  readonly url: string;
  readonly viewedAt: string | undefined;
  readonly favorite: boolean;
  readonly owned: boolean;
  readonly sharing: DesignSharing | undefined;
};

// GetProject carries no favorite, ownership, or last-viewed fields; only ListProjects does.
export type DesignProjectDetails = Omit<DesignProject, "viewedAt" | "favorite" | "owned"> & {
  readonly designSystemIds: readonly string[];
  readonly canEdit: boolean;
  readonly canDelete: boolean;
};

const LINK_PERMISSION_WIRE: Record<DesignLinkPermission, string> = {
  view: "LINK_PERMISSION_VIEW",
  comment: "LINK_PERMISSION_COMMENT",
  edit: "LINK_PERMISSION_EDIT",
};

const readLinkPermissionFromWire = (wire: string | undefined): DesignLinkPermission | undefined => {
  for (const permission of DESIGN_LINK_PERMISSIONS) {
    const isPermissionMatching = LINK_PERMISSION_WIRE[permission] === wire;
    if (isPermissionMatching) return permission;
  }
  return undefined;
};

const readSharingFromWire = (
  wire: { readonly scope?: string; readonly linkPermission?: string } | undefined,
): DesignSharing | undefined => {
  const isWireMissing = wire == null;
  if (isWireMissing) return undefined;

  let access: DesignShareAccess = "private";

  const isWireScopeOrg = wire.scope === WIRE_SCOPE_ORG;
  if (isWireScopeOrg) access = WORKSPACE_ACCESS;

  return { access, linkPermission: readLinkPermissionFromWire(wire.linkPermission) };
};

const readProjectKindFromWire = (wireType: string | undefined): DesignProjectKind => {
  const isDesignSystemProject = wireType === "PROJECT_TYPE_DESIGN_SYSTEM";
  if (isDesignSystemProject) return DESIGN_SYSTEMS_KIND;

  return PROJECTS_KEY;
};

const readProjectFromWire = (wire: DesignProjectSummaryWire): DesignProject => {
  const wireName = wire.name;
  const hasWireName = wireName != null && wireName.length > 0;
  const name = hasWireName ? wireName : "Untitled";

  return {
    id: wire.projectId,
    name,
    kind: readProjectKindFromWire(wire.type),
    url: readDesignProjectUrl(wire.projectId),
    viewedAt: wire.viewedAt,
    favorite: wire.isFavorite === true,
    owned: wire.isOwned === true,
    sharing: readSharingFromWire(wire.sharing),
  };
};

export const listDesignProjects = async (
  page: Page,
  filter: {
    readonly kind: DesignProjectKind;
    readonly query?: string | undefined;
    readonly limit: number;
  },
): Promise<DesignProject[]> => {
  const projects: DesignProject[] = [];
  let cursor = "";
  for (;;) {
    const reply = await callDesignRpc({
      page,
      method: "ListProjects",
      body: { cursor, q: filter.query },
      replySchema: ListProjectsReplySchema,
    });
    for (const wireProject of reply.items) {
      const project = readProjectFromWire(wireProject);

      const isKindDifferent = project.kind !== filter.kind;
      if (isKindDifferent) continue;

      projects.push(project);

      const isLimitReached = projects.length >= filter.limit;
      if (isLimitReached) return projects;
    }

    const isReplyCursorEmpty = reply.cursor.length === 0;
    if (isReplyCursorEmpty) return projects;

    cursor = reply.cursor;
  }
};

export const readDesignProject = async (
  page: Page,
  projectId: string,
): Promise<DesignProjectDetails> => {
  const reply = await callDesignRpc({
    page,
    method: "GetProject",
    body: { projectId },
    replySchema: GetProjectReplySchema,
  });
  const project = readProjectFromWire(reply);

  return {
    id: project.id,
    name: project.name,
    kind: project.kind,
    url: project.url,
    sharing: project.sharing,
    designSystemIds: reply.designSystems.map((designSystem) => designSystem.dsProjectId),
    canEdit: reply.callerCanEdit === true,
    canDelete: reply.callerCanDelete === true,
  };
};

export const createBlankDesignProject = async (
  page: Page,
  request: { readonly name: string; readonly designSystemIds: readonly string[] | undefined },
): Promise<DesignProjectDetails> => {
  const created = await callDesignRpc({
    page,
    method: "CreateProject",
    body: { name: request.name },
    replySchema: ProjectIdReplySchema,
  });

  const hasDesignSystemIds = request.designSystemIds != null;
  if (hasDesignSystemIds) {
    await setDesignProjectDesignSystems(page, {
      projectId: created.projectId,
      designSystemIds: request.designSystemIds,
    });
  }

  return readDesignProject(page, created.projectId);
};

export const renameDesignProject = async (
  page: Page,
  request: { readonly projectId: string; readonly name: string },
): Promise<void> => {
  await callDesignRpc({
    page,
    method: "UpdateProject",
    body: { projectId: request.projectId, name: request.name },
    replySchema: EmptyReplySchema,
  });
};

export const duplicateDesignProject = async (page: Page, projectId: string): Promise<string> => {
  const duplicated = await callDesignRpc({
    page,
    method: "DuplicateProject",
    body: { projectId },
    replySchema: ProjectIdReplySchema,
  });

  return duplicated.projectId;
};

const setDesignProjectFavorite = async (
  page: Page,
  request: { readonly projectId: string; readonly favorite: boolean },
): Promise<void> => {
  await callDesignRpc({
    page,
    method: "SetProjectFavorite",
    body: { projectId: request.projectId, favorite: request.favorite },
    replySchema: EmptyReplySchema,
  });
};

export const deleteDesignProject = async (page: Page, projectId: string): Promise<void> => {
  await callDesignRpc({
    page,
    method: "DeleteProject",
    body: { projectId },
    replySchema: EmptyReplySchema,
  });
};

export const setDesignProjectDesignSystems = async (
  page: Page,
  request: { readonly projectId: string; readonly designSystemIds: readonly string[] },
): Promise<readonly string[]> => {
  const reply = await callDesignRpc({
    page,
    method: "UpdateProjectDesignSystems",
    body: {
      projectId: request.projectId,
      designSystems: request.designSystemIds.map((dsProjectId) => ({ dsProjectId })),
    },
    replySchema: UpdateDesignSystemsReplySchema,
  });

  return reply.designSystems.map((designSystem) => designSystem.dsProjectId);
};

export const shareDesignProject = async (
  page: Page,
  request: {
    readonly projectId: string;
    readonly access: DesignShareAccess;
    readonly linkPermission: DesignLinkPermission | undefined;
  },
): Promise<{ readonly url: string; readonly sharing: DesignSharing | undefined }> => {
  let linkPermission = request.linkPermission;

  const isLinkPermissionMissing = linkPermission == null;
  if (isLinkPermissionMissing) {
    const current = await readDesignProject(page, request.projectId);
    linkPermission = current.sharing?.linkPermission;
  }

  linkPermission ??= VIEW_PERMISSION;

  let scope = "SCOPE_INVITED";

  const isAccessWorkspace = request.access === WORKSPACE_ACCESS;
  if (isAccessWorkspace) scope = WIRE_SCOPE_ORG;

  const reply = await callDesignRpc({
    page,
    method: "UpdateSharing",
    body: {
      projectId: request.projectId,
      scope,
      linkPermission: LINK_PERMISSION_WIRE[linkPermission],
    },
    replySchema: UpdateSharingReplySchema,
  });
  return {
    url: readDesignProjectUrl(request.projectId),
    sharing: readSharingFromWire(reply.sharing),
  };
};

export type DesignProjectChanges = {
  readonly name?: string | undefined;
  readonly favorite?: boolean | undefined;
  readonly designSystemIds?: readonly string[] | undefined;
};

export const updateDesignProject = async (
  page: Page,
  request: DesignProjectChanges & { readonly projectId: string },
): Promise<DesignProjectDetails> => {
  const hasName = request.name != null;
  if (hasName) {
    await renameDesignProject(page, { projectId: request.projectId, name: request.name });
  }

  const hasFavorite = request.favorite != null;
  if (hasFavorite) {
    await setDesignProjectFavorite(page, {
      projectId: request.projectId,
      favorite: request.favorite,
    });
  }

  const hasDesignSystemIds = request.designSystemIds != null;
  if (hasDesignSystemIds) {
    await setDesignProjectDesignSystems(page, {
      projectId: request.projectId,
      designSystemIds: request.designSystemIds,
    });
  }

  return readDesignProject(page, request.projectId);
};
