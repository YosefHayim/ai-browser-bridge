import { basename, join, resolve } from "node:path";
import { Schema } from "effect";
import type { Page } from "playwright";
import {
  createDesignProject,
  DESIGN_LINK_PERMISSIONS,
  DESIGN_SHARE_ACCESS,
  type DesignCatalog,
  type DesignConversationRead,
  type DesignConversationSummary,
  type DesignFile,
  type DesignProject,
  type DesignState,
  type DesignTurnOutcome,
  deleteDesignProject,
  downloadDesignProject,
  duplicateDesignProject,
  listDesignConversations,
  listDesignFiles,
  listDesignProjects,
  openDesignProjectTab,
  putDesignFiles,
  readDesignCatalog,
  readDesignConversation,
  readDesignState,
  removeDesignFiles,
  renameDesignConversation,
  sendDesignMessage,
  setDesignModel,
  shareDesignProject,
  startNewDesignConversation,
  updateDesignProject,
} from "@/features/providers";
import { downloadsDir } from "@/features/store";
import { withDesignPage } from "./cliOperations.ts";
import type { DesignCmdOptions } from "./cliTypes.ts";

const DEFAULT_TURN_TIMEOUT_SECONDS = 600;
const DEFAULT_READ_LIMIT = 20;
const DEFAULT_PROJECT_LIMIT = 50;

const writeFailure = (error: unknown): never => {
  let message = String(error);
  if (error instanceof Error) message = error.message;
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

// process.exit drops unflushed pipe writes, so exit only once stdout took the output.
const writeStdout = (text: string): Promise<void> => {
  return new Promise((resolveWrite) => {
    process.stdout.write(text, () => resolveWrite());
  });
};

// The CLI edge: one Design page operation, then JSON or human lines, then exit.
const runDesignCommand = async <T>(
  options: DesignCmdOptions,
  operation: (page: Page, repoRoot: string) => Promise<T>,
  formatText: (value: T) => string,
): Promise<void> => {
  try {
    const value = await withDesignPage(options, operation);
    if (options.json === true) await writeStdout(`${JSON.stringify(value)}\n`);
    else await writeStdout(`${formatText(value)}\n`);
    process.exit(0);
  } catch (error) {
    writeFailure(error);
  }
};

const requireOption = (value: string | undefined, flag: string): string => {
  if (value === undefined || value.trim().length === 0) {
    return writeFailure(new Error(`Missing ${flag}.`));
  }
  return value.trim();
};

const positiveIntegerOption = (value: string | undefined, fallback: number): number => {
  if (value === undefined) return fallback;
  const parsed = Number(value.trim());
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return writeFailure(new Error(`Expected a positive whole number, got "${value}".`));
  }
  return parsed;
};

const localPaths = (paths: readonly string[] | undefined): string[] => {
  if (paths === undefined) return [];
  return paths.map((path) => resolve(path));
};

const designSystemIdsOption = (options: DesignCmdOptions): readonly string[] | undefined => {
  if (options.none === true) return [];
  return options.designSystem;
};

const turnOptions = (options: DesignCmdOptions) => ({
  model: options.model,
  effort: options.effort,
  attachments: localPaths(options.attach),
  autoDecide: options.autoDecide === true,
  wait: options.wait !== false,
  timeoutMs: positiveIntegerOption(options.timeout, DEFAULT_TURN_TIMEOUT_SECONDS) * 1000,
});

const formatTurn = (outcome: DesignTurnOutcome): string => {
  const lines = [`${outcome.status}\tproject ${outcome.projectId}`];
  if (outcome.conversationId !== undefined) lines.push(`conversation ${outcome.conversationId}`);
  if (outcome.model !== undefined) lines.push(`model ${outcome.model}`);
  for (const message of outcome.messages) lines.push(`\n[${message.role}]\n${message.content}`);
  return lines.join("\n");
};

const formatProjects = (projects: readonly DesignProject[]): string => {
  if (projects.length === 0) return "No Claude Design projects.";
  return projects
    .map((project) => {
      let access = "";
      if (project.sharing !== undefined) access = project.sharing.access;
      let star = "";
      if (project.favorite) star = "\t★";
      return `${project.id}\t${project.name}\t${access}${star}`;
    })
    .join("\n");
};

