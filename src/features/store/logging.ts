import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { logsDir } from "./paths.ts";

/** One append-only bridge log event. */
export interface BridgeLogEvent {
  repoPath: string;
  type: string;
  data?: Record<string, unknown>;
}

const formatLocalDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

/**
 * Return today's bridge log path for a repo.
 *
 * @param repoPath - Repository path used for bridge state.
 * @param date - Date value.
 * @returns The `bridgeLogPath` result.
 * @example
 * ```ts
 * const result = bridgeLogPath(repoPath, date);
 * ```
 */
export const bridgeLogPath = (repoPath: string, date = new Date()): string => {
  return join(logsDir(repoPath), `${formatLocalDate(date)}.jsonl`);
};

/**
 * Append one JSONL event to the repo's local bridge log.
 *
 * @param event - Event value.
 * @returns Completes when `appendBridgeLog` finishes.
 * @example
 * ```ts
 * await appendBridgeLog(event);
 * ```
 */
export const appendBridgeLog = async (event: BridgeLogEvent): Promise<void> => {
  await mkdir(logsDir(event.repoPath), { recursive: true });
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    repoPath: event.repoPath,
    type: event.type,
    data: event.data ?? {},
  });
  await appendFile(bridgeLogPath(event.repoPath), `${line}\n`, "utf-8");
};
