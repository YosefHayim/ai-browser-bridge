import type { Page } from "playwright";
import {
  callDesignRpc,
  type DesignProjectSummaryWire,
  designProjectUrl,
  EmptyReplySchema,
  GetProjectReplySchema,
  ListProjectsReplySchema,
  ProjectIdReplySchema,
  UpdateDesignSystemsReplySchema,
  UpdateSharingReplySchema,
} from "./designRpc.ts";

export const DESIGN_PROJECT_KINDS = ["projects", "design-systems"] as const;
export type DesignProjectKind = (typeof DESIGN_PROJECT_KINDS)[number];

export const DESIGN_SHARE_ACCESS = ["private", "workspace"] as const;
export type DesignShareAccess = (typeof DESIGN_SHARE_ACCESS)[number];

export const DESIGN_LINK_PERMISSIONS = ["view", "comment", "edit"] as const;
export type DesignLinkPermission = (typeof DESIGN_LINK_PERMISSIONS)[number];

const DESIGN_SYSTEM_TYPE = "PROJECT_TYPE_DESIGN_SYSTEM";

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

const linkPermissionFromWire = (wire: string | undefined): DesignLinkPermission | undefined => {
  for (const permission of DESIGN_LINK_PERMISSIONS) {
    if (LINK_PERMISSION_WIRE[permission] === wire) return permission;
  }
  return undefined;
};

const sharingFromWire = (
  wire: { readonly scope?: string; readonly linkPermission?: string } | undefined,
): DesignSharing | undefined => {
  if (wire === undefined) return undefined;
  let access: DesignShareAccess = "private";
  if (wire.scope === "SCOPE_ORG") access = "workspace";
  return { access, linkPermission: linkPermissionFromWire(wire.linkPermission) };
};

const projectKindFromWire = (wireType: string | undefined): DesignProjectKind => {
  if (wireType === DESIGN_SYSTEM_TYPE) return "design-systems";
  return "projects";
};

const projectFromWire = (wire: DesignProjectSummaryWire): DesignProject => {
  let name = "Untitled";
  if (wire.name !== undefined && wire.name.length > 0) name = wire.name;
  return {
    id: wire.projectId,
    name,
    kind: projectKindFromWire(wire.type),
    url: designProjectUrl(wire.projectId),
    viewedAt: wire.viewedAt,
    favorite: wire.isFavorite === true,
    owned: wire.isOwned === true,
    sharing: sharingFromWire(wire.sharing),
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
      const project = projectFromWire(wireProject);
      if (project.kind !== filter.kind) continue;
      projects.push(project);
      if (projects.length >= filter.limit) return projects;
    }
    if (reply.cursor.length === 0) return projects;
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
  const project = projectFromWire(reply);
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
  input: { readonly name: string; readonly designSystemIds: readonly string[] | undefined },
): Promise<DesignProjectDetails> => {
  const created = await callDesignRpc({
    page,
    method: "CreateProject",
    body: { name: input.name },
    replySchema: ProjectIdReplySchema,
  });
  if (input.designSystemIds !== undefined) {
    await setDesignProjectDesignSystems(page, {
      projectId: created.projectId,
      designSystemIds: input.designSystemIds,
    });
  }
  return readDesignProject(page, created.projectId);
};

export const renameDesignProject = async (
  page: Page,
  input: { readonly projectId: string; readonly name: string },
): Promise<void> => {
  await callDesignRpc({
    page,
    method: "UpdateProject",
    body: { projectId: input.projectId, name: input.name },
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

export const setDesignProjectFavorite = async (
  page: Page,
  input: { readonly projectId: string; readonly favorite: boolean },
): Promise<void> => {
  await callDesignRpc({
    page,
    method: "SetProjectFavorite",
    body: { projectId: input.projectId, favorite: input.favorite },
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
  input: { readonly projectId: string; readonly designSystemIds: readonly string[] },
): Promise<readonly string[]> => {
  const reply = await callDesignRpc({
    page,
    method: "UpdateProjectDesignSystems",
    body: {
      projectId: input.projectId,
      designSystems: input.designSystemIds.map((dsProjectId) => ({ dsProjectId })),
    },
    replySchema: UpdateDesignSystemsReplySchema,
  });
  return reply.designSystems.map((designSystem) => designSystem.dsProjectId);
};

export const shareDesignProject = async (
  page: Page,
  input: {
    readonly projectId: string;
    readonly access: DesignShareAccess;
    readonly linkPermission: DesignLinkPermission | undefined;
  },
): Promise<{ readonly url: string; readonly sharing: DesignSharing | undefined }> => {
  let linkPermission = input.linkPermission;
  if (linkPermission === undefined) {
    const current = await readDesignProject(page, input.projectId);
    linkPermission = current.sharing?.linkPermission;
  }
  if (linkPermission === undefined) linkPermission = "view";
  let scope = "SCOPE_INVITED";
  if (input.access === "workspace") scope = "SCOPE_ORG";
  const reply = await callDesignRpc({
    page,
    method: "UpdateSharing",
    body: {
      projectId: input.projectId,
      scope,
      linkPermission: LINK_PERMISSION_WIRE[linkPermission],
    },
    replySchema: UpdateSharingReplySchema,
  });
  return { url: designProjectUrl(input.projectId), sharing: sharingFromWire(reply.sharing) };
};

export type DesignProjectChanges = {
  readonly name?: string | undefined;
  readonly favorite?: boolean | undefined;
  readonly designSystemIds?: readonly string[] | undefined;
};

export const updateDesignProject = async (
  page: Page,
  input: DesignProjectChanges & { readonly projectId: string },
): Promise<DesignProjectDetails> => {
  if (input.name !== undefined) {
    await renameDesignProject(page, { projectId: input.projectId, name: input.name });
  }
  if (input.favorite !== undefined) {
    await setDesignProjectFavorite(page, {
      projectId: input.projectId,
      favorite: input.favorite,
    });
  }
  if (input.designSystemIds !== undefined) {
    await setDesignProjectDesignSystems(page, {
      projectId: input.projectId,
      designSystemIds: input.designSystemIds,
    });
  }
  return readDesignProject(page, input.projectId);
};
