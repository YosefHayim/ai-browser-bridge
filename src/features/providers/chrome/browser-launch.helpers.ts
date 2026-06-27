import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bridgeDir } from "../../store/paths.ts";

interface PrepareProfileInput {
  /** Target repo whose `.bridge` directory should exist. */
  repoPath: string;
  /** Isolated Chrome profile directory to create. */
  profileDir: string;
}

/** Ensure bridge dirs exist and the profile directory is ready. */
export function prepareProfileDirectories(input: PrepareProfileInput): void {
  mkdirSync(bridgeDir(input.repoPath), { recursive: true });
  writeFileSync(join(bridgeDir(input.repoPath), ".gitignore"), "*\n");
  mkdirSync(input.profileDir, { recursive: true });
}
