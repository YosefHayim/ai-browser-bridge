#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const REPOSITORY_ROOT = join(import.meta.dirname, "..");
const SOURCE_ROOT = join(REPOSITORY_ROOT, "src");
const COMPATIBILITY_TELL =
  /@deprecated|backward-compat(?:ibility|ible)?|compat(?:ibility)? shim|legacy (?:alias|field|shim)|old name kept|just in case/iu;

const sourceFilesUnder = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const sourceFiles = [];
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      sourceFiles.push(...(await sourceFilesUnder(entryPath)));
      continue;
    }
    if (/\.(?:ts|tsx)$/u.test(entry.name) && !/\.(?:test|d)\.tsx?$/u.test(entry.name)) {
      sourceFiles.push(entryPath);
    }
  }
  return sourceFiles;
};

const sourceFiles = await sourceFilesUnder(SOURCE_ROOT);
const violations = [];

for (const sourcePath of sourceFiles) {
  const sourceText = await readFile(sourcePath, "utf8");
  for (const [lineIndex, lineText] of sourceText.split("\n").entries()) {
    if (!COMPATIBILITY_TELL.test(lineText)) continue;
    violations.push(`${relative(REPOSITORY_ROOT, sourcePath)}:${lineIndex + 1} ${lineText.trim()}`);
  }
}

if (violations.length > 0) {
  console.error("Compatibility names or shims are forbidden:");
  for (const violation of violations) console.error(`  ${violation}`);
  process.exitCode = 1;
} else {
  console.log(`checkNoCompatibility: OK (${sourceFiles.length} files)`);
}
