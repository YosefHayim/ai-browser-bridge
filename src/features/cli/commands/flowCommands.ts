import { join, resolve } from "node:path";
import { downloadsDir } from "@/features/repoState/paths.ts";
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
} from "@/features/webProviders/flow/flowAssets.ts";
import { generateClipFromFrame } from "@/features/webProviders/flow/flowGenerate.ts";
import { startFlowSession } from "../browser/browserConnection.ts";
import type { FlowCmdOptions } from "../presentation/cliTypes.ts";
import { exitWithCliError } from "../presentation/commandOutput.ts";

const defaultFlowOutDir = (repoRoot: string): string => join(downloadsDir(repoRoot), "flow");

const requireClipId = (options: FlowCmdOptions, verb: string): string => {
  const id = options.id?.[0];
  if (id === undefined || id === "")
    return exitWithCliError(`Usage: bridge flow ${verb} --id <clipId>`);
  return id;
};

export const runFlowClips = async (options: FlowCmdOptions): Promise<void> => {
  const { engine, page } = await startFlowSession(options);
  const clips = await listClips(page);
  await engine.shutdown({ closeBrowser: false });
  if (options.json) process.stdout.write(`${JSON.stringify(clips)}\n`);
  else if (clips.length === 0) process.stdout.write("No clips in the current Flow project.\n");
  else for (const clip of clips) process.stdout.write(`${clip.id}\t${clip.url}\n`);
  process.exit(0);
};

export const runFlowProjects = async (options: FlowCmdOptions): Promise<void> => {
  const { engine, page } = await startFlowSession(options);
  const projects = await listFlowProjects(page);
  await engine.shutdown({ closeBrowser: false });
  if (options.json) process.stdout.write(`${JSON.stringify(projects)}\n`);
  else if (projects.length === 0) process.stdout.write("No Flow projects.\n");
  else for (const project of projects) process.stdout.write(`${project.id}\t${project.title}\n`);
  process.exit(0);
};