const formatState = (state: DesignState): string => {
  const lines = [`page\t${state.page}\t${state.url}`];
  if (state.projectId !== undefined) {
    let title = "";
    if (state.projectTitle !== undefined) title = state.projectTitle;
    lines.push(`project\t${state.projectId}\t${title}`);
  }
  if (state.model !== undefined) lines.push(`model\t${state.model}`);
  lines.push(`busy\t${state.busy}`);
  for (const tab of state.tabs) lines.push(`tab\t${tab.busy ? "busy" : "idle"}\t${tab.url}`);
  lines.push(`actions\t${state.actions.join(", ")}`);
  lines.push(`manual\t${state.manual.join(", ")}`);
  return lines.join("\n");
};

const formatCatalog = (catalog: DesignCatalog): string => {
  const lines = [`Templates: ${catalog.templates.join(", ")}`, "Models:"];
  for (const model of catalog.models) {
    let marker = "";
    if (model.isDefault) marker = " (default)";
    lines.push(`  ${model.label}${marker}\t${model.id}\teffort: ${model.efforts.join(", ")}`);
  }
  lines.push("Design systems:");
  for (const designSystem of catalog.designSystems) {
    let marker = "";
    if (designSystem.isOrgDefault) marker = " (org default)";
    lines.push(`  ${designSystem.id}\t${designSystem.name}${marker}`);
  }
  return lines.join("\n");
};

const formatConversations = (conversations: readonly DesignConversationSummary[]): string[] => {
  return conversations.map((conversation) => {
    let marker = " ";
    if (conversation.active) marker = "*";
    let state = "";
    if (!conversation.open) state = "\tclosed";
    return `${marker} ${conversation.id}\t${conversation.title}\t${conversation.messageCount} messages${state}`;
  });
};

const formatRead = (
  read: DesignConversationRead & { readonly conversations: DesignConversationSummary[] },
): string => {
  const lines = formatConversations(read.conversations);
  lines.push(`\nConversation ${read.conversation.id} — ${read.conversation.title}`);
  for (const message of read.messages) lines.push(`\n[${message.role}]\n${message.content}`);
  return lines.join("\n");
};

const formatFiles = (files: readonly DesignFile[]): string => {
  if (files.length === 0) return "No files.";
  return files
    .map((file) => {
      let size = "";
      if (file.size !== undefined) size = `${file.size} B`;
      return `${file.path}\t${file.kind}\t${size}`;
    })
    .join("\n");
};

const formatLines = (lines: readonly string[]): string => lines.join("\n");

const projectDownloadDir = (options: DesignCmdOptions, repoRoot: string, projectId: string) => {
  if (options.out !== undefined) return resolve(options.out);
  return join(downloadsDir(repoRoot), "design", basename(projectId));
};

export const runDesignState = (options: DesignCmdOptions): Promise<void> => {
  return runDesignCommand(options, (page) => readDesignState(page), formatState);
};

export const runDesignProjects = (options: DesignCmdOptions): Promise<void> => {
  let kind: "projects" | "design-systems" = "projects";
  if (options.designSystems === true) kind = "design-systems";
  const limit = positiveIntegerOption(options.limit, DEFAULT_PROJECT_LIMIT);
  return runDesignCommand(
    options,
    (page) => listDesignProjects(page, { kind, query: options.query, limit }),
    formatProjects,
  );
};

export const runDesignCatalog = (options: DesignCmdOptions): Promise<void> => {
  return runDesignCommand(options, (page) => readDesignCatalog(page), formatCatalog);
};

export const runDesignModel = (options: DesignCmdOptions): Promise<void> => {
  if (options.model === undefined && options.effort === undefined) {
    return writeFailure(new Error("Pass --model <label> and/or --effort <level>."));
  }
  return runDesignCommand(
    options,
    (page) =>
      setDesignModel(page, {
        projectId: options.project,
        model: options.model,
        effort: options.effort,
      }),
    (chosen) => `model\t${chosen.model}`,
  );
};

