import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { bridgeDir } from "./paths.repo.ts";

/** Create `<repo>/.bridge` and assert its self-ignoring `.gitignore`. */
export async function ensureBridgeDir(repoPath: string): Promise<string> {
  const dir = bridgeDir(repoPath);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, ".gitignore"), "*\n", "utf-8");
  return dir;
}
