import { join, resolve } from "node:path";
import { startEngine } from "@/bridge/bridge-engine.ts";
import {
  addClipToPrompt,
  addClipToScene,
  clearIngredients,
  deleteClip,
  deleteFlowProject,
  downloadClip,
  listClips,
  listFlowProjects,
  listIngredients,
  removeIngredient,
  renameClip,
  renameFlowProject,
} from "@/providers/flow/flow-assets.ts";
import { generateClipFromFrame } from "@/providers/flow/flow-generate.ts";
import { readDownloadsDirectory } from "@/store/paths.ts";
import { fail, failUsage } from "./cli-failure.ts";
import {
  DEBUG_PORT_FLAG,
  PORT_FLAG,
  parsePortFlag,
  readProfileRootFromOption,
} from "./cli-option-readers.ts";
import type { FlowCommandSettings } from "./cli-types.ts";
import { requireBrowserPage } from "./engine-session.ts";

export const startFlowSession = async (settings: FlowCommandSettings) => {
  const engine = await startEngine({
    repoPath: settings.repo ? resolve(settings.repo) : undefined,
    provider: "flow",
    mcpPort: parsePortFlag(PORT_FLAG, settings.port),
    withBrowser: true,
    withTools: false,
    debugPort: parsePortFlag(DEBUG_PORT_FLAG, settings.debugPort),
    profileRoot: readProfileRootFromOption(settings.profile),
  });

  return { engine, page: requireBrowserPage(engine) };
};

const readDefaultFlowPrintoutDirectory = (repoRoot: string): string =>
  join(readDownloadsDirectory(repoRoot), "flow");

const requireClipId = (settings: FlowCommandSettings, verb: string): string => {
  const id = settings.id?.[0];

  const isIdBlank = id == null || id === "";
  if (isIdBlank) return failUsage(`Usage: bridge flow ${verb} --id <clipId>`);

  return id;
};

export const runFlowClips = async (settings: FlowCommandSettings): Promise<void> => {
  const { engine, page } = await startFlowSession(settings);
  const clips = await listClips(page);
  await engine.shutDown({ closeBrowser: false });

  if (settings.json) process.stdout.write(`${JSON.stringify(clips)}\n`);
  else if (clips.length === 0) process.stdout.write("No clips in the current Flow project.\n");
  else for (const clip of clips) process.stdout.write(`${clip.id}\t${clip.url}\n`);
};

export const runFlowProjects = async (settings: FlowCommandSettings): Promise<void> => {
  const { engine, page } = await startFlowSession(settings);
  const projects = await listFlowProjects(page);
  await engine.shutDown({ closeBrowser: false });

  if (settings.json) process.stdout.write(`${JSON.stringify(projects)}\n`);
  else if (projects.length === 0) process.stdout.write("No Flow projects.\n");
  else for (const project of projects) process.stdout.write(`${project.id}\t${project.title}\n`);
};

export const runFlowDownload = async (settings: FlowCommandSettings): Promise<void> => {
  const { engine, page } = await startFlowSession(settings);
  const clips = await listClips(page);
  const hasId = settings.id && settings.id.length > 0;
  const targets = hasId ? settings.id : clips.map((clip) => clip.id);
  const outDir = settings.out
    ? resolve(settings.out)
    : readDefaultFlowPrintoutDirectory(engine.config.repoPath);
  const reports: Array<{ id: string; ok: boolean; file?: string; error?: string }> = [];
  for (const id of targets) {
    try {
      reports.push({ id, ok: true, file: await downloadClip(page, id, outDir) });
    } catch (caughtError) {
      const isErrorObject = caughtError instanceof Error;
      reports.push({
        id,
        ok: false,
        error: isErrorObject ? caughtError.message : String(caughtError),
      });
    }
  }
  await engine.shutDown({ closeBrowser: false });

  if (settings.json) process.stdout.write(`${JSON.stringify(reports)}\n`);
  else if (reports.length === 0) process.stdout.write("No clips to download.\n");
  else
    for (const download of reports) {
      if (download.ok)
        process.stdout.write(`${download.id}	${download.file}
`);
      else
        process.stdout.write(`${download.id}	ERROR ${download.error}
`);
    }

  const isAnyDownloadFailed = !reports.every((download) => download.ok);
  if (isAnyDownloadFailed) throw new Error("Some downloads failed.");
};

export const runFlowGenerate = async (settings: FlowCommandSettings): Promise<void> => {
  const startFramePath = settings.start ? resolve(settings.start) : "";

  const prompt = settings.prompt == null ? "" : settings.prompt.trim();

  const isVideoSetupIncomplete = !startFramePath || !prompt;
  if (isVideoSetupIncomplete) {
    failUsage("Usage: bridge flow generate --start <imagePath> --prompt <text> [--out <dir>]");
  }

  const { engine, page } = await startFlowSession(settings);
  const outDir = settings.out
    ? resolve(settings.out)
    : readDefaultFlowPrintoutDirectory(engine.config.repoPath);
  try {
    const clip = await generateClipFromFrame(page, {
      startFramePath,
      prompt,
      onProgress: (message) => process.stderr.write(`flow generate: ${message}\n`),
    });
    const file = await downloadClip(page, clip.id, outDir);
    await engine.shutDown({ closeBrowser: false });

    if (settings.json)
      process.stdout.write(`${JSON.stringify({ id: clip.id, url: clip.url, file })}\n`);
    else process.stdout.write(`${clip.id}\t${file}\n`);

    return;
  } catch (error) {
    await Promise.allSettled([engine.shutDown({ closeBrowser: false })]);
    const isErrorObject = error instanceof Error;
    return fail(isErrorObject ? error.message : String(error));
  }
};