export const runDesignOpen = (options: DesignCmdOptions): Promise<void> => {
  const projectId = requireOption(options.project, "--project");
  return runDesignCommand(
    options,
    async (page) => ({ projectId, url: (await openDesignProjectTab(page, projectId)).url() }),
    (opened) => opened.url,
  );
};

export const runDesignCreate = (options: DesignCmdOptions): Promise<void> => {
  return runDesignCommand(
    options,
    (page) =>
      createDesignProject(page, {
        name: options.name,
        prompt: options.prompt,
        template: options.template,
        designSystemIds: designSystemIdsOption(options),
        ...turnOptions(options),
      }),
    formatTurn,
  );
};

export const runDesignSend = (options: DesignCmdOptions): Promise<void> => {
  const projectId = requireOption(options.project, "--project");
  const message = requireOption(options.message, "--message");
  return runDesignCommand(
    options,
    (page) =>
      sendDesignMessage(page, {
        projectId,
        message,
        conversationId: options.conversation,
        designSystemIds: designSystemIdsOption(options),
        ...turnOptions(options),
      }),
    formatTurn,
  );
};

export const runDesignRead = (options: DesignCmdOptions): Promise<void> => {
  const projectId = requireOption(options.project, "--project");
  const limit = positiveIntegerOption(options.limit, DEFAULT_READ_LIMIT);
  return runDesignCommand(
    options,
    async (page) => ({
      conversations: await listDesignConversations(page, projectId),
      ...(await readDesignConversation(page, {
        projectId,
        conversationId: options.conversation,
        limit,
      })),
    }),
    formatRead,
  );
};

export const runDesignNewConversation = (options: DesignCmdOptions): Promise<void> => {
  const projectId = requireOption(options.project, "--project");
  return runDesignCommand(
    options,
    async (page) => ({
      projectId,
      conversationId: await startNewDesignConversation(page, projectId),
    }),
    (created) => created.conversationId,
  );
};

export const runDesignRenameConversation = (options: DesignCmdOptions): Promise<void> => {
  const projectId = requireOption(options.project, "--project");
  const conversationId = requireOption(options.conversation, "--conversation");
  const title = requireOption(options.title, "--title");
  return runDesignCommand(
    options,
    async (page) => {
      await renameDesignConversation(page, { projectId, conversationId, title });
      return { projectId, conversationId, title };
    },
    (renamed) => `Renamed ${renamed.conversationId} to "${renamed.title}".`,
  );
};

const runProjectUpdate = (
  options: DesignCmdOptions,
  changes: { readonly name?: string; readonly favorite?: boolean },
): Promise<void> => {
  const projectId = requireOption(options.project, "--project");
  return runDesignCommand(
    options,
    (page) =>
      updateDesignProject(page, {
        projectId,
        ...changes,
        designSystemIds: designSystemIdsOption(options),
      }),
    (project) =>
      `${project.id}\t${project.name}\tdesign systems: ${project.designSystemIds.length}`,
  );
};

export const runDesignRename = (options: DesignCmdOptions): Promise<void> => {
  return runProjectUpdate(options, { name: requireOption(options.name, "--name") });
};

export const runDesignFavorite = (options: DesignCmdOptions): Promise<void> => {
  return runProjectUpdate(options, { favorite: options.off !== true });
};

export const runDesignUseDesignSystems = (options: DesignCmdOptions): Promise<void> => {
  if (designSystemIdsOption(options) === undefined) {
    return writeFailure(new Error("Pass --design-system <id...> or --none."));
  }
  return runProjectUpdate(options, {});
};

export const runDesignDuplicate = (options: DesignCmdOptions): Promise<void> => {
  const projectId = requireOption(options.project, "--project");
  return runDesignCommand(
    options,
    async (page) => ({ projectId: await duplicateDesignProject(page, projectId) }),
    (duplicated) => duplicated.projectId,
  );
};