export const runFlowDownload = async (options: FlowCmdOptions): Promise<void> => {
  const { engine, page } = await startFlowSession(options);
  const clips = await listClips(page);
  const targets = options.id && options.id.length > 0 ? options.id : clips.map((clip) => clip.id);
  const outDir = options.out ? resolve(options.out) : defaultFlowOutDir(engine.config.repoPath);
  const clipDownloads: Array<{ id: string; ok: boolean; file?: string; error?: string }> = [];
  for (const id of targets) {
    try {
      clipDownloads.push({ id, ok: true, file: await downloadClip(page, id, outDir) });
    } catch (err) {
      clipDownloads.push({
        id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  await engine.shutdown({ closeBrowser: false });
  if (options.json) process.stdout.write(`${JSON.stringify(clipDownloads)}\n`);
  else if (clipDownloads.length === 0) process.stdout.write("No clips to download.\n");
  else
    for (const download of clipDownloads) {
      if (download.ok)
        process.stdout.write(`${download.id}	${download.file}
`);
      else
        process.stdout.write(`${download.id}	ERROR ${download.error}
`);
    }
  process.exit(clipDownloads.every((download) => download.ok) ? 0 : 1);
};

export const runFlowGenerate = async (options: FlowCmdOptions): Promise<void> => {
  const startFramePath = options.start ? resolve(options.start) : "";
  const prompt = options.prompt === undefined ? "" : options.prompt.trim();
  if (!startFramePath || !prompt) {
    exitWithCliError(
      "Usage: bridge flow generate --start <imagePath> --prompt <text> [--out <dir>]",
    );
  }
  const { engine, page } = await startFlowSession(options);
  const outDir = options.out ? resolve(options.out) : defaultFlowOutDir(engine.config.repoPath);
  try {
    const clip = await generateClipFromFrame(page, {
      startFramePath,
      prompt,
      onProgress: (message) => process.stderr.write(`flow generate: ${message}\n`),
    });
    const file = await downloadClip(page, clip.id, outDir);
    await engine.shutdown({ closeBrowser: false });
    if (options.json)
      process.stdout.write(`${JSON.stringify({ id: clip.id, url: clip.url, file })}\n`);
    else process.stdout.write(`${clip.id}\t${file}\n`);
    process.exit(0);
  } catch (err) {
    await Promise.allSettled([engine.shutdown({ closeBrowser: false })]);
    return exitWithCliError(err instanceof Error ? err.message : String(err));
  }
};

export const runFlowDelete = async (options: FlowCmdOptions): Promise<void> => {
  const id = requireClipId(options, "delete");
  if (!options.yes) {
    exitWithCliError(
      "Refusing to delete without --yes. `bridge flow delete --id <clipId> --yes` moves the clip to Flow Trash (recoverable).",
    );
  }
  const { engine, page } = await startFlowSession(options);
  await deleteClip(page, id);
  await engine.shutdown({ closeBrowser: false });
  process.stdout.write(
    options.json
      ? `${JSON.stringify({ id, movedToTrash: true })}\n`
      : `Moved clip ${id} to Trash.\n`,
  );
  process.exit(0);
};

export const runFlowRename = async (options: FlowCmdOptions): Promise<void> => {
  const id = requireClipId(options, "rename");
  const name = options.name?.trim();
  if (!name) return exitWithCliError("Usage: bridge flow rename --id <clipId> --name <text>");
  const { engine, page } = await startFlowSession(options);
  await renameClip(page, id, name);
  await engine.shutdown({ closeBrowser: false });
  process.stdout.write(
    options.json ? `${JSON.stringify({ id, name })}\n` : `Renamed clip ${id} to "${name}".\n`,
  );
  process.exit(0);
};

export const runFlowExtend = async (options: FlowCmdOptions): Promise<void> => {
  const id = requireClipId(options, "extend");
  const { engine, page } = await startFlowSession(options);
  await addClipToScene(page, id);
  await engine.shutdown({ closeBrowser: false });
  process.stdout.write(
    options.json ? `${JSON.stringify({ id, addedTo: "scene" })}\n` : `Added clip ${id} to scene.\n`,
  );
  process.exit(0);
};

export const runFlowReuse = async (options: FlowCmdOptions): Promise<void> => {
  const id = requireClipId(options, "reuse");
  const { engine, page } = await startFlowSession(options);
  await addClipToPrompt(page, id);
  await engine.shutdown({ closeBrowser: false });
  process.stdout.write(
    options.json
      ? `${JSON.stringify({ id, addedTo: "prompt" })}\n`
      : `Added clip ${id} to prompt.\n`,
  );
  process.exit(0);
};

export const runFlowProjectRename = async (options: FlowCmdOptions): Promise<void> => {
  const name = options.name?.trim();
  if (!name) return exitWithCliError("Usage: bridge flow project-rename --name <text>");
  const { engine, page } = await startFlowSession(options);
  await renameFlowProject(page, name);
  await engine.shutdown({ closeBrowser: false });
  process.stdout.write(
    options.json ? `${JSON.stringify({ project: name })}\n` : `Renamed project to "${name}".\n`,
  );
  process.exit(0);
};

export const runFlowProjectDelete = async (options: FlowCmdOptions): Promise<void> => {
  if (!options.yes) {
    exitWithCliError(
      "Refusing to delete a project without --yes. `bridge flow project-delete --yes` permanently deletes the current project.",
    );
  }
  const { engine, page } = await startFlowSession(options);
  await deleteFlowProject(page);
  await engine.shutdown({ closeBrowser: false });
  process.stdout.write(
    options.json ? `${JSON.stringify({ deleted: true })}\n` : "Deleted the current Flow project.\n",
  );
  process.exit(0);
};

export const runFlowIngredients = async (options: FlowCmdOptions): Promise<void> => {
  const { engine, page } = await startFlowSession(options);
  const ingredients = await listIngredients(page);
  await engine.shutdown({ closeBrowser: false });
  if (options.json) process.stdout.write(`${JSON.stringify(ingredients)}\n`);
  else if (ingredients.length === 0)
    process.stdout.write("No ingredients attached to the prompt.\n");
  else for (const item of ingredients) process.stdout.write(`${item.id}\t${item.url}\n`);
  process.exit(0);
};

export const runFlowIngredientRemove = async (options: FlowCmdOptions): Promise<void> => {
  const id = options.id?.[0];
  if (id === undefined || id === "")
    return exitWithCliError("Usage: bridge flow ingredient-remove --id <mediaId>");
  const { engine, page } = await startFlowSession(options);
  await removeIngredient(page, id);
  await engine.shutdown({ closeBrowser: false });
  process.stdout.write(
    options.json ? `${JSON.stringify({ id, removed: true })}\n` : `Removed ingredient ${id}.\n`,
  );
  process.exit(0);
};

export const runFlowIngredientClear = async (options: FlowCmdOptions): Promise<void> => {
  const { engine, page } = await startFlowSession(options);
  const removed = await clearIngredients(page);
  await engine.shutdown({ closeBrowser: false });
  process.stdout.write(
    options.json ? `${JSON.stringify({ removed })}\n` : `Removed ${removed} ingredient(s).\n`,
  );
  process.exit(0);
};
