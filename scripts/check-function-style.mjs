#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";

const MAX_BODY_STATEMENTS = 5;
const MAX_PARENT_PARAMS = 5;
const MAX_CHILD_PARAMS = 1;
const ROOT = join(import.meta.dirname, "..", "src");
const SKIP_FILES = [".dom-snippet.ts", ".config.ts"];

/** @param node {import('typescript').Node} */
function countBodyStatements(node) {
  if (!node.body) return 0;
  if (ts.isBlock(node.body)) {
    return node.body.statements.filter((s) => !ts.isEmptyStatement(s)).length;
  }
  return 1;
}

/** @param node {import('typescript').FunctionLikeDeclaration} */
function isExported(node, sourceFile) {
  if (!node.modifiers) return false;
  return node.modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

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

const violations = [];
const files = await walk(ROOT);

for (const file of files) {
  if (SKIP_FILES.some((s) => file.endsWith(s))) continue;
  const text = await readFile(file, "utf8");
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

  /** @param node {import('typescript').Node} */
  function visit(node) {
    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      const params = "parameters" in node ? node.parameters.length : 0;
      const bodyCount = countBodyStatements(node);
      const name = ts.isFunctionDeclaration(node) && node.name ? node.name.getText(sourceFile) : ts.isMethodDeclaration(node) && node.name ? node.name.getText(sourceFile) : "(anonymous)";
      const exported = ts.isFunctionDeclaration(node) && isExported(node, sourceFile);
      const maxParams = exported ? MAX_PARENT_PARAMS : MAX_CHILD_PARAMS;

      if (params > maxParams) {
        violations.push(`${file}: ${name} has ${params} params (max ${maxParams})`);
      }
      if (bodyCount > MAX_BODY_STATEMENTS) {
        violations.push(`${file}: ${name} has ${bodyCount} body statements (max ${MAX_BODY_STATEMENTS})`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

if (violations.length > 0) {
  console.error("Function style violations:\n");
  for (const v of violations.slice(0, 50)) console.error(`  ${v}`);
  if (violations.length > 50) console.error(`  ... and ${violations.length - 50} more`);
  process.exit(1);
}

console.log(`check-function-style: OK (${files.length} files scanned)`);
