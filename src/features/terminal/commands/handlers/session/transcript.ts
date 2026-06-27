import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CommandContext } from "../../../../domain/types.ts";
import { exportSession } from "../../../../store/session-store.ts";
import { trimOutput } from "../../../../tools/sandbox.ts";
import { copyTextToClipboard } from "../helpers/copy-clipboard.ts";
import { resolveSessionId } from "../helpers/resolve-session-id.ts";
import {
  defaultExportPath,
  exportContentForPath,
  resolveSessionExportArgs,
} from "../helpers/session-export.ts";
import { sessionStore } from "../helpers/session-store.ts";

/** Print the local session transcript. */
export async function handleTranscript(args: string, ctx: CommandContext): Promise<void> {
  const sessionId = await resolveSessionId({ args, ctx });
  if (!sessionId) {
    console.log("No local session selected. Use /sessions first.");
    return;
  }
  const exported = await exportSession(sessionId, sessionStore(ctx.config.repoPath));
  console.log(trimOutput(exported.transcript || "(empty transcript)", 40_000));
}

/** Copy the local session transcript to the clipboard. */
export async function handleCopy(args: string, ctx: CommandContext): Promise<void> {
  const sessionId = await resolveSessionId({ args, ctx });
  if (!sessionId) {
    console.log("No local session selected. Use /sessions first.");
    return;
  }
  const exported = await exportSession(sessionId, sessionStore(ctx.config.repoPath));
  await copyTextToClipboard(exported.transcript);
  console.log(`Copied transcript for ${sessionId} to clipboard.`);
}

/** Export the local session transcript to a file. */
export async function handleExport(args: string, ctx: CommandContext): Promise<void> {
  const selection = await resolveSessionExportArgs({ args, ctx });
  if (!selection.sessionId) {
    console.log("No local session selected. Use /sessions first.");
    return;
  }
  await writeSessionExport({ sessionId: selection.sessionId, outputPath: selection.outputPath, ctx });
}

/** Inputs for writing a session export file. */
interface WriteSessionExportParams {
  /** Resolved session id. */
  sessionId: string;
  /** Optional absolute output file path. */
  outputPath?: string;
  /** Active command context. */
  ctx: CommandContext;
}

/** Write exported session content to disk. */
async function writeSessionExport(params: WriteSessionExportParams): Promise<void> {
  const store = sessionStore(params.ctx.config.repoPath);
  const exported = await exportSession(params.sessionId, store);
  const targetPath = params.outputPath
    ?? defaultExportPath({ repoPath: params.ctx.config.repoPath, sessionId: params.sessionId });
  await persistSessionExport({ targetPath, exported, sessionId: params.sessionId });
}

/** Create parent dirs and write exported session content. */
async function persistSessionExport(input: {
  targetPath: string;
  exported: Awaited<ReturnType<typeof exportSession>>;
  sessionId: string;
}): Promise<void> {
  const content = exportContentForPath({ path: input.targetPath, exported: input.exported });
  await mkdir(dirname(input.targetPath), { recursive: true });
  await writeFile(input.targetPath, content, "utf-8");
  console.log(`Exported ${input.sessionId} to ${input.targetPath}`);
}