export const runFlowDelete = async (settings: FlowCommandSettings): Promise<void> => {
  const id = requireClipId(settings, "delete");

  const isYesNotGiven = !settings.yes;
  if (isYesNotGiven) {
    failUsage(
      "Refusing to delete without --yes. `bridge flow delete --id <clipId> --yes` moves the clip to Flow Trash (recoverable).",
    );
  }

  const { engine, page } = await startFlowSession(settings);
  await deleteClip(page, id);
  await engine.shutDown({ closeBrowser: false });
  process.stdout.write(
    settings.json
      ? `${JSON.stringify({ id, movedToTrash: true })}\n`
      : `Moved clip ${id} to Trash.\n`,
  );
};

export const runFlowRename = async (settings: FlowCommandSettings): Promise<void> => {
  const id = requireClipId(settings, "rename");

  const name = settings.name?.trim();

  const isNameEmpty = !name;
  if (isNameEmpty) return failUsage("Usage: bridge flow rename --id <clipId> --name <text>");

  const { engine, page } = await startFlowSession(settings);
  await renameClip(page, id, name);
  await engine.shutDown({ closeBrowser: false });
  process.stdout.write(
    settings.json ? `${JSON.stringify({ id, name })}\n` : `Renamed clip ${id} to "${name}".\n`,
  );
};

export const runFlowExtend = async (settings: FlowCommandSettings): Promise<void> => {
  const id = requireClipId(settings, "extend");
  const { engine, page } = await startFlowSession(settings);

  await addClipToScene(page, id);
  await engine.shutDown({ closeBrowser: false });
  process.stdout.write(
    settings.json
      ? `${JSON.stringify({ id, addedTo: "scene" })}\n`
      : `Added clip ${id} to scene.\n`,
  );
};

export const runFlowReuse = async (settings: FlowCommandSettings): Promise<void> => {
  const id = requireClipId(settings, "reuse");
  const { engine, page } = await startFlowSession(settings);

  await addClipToPrompt(page, id);
  await engine.shutDown({ closeBrowser: false });
  process.stdout.write(
    settings.json
      ? `${JSON.stringify({ id, addedTo: "prompt" })}\n`
      : `Added clip ${id} to prompt.\n`,
  );
};

export const runFlowProjectRename = async (settings: FlowCommandSettings): Promise<void> => {
  const name = settings.name?.trim();

  const isNameEmpty = !name;
  if (isNameEmpty) return failUsage("Usage: bridge flow project-rename --name <text>");

  const { engine, page } = await startFlowSession(settings);
  await renameFlowProject(page, name);
  await engine.shutDown({ closeBrowser: false });
  process.stdout.write(
    settings.json ? `${JSON.stringify({ project: name })}\n` : `Renamed project to "${name}".\n`,
  );
};

export const runFlowProjectDelete = async (settings: FlowCommandSettings): Promise<void> => {
  const isYesNotGiven = !settings.yes;
  if (isYesNotGiven) {
    failUsage(
      "Refusing to delete a project without --yes. `bridge flow project-delete --yes` permanently deletes the current project.",
    );
  }

  const { engine, page } = await startFlowSession(settings);
  await deleteFlowProject(page);
  await engine.shutDown({ closeBrowser: false });
  process.stdout.write(
    settings.json
      ? `${JSON.stringify({ deleted: true })}\n`
      : "Deleted the current Flow project.\n",
  );
};

export const runFlowIngredients = async (settings: FlowCommandSettings): Promise<void> => {
  const { engine, page } = await startFlowSession(settings);
  const ingredients = await listIngredients(page);
  await engine.shutDown({ closeBrowser: false });

  if (settings.json) process.stdout.write(`${JSON.stringify(ingredients)}\n`);
  else if (ingredients.length === 0)
    process.stdout.write("No ingredients attached to the prompt.\n");
  else for (const element of ingredients) process.stdout.write(`${element.id}\t${element.url}\n`);
};

export const runFlowIngredientRemove = async (settings: FlowCommandSettings): Promise<void> => {
  const id = settings.id?.[0];

  const isIdBlank = id == null || id === "";
  if (isIdBlank) return failUsage("Usage: bridge flow ingredient-remove --id <mediaId>");

  const { engine, page } = await startFlowSession(settings);
  await removeIngredient(page, id);
  await engine.shutDown({ closeBrowser: false });
  process.stdout.write(
    settings.json ? `${JSON.stringify({ id, removed: true })}\n` : `Removed ingredient ${id}.\n`,
  );
};

export const runFlowIngredientClear = async (settings: FlowCommandSettings): Promise<void> => {
  const { engine, page } = await startFlowSession(settings);
  const removed = await clearIngredients(page);

  await engine.shutDown({ closeBrowser: false });
  process.stdout.write(
    settings.json ? `${JSON.stringify({ removed })}\n` : `Removed ${removed} ingredient(s).\n`,
  );
};
