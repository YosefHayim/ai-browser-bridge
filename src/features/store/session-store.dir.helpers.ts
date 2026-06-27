import { readdir } from "node:fs/promises";
import { hasErrorCode } from "../domain/errors.ts";

/** Read session directory entries, returning [] when the store is missing. */
export async function readSessionDirEntries(baseDir: string) {
  try {
    return await readdir(baseDir, { withFileTypes: true });
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return [];
    throw error;
  }
}