export const runDesignDelete = (options: DesignCmdOptions): Promise<void> => {
  const projectId = requireOption(options.project, "--project");
  if (options.yes !== true) {
    return writeFailure(new Error(`Refusing to delete ${projectId} without --yes (permanent).`));
  }
  return runDesignCommand(
    options,
    async (page) => {
      await deleteDesignProject(page, projectId);
      return { projectId, deleted: true };
    },
    (deleted) => `Deleted ${deleted.projectId}.`,
  );
};

export const runDesignFiles = (options: DesignCmdOptions): Promise<void> => {
  const projectId = requireOption(options.project, "--project");
  return runDesignCommand(options, (page) => listDesignFiles(page, projectId), formatFiles);
};

export const runDesignPut = (options: DesignCmdOptions): Promise<void> => {
  const projectId = requireOption(options.project, "--project");
  const uploads = localPaths(options.file).map((localPath) => {
    let path = basename(localPath);
    if (options.dir !== undefined) path = `${options.dir.replace(/\/+$/u, "")}/${path}`;
    return { localPath, path };
  });
  if (uploads.length === 0) return writeFailure(new Error("Pass --file <path...>."));
  return runDesignCommand(
    options,
    (page) => putDesignFiles(page, { projectId, uploads }),
    (written) => formatLines(written.map((file) => `put\t${file.path}`)),
  );
};

export const runDesignRemove = (options: DesignCmdOptions): Promise<void> => {
  const projectId = requireOption(options.project, "--project");
  const paths = options.path;
  if (paths === undefined || paths.length === 0) {
    return writeFailure(new Error("Pass --path <projectPath...>."));
  }
  if (options.yes !== true) {
    return writeFailure(new Error(`Refusing to delete ${paths.length} file(s) without --yes.`));
  }
  return runDesignCommand(
    options,
    (page) => removeDesignFiles(page, { projectId, paths }),
    (removed) => formatLines(removed.map((file) => `removed\t${file.path}\t${file.deleted}`)),
  );
};

export const runDesignDownload = (options: DesignCmdOptions): Promise<void> => {
  const projectId = requireOption(options.project, "--project");
  return runDesignCommand(
    options,
    async (page, repoRoot) => ({
      files: await downloadDesignProject(page, {
        projectId,
        format: "files",
        paths: options.path,
        outDir: projectDownloadDir(options, repoRoot, projectId),
      }),
    }),
    (downloaded) => formatLines(downloaded.files),
  );
};

export const runDesignExport = (options: DesignCmdOptions): Promise<void> => {
  const projectId = requireOption(options.project, "--project");
  return runDesignCommand(
    options,
    async (page, repoRoot) => ({
      files: await downloadDesignProject(page, {
        projectId,
        format: "zip",
        paths: undefined,
        outDir: projectDownloadDir(options, repoRoot, projectId),
      }),
    }),
    (exported) => formatLines(exported.files),
  );
};

export const runDesignShare = (options: DesignCmdOptions): Promise<void> => {
  const projectId = requireOption(options.project, "--project");
  let access: (typeof DESIGN_SHARE_ACCESS)[number];
  let linkPermission: (typeof DESIGN_LINK_PERMISSIONS)[number] | undefined;
  try {
    access = Schema.decodeUnknownSync(Schema.Literal(...DESIGN_SHARE_ACCESS))(options.access);
    linkPermission = Schema.decodeUnknownSync(
      Schema.UndefinedOr(Schema.Literal(...DESIGN_LINK_PERMISSIONS)),
    )(options.permission);
  } catch {
    return writeFailure(
      new Error(
        `Use --access ${DESIGN_SHARE_ACCESS.join("|")} and --permission ${DESIGN_LINK_PERMISSIONS.join("|")}.`,
      ),
    );
  }
  return runDesignCommand(
    options,
    (page) => shareDesignProject(page, { projectId, access, linkPermission }),
    (shared) => {
      let sharing = "";
      if (shared.sharing !== undefined) {
        sharing = `${shared.sharing.access} (${shared.sharing.linkPermission})`;
      }
      return `${sharing}\t${shared.url}`;
    },
  );
};
