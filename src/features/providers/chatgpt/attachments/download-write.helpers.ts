import { stat, writeFile } from "node:fs/promises";
import { isNodeError } from "../../../domain/errors.ts";
import type { DownloadResult } from "./download-attachment.types.ts";

interface ExistingSizeInput {
  /** Absolute file path to stat. */
  filePath: string;
}

/** Return file size when the path exists. */
export async function existingSize(input: ExistingSizeInput): Promise<number | undefined> {
  try {
    return (await stat(input.filePath)).size;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
}

interface WriteIfChangedInput {
  /** Absolute destination path. */
  filePath: string;
  /** File contents to write when size differs. */
  bytes: Buffer;
}

/** Write bytes only when the destination size changed. */
export async function writeIfChanged(input: WriteIfChangedInput): Promise<DownloadResult> {
  if (await existingSize({ filePath: input.filePath }) === input.bytes.byteLength) {
    return { path: input.filePath, bytes: input.bytes.byteLength };
  }
  await writeFile(input.filePath, input.bytes);
  return { path: input.filePath, bytes: input.bytes.byteLength };
}
