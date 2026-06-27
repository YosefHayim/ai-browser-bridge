import { readFile, stat } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { ensureInsideRepo } from "../tools/sandbox.ts";

/** Result of resolving a single @file mention. */
export interface ResolvedFile {
  /** Repo-relative path */
  relPath: string;
  content: string;
}

/** Context for resolving one @file mention match. */
export interface ResolveFileMentionContext {
  match: RegExpMatchArray;
  repoRoot: string;
  prompt: string;
  files: ResolvedFile[];
}

/** Resolve one @file mention and return updated prompt plus file entry. */
export async function resolveOneFileMention(ctx: ResolveFileMentionContext): Promise<{ prompt: string; file?: ResolvedFile }> {
  const paths = resolveMentionPaths(ctx);
  if (!paths) return { prompt: ctx.prompt };
  const content = await readMentionContent({ absPath: paths.absPath, rawPath: paths.rawPath });
  return buildMentionResult({ prompt: ctx.prompt, match: ctx.match[0], relPath: paths.relPath, content });
}

/** Resolve absolute and relative paths for one mention match. */
function resolveMentionPaths(ctx: ResolveFileMentionContext) {
  const rawPath = ctx.match[1];
  const absPath = resolve(ctx.repoRoot, rawPath);
  const relPath = relative(ctx.repoRoot, absPath);
  if (!ensureInsideRepo(absPath, ctx.repoRoot)) return null;
  return { rawPath, absPath, relPath };
}

/** Build prompt replacement and resolved file entry. */
function buildMentionResult(input: { prompt: string; match: string; relPath: string; content: string }) {
  const block = `\n--- @${input.relPath} ---\n${input.content}\n--- end @${input.relPath} ---\n`;
  return { prompt: input.prompt.replace(input.match, block), file: { relPath: input.relPath, content: input.content } };
}

/** Read file content for a mention, with size and error guards. */
async function readMentionContent(input: { absPath: string; rawPath: string }): Promise<string> {
  try {
    const fileStat = await stat(input.absPath);
    if (!fileStat.isFile()) return `[not a file: ${input.rawPath}]`;
    if (fileStat.size > 100_000) return `[file too large: ${fileStat.size} bytes, max 100000]`;
    return await readFile(input.absPath, "utf-8");
  } catch {
    return `[file not found: ${input.rawPath}]`;
  }
}
