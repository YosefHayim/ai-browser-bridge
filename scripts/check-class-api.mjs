#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";

const MAX_PUBLIC_METHODS = 5;
const ROOT = join(import.meta.dirname, "..", "src");
const BROWSER_PROVIDER = "BrowserProvider";
const EXEMPT_METHOD_COUNT = new Set(["Orchestrator"]);

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
function implementsBrowserProvider(node, sourceFile) {
  if (!node.heritageClauses) return false;
  for (const clause of node.heritageClauses) {
    if (clause.token !== ts.SyntaxKind.ImplementsKeyword) continue;
    for (const type of clause.types) {
      if (type.expression.getText(sourceFile) === BROWSER_PROVIDER) return true;
    }
  }
  return false;
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

/** @param node {import('typescript').MethodDeclaration | import('typescript').ConstructorDeclaration} */
function isPublicMethod(node) {
  if (ts.isConstructorDeclaration(node)) return false;
  if (!ts.isMethodDeclaration(node)) return false;
  if (!node.modifiers) return true;
  const isPrivate = node.modifiers.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword);
  const isProtected = node.modifiers.some((m) => m.kind === ts.SyntaxKind.ProtectedKeyword);
  return !isPrivate && !isProtected;
}

const violations = [];
const files = await walk(ROOT);

for (const file of files) {
  const text = await readFile(file, "utf8");
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  const exportedClasses = [];

  /** @param node {import('typescript').Node} */
  function visit(node) {
    if (ts.isClassDeclaration(node) && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      exportedClasses.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  if (exportedClasses.length === 0) {
    violations.push(`${file}: no exported class found`);
    continue;
  }

  const serviceClasses = exportedClasses.filter((cls) => !extendsError(cls, sourceFile));
  if (serviceClasses.length > 1) {
    violations.push(`${file}: ${serviceClasses.length} exported service classes (max 1)`);
  }

  for (const cls of exportedClasses) {
    const name = cls.name?.getText(sourceFile) ?? "(anonymous)";
    if (implementsBrowserProvider(cls, sourceFile)) continue;
    if (EXEMPT_METHOD_COUNT.has(name)) continue;

    const publicMethods = cls.members.filter((m) => isPublicMethod(m));
    if (publicMethods.length > MAX_PUBLIC_METHODS) {
      violations.push(`${file}: ${name} has ${publicMethods.length} public methods (max ${MAX_PUBLIC_METHODS})`);
    }
  }
}

if (violations.length > 0) {
  console.error("Class API violations:\n");
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}

console.log(`check-class-api: OK (${files.length} class files scanned)`);
