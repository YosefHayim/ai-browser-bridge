#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";

const ROOT = join(import.meta.dirname, "..", "src");

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.name.endsWith(".class.ts")) files.push(path);
  }
  return files;
}

/** @param node {import('typescript').ClassDeclaration} */
function extendsError(node, sourceFile) {
  if (!node.heritageClauses) return false;
  for (const clause of node.heritageClauses) {
    if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
    for (const type of clause.types) {
      if (type.expression.getText(sourceFile) === "Error") return true;
    }
  }
  return false;
}

/** @param node {import('typescript').Node} */
function hasJSDoc(node) {
  return ts.getJSDocCommentsAndTags(node).some((c) => ts.isJSDoc(c));
}

const violations = [];
const files = await walk(ROOT);

for (const file of files) {
  const text = await readFile(file, "utf8");
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  const exportedClasses = [];
  /** @param node {import('typescript').Node} */
  function collectClasses(node) {
    if (ts.isClassDeclaration(node) && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      exportedClasses.push(node);
    }
    ts.forEachChild(node, collectClasses);
  }
  collectClasses(sourceFile);

  const serviceClass = exportedClasses.find((cls) => !extendsError(cls, sourceFile));
  if (!serviceClass) continue;

  for (const member of serviceClass.members) {
    if (!ts.isMethodDeclaration(member) || !member.name) continue;
    const isPrivate = member.modifiers?.some((m) =>
      m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword,
    );
    if (isPrivate) continue;
    if (!hasJSDoc(member)) {
      violations.push(`${file}: ${member.name.getText(sourceFile)} missing JSDoc`);
    }
  }
}

if (violations.length > 0) {
  console.error("JSDoc violations:\n");
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}

console.log(`check-jsdoc: OK (${files.length} class files scanned)`);
