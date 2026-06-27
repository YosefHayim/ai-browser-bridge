import { mkdir, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { logsDir } from "./paths.ts";

export interface BridgeLogEvent {
  repoPath: string;
  type: string;
  data?: Record<string, unknown>;
}

/** Return today's bridge log path for a repo. */
export function bridgeLogPath(repoPath: string, date = new Date()): string {
  return join(logsDir(repoPath), `${formatLocalDate(date)}.jsonl`);
}

/** Append one JSONL event to the repo's local bridge log. */
export async function appendBridgeLog(event: BridgeLogEvent): Promise<void> {
  await mkdir(logsDir(event.repoPath), { recursive: true });
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    repoPath: event.repoPath,
    type: event.type,
    data: event.data ?? {},
  });
  await appendFile(bridgeLogPath(event.repoPath), `${line}\n`, "utf-8");
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
