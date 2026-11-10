import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { readLogsDirectory } from "./paths.ts";

const DATE_PART_PAD_LENGTH = 2;

export type BridgeLogEvent = {
  repoPath: string;
  type: string;
  data?: Record<string, unknown>;
};

const writeLocalDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(DATE_PART_PAD_LENGTH, "0");
  const dayOfMonth = date.getDate();
  const day = String(dayOfMonth).padStart(DATE_PART_PAD_LENGTH, "0");
  return `${year}-${month}-${day}`;
};

export const readBridgeLogPath = (repoPath: string, date = new Date()): string => {
  const logsDirectory = readLogsDirectory(repoPath);
  const localDate = writeLocalDate(date);
  return join(logsDirectory, `${localDate}.jsonl`);
};

export const appendBridgeLog = async (event: BridgeLogEvent): Promise<void> => {
  const logsDirectory = readLogsDirectory(event.repoPath);

  await mkdir(logsDirectory, { recursive: true });

  const dataField = event.data;
  const isDataMissing = dataField == null;
  const details = isDataMissing ? {} : dataField;

  const line = JSON.stringify({
    ts: new Date().toISOString(),
    repoPath: event.repoPath,
    type: event.type,
    data: details,
  });

  const bridgeLogPath = readBridgeLogPath(event.repoPath);
  await appendFile(bridgeLogPath, `${line}\n`, "utf-8");
};
