#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const MAX_LINES = 100;
const ROOT = join(import.meta.dirname, "..", "src");
const SKIP = new Set([".dom-snippet.ts"]);

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(path);
  }
  return files;
}

const files = await walk(ROOT);
const violations = [];

for (const file of files) {
  if ([...SKIP].some((suffix) => file.endsWith(suffix))) continue;
  const lines = (await readFile(file, "utf8")).split("\n").length;
  if (lines > MAX_LINES) violations.push({ file, lines });
}

if (violations.length > 0) {
  console.error(`Files exceeding ${MAX_LINES} lines:\n`);
  for (const v of violations.sort((a, b) => b.lines - a.lines)) {
    console.error(`  ${v.lines}\t${v.file.replace(join(import.meta.dirname, "..") + "/", "")}`);
  }
  process.exit(1);
}

console.log(`check-max-lines: OK (${files.length} files)`);
