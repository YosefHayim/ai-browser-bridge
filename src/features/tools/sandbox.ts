import { resolve } from "node:path";

/** Ensure a user-supplied path resolves inside the repo root. */
export function ensureInsideRepo(path: string, repoRoot: string): string {
  const resolved = resolve(repoRoot, path);
  const normalizedRoot = resolve(repoRoot);
  if (resolved !== normalizedRoot && !resolved.startsWith(normalizedRoot + "/")) {
    throw new Error(`Path escapes repo root: ${path}`);
  }
  return resolved;
}

/** Allowlisted test command prefixes — only these may be executed. */
const ALLOWED_TEST_PREFIXES: string[][] = [
  ["npm", "test"],
  ["npm", "run", "test"],
  ["pnpm", "test"],
  ["pnpm", "run", "test"],
  ["yarn", "test"],
  ["pytest"],
  ["python", "-m", "pytest"],
  ["go", "test"],
  ["cargo", "test"],
  ["make", "test"],
];

/** Check whether a parsed command matches an allowed test prefix. */
export function isAllowedTestCommand(parts: string[]): boolean {
  return ALLOWED_TEST_PREFIXES.some(
    (prefix) => parts.slice(0, prefix.length).join(" ") === prefix.join(" "),
  );
}

/** Trim output to a max character limit. */
export function trimOutput(text: string, limit = 20_000): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + `\n\n[trimmed: output exceeded ${limit} chars]`;
}
