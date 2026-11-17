import { readFile } from "node:fs/promises";
import { hasErrorCode } from "@/domain/errors.ts";

export async function readFileIfPresent(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return undefined;

    throw error;
  }
}
