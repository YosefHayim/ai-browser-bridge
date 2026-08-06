import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { logsDir } from "./paths.ts";

export type BridgeLogEvent = {
  repoPath: string;
  type: string;
  data?: Record<string, unknown>;
};

const formatLocalDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

/** Today's bridge log path for a repo (local calendar date). */
export const bridgeLogPath = (repoPath: string, date = new Date()): string => {
  return join(logsDir(repoPath), `${formatLocalDate(date)}.jsonl`);
};

/** Append one JSONL event to the repo's local bridge log. */
export const appendBridgeLog = async (event: BridgeLogEvent): Promise<void> => {
  await mkdir(logsDir(event.repoPath), { recursive: true });
  const details = event.data === undefined ? {} : event.data;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    repoPath: event.repoPath,
    type: event.type,
    data: details,
  });
  await appendFile(bridgeLogPath(event.repoPath), `${line}\n`, "utf-8");
};
