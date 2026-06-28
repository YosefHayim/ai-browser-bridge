#!/usr/bin/env node
/** Add stub JSDoc to public class methods missing documentation. */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";

const files = [
  "src/features/bridge/bridge-engine.class.ts",
  "src/features/bridge/orchestrator.class.ts",
];

for (const rel of files) {
  const path = join(import.meta.dirname, "..", rel);
  let text = await readFile(path, "utf8");
  const sourceFile = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  /** @param node {import('typescript').MethodDeclaration} */
  function visit(node) {
    if (!ts.isMethodDeclaration(node) || !node.name) return;
    const isPublic = !node.modifiers?.some((m) =>
      m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword,
    );
    if (!isPublic) return;
    const full = ts.getJSDocCommentsAndTags(node);
    if (full.some((c) => ts.isJSDoc(c))) return;

    const name = node.name.getText(sourceFile);
    const start = node.getStart(sourceFile);
    const lineStart = text.lastIndexOf("\n", start) + 1;
    const indent = text.slice(lineStart, start).match(/^\s*/)?.[0] ?? "";
    const doc = `${indent}/** ${name} — bridge orchestration surface. */\n`;
    text = text.slice(0, lineStart) + doc + text.slice(lineStart);
  }

  ts.forEachChild(sourceFile, visit);
  // Re-parse after edits — run twice for multiple methods
  const sf2 = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  ts.forEachChild(sf2, visit);
  const sf3 = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  ts.forEachChild(sf3, visit);

  await writeFile(path, text);
  console.log(`Patched JSDoc in ${rel}`);
}
