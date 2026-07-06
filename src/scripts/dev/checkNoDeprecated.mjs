#!/usr/bin/env node
// Dev-only gate: no backward-compatibility shims. A `@deprecated` marker means an alias,
// field, or old name kept "just in case" — but this repo guards no external API, so a
// compat shim only rots into a second source of truth. There must be zero in `src/`.
// Rename/replace = update the call sites and delete the old name in the same change.
// See CODE-STYLE.md ("No backward compatibility") and ADR 0010.
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const TELL =
  /@deprecated|backward-compat(?:ibility|ible)?|compat(?:ibility)? shim|legacy (?:alias|field|shim)|old name kept|just in case/i;

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const SRC = join(REPO_ROOT, "src");

const walk = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (/\.tsx?$/.test(entry.name) && !/\.(test|d)\.tsx?$/.test(entry.name)) files.push(path);
  }
  return files;
};

const files = await walk(SRC);
const offenders = [];
for (const file of files) {
  const text = await readFile(file, "utf8");
  text.split("\n").forEach((line, i) => {
    if (TELL.test(line)) offenders.push(`${relative(REPO_ROOT, file)}:${i + 1}  ${line.trim()}`);
  });
}

if (offenders.length > 0) {
  console.error(
    "Backward-compat/deprecation shims are not allowed (CODE-STYLE.md). Remove these:\n",
  );
  for (const offender of offenders) console.error(`  ${offender}`);
  process.exit(1);
}

console.log(`checkNoDeprecated: OK (${files.length} files)`);
