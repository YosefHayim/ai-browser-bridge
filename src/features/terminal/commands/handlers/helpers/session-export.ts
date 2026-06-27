import { extname, join, resolve } from "node:path";
import type { CommandContext } from "../../../../domain/types.ts";
import type { SessionExport } from "../../../../store/session-store.ts";
import { exportsDir } from "../../../../store/paths.ts";
import { resolveSessionId } from "./resolve-session-id.ts";
import { splitArgs } from "./split-args.ts";
import { sessionStore } from "./session-store.ts";
import { tryLoadSession } from "./try-load-session.ts";

/** Parsed `/export` target session and optional output path. */
export interface SessionExportSelection {
  /** Resolved session id, or null when none is available. */
  sessionId: string | null;
  /** Optional absolute output file path. */
  outputPath?: string;
}

/** Inputs for parsing `/export` arguments. */
export interface ResolveSessionExportParams {
  /** Raw command arguments. */
  args: string;
  /** Active command context. */
  ctx: CommandContext;
}

/** Parse `/export` args into session id and optional output path. */
export async function resolveSessionExportArgs(
  params: ResolveSessionExportParams,
): Promise<SessionExportSelection> {
  const parts = splitArgs(params.args);
  if (parts.length === 0) {
    return { sessionId: await resolveSessionId({ args: "", ctx: params.ctx }) };
  }
  return resolveSessionExportFromParts({ parts, ctx: params.ctx });
}

/** Resolve export target from parsed `/export` tokens. */
async function resolveSessionExportFromParts(input: {
  parts: string[];
  ctx: CommandContext;
}): Promise<SessionExportSelection> {
  const first = input.parts[0];
  const store = sessionStore(input.ctx.config.repoPath);
  const session = await tryLoadSession({ sessionId: first, options: store });
  if (session) {
    return {
      sessionId: session.metadata.id,
      outputPath: input.parts[1] ? resolve(input.parts[1]) : undefined,
    };
  }
  return {
    sessionId: await resolveSessionId({ args: "", ctx: input.ctx }),
    outputPath: resolve(first),
  };
}

/** Default export location for a session when no output path is given. */
export function defaultExportPath(params: { repoPath: string; sessionId: string }): string {
  return join(exportsDir(params.repoPath), `${params.sessionId}.md`);
}

/** Pick export payload (json/jsonl/markdown) based on file extension. */
export function exportContentForPath(params: { path: string; exported: SessionExport }): string {
  const extension = extname(params.path).toLowerCase();
  if (extension === ".json") return params.exported.json;
  if (extension === ".jsonl") return params.exported.jsonl;
  return params.exported.transcript;
}
