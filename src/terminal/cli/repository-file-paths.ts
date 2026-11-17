import { basename, extname, isAbsolute, relative, resolve } from "node:path";
import { readRepositoryPath } from "@/repo-files/paths.ts";

type RepositoryFileDetails = {
  repoRoot: string;
  input: string;
};

export function createRepositoryFilePath(parameters: RepositoryFileDetails): string {
  if (isAbsolute(parameters.input)) {
    const rel = relative(resolve(parameters.repoRoot), resolve(parameters.input));
    return readRepositoryPath(parameters.repoRoot, rel || ".");
  }

  return readRepositoryPath(parameters.repoRoot, parameters.input);
}

export function assertImagePath(path: string): void {
  const extension = extname(path).toLowerCase();

  const isNotImageExtension = ![".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(extension);
  if (isNotImageExtension) {
    throw new Error(`Unsupported image type: ${basename(path)}`);
  }
}
