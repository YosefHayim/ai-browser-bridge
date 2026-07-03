#!/usr/bin/env node
// Dev-only gate. No file under src/features/<A> may import a module in another
// feature <B> that declares a non-error service class. Cross-feature access goes
// through a feature's public surface (factory / door / types / config), never its
// implementation classes (which live in <B>/**/internal/). See CODE-STYLE.md and ADR 0002.
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const FEATURES_ROOT = join(REPO_ROOT, "src", "features");
const IMPORT_RE = /(?:import|export)\b[\s\S]*?\bfrom\s*["']([^"']+)["']/g;

/** The top-level feature a path belongs to, or null if outside src/features. */
function featureOf(absPath) {
  const rel = relative(FEATURES_ROOT, absPath);
  if (rel.startsWith("..")) return null;
  return rel.split(sep)[0];
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (/\.tsx?$/.test(entry.name) && !/\.(test|d)\.tsx?$/.test(entry.name)) files.push(path);
  }
  return files;
}

// Whether a module declares an exported class that is not (solely) an Error subclass.
// Error-only modules (shared error types) are importable across features.
const classCache = new Map();
async function declaresServiceClass(absPath) {
  if (classCache.has(absPath)) return classCache.get(absPath);
  let result = false;
  try {
    const text = await readFile(absPath, "utf8");
    const sf = ts.createSourceFile(absPath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    /** @param node {import('typescript').Node} */
    const visit = (node) => {
      if (
        ts.isClassDeclaration(node) &&
        node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      ) {
        const isError = node.heritageClauses?.some(
          (c) =>
            c.token === ts.SyntaxKind.ExtendsKeyword &&
            c.types.some((t) => t.expression.getText(sf).endsWith("Error")),
        );
        if (!isError) result = true;
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  } catch {
    result = false;
  }
  classCache.set(absPath, result);
  return result;
}

const files = await walk(FEATURES_ROOT);
const violations = [];

for (const file of files) {
  const srcFeature = featureOf(file);
  const text = await readFile(file, "utf8");
  for (const match of text.matchAll(IMPORT_RE)) {
    const spec = match[1];
    // Resolve both relative imports and the `@/` alias (@/* → src/*) so cross-feature
    // access via `@/features/<x>` is checked too — not just relative paths.
    let target;
    if (spec.startsWith("@/")) target = join(REPO_ROOT, "src", spec.slice(2));
    else if (spec.startsWith(".")) target = resolve(dirname(file), spec);
    else continue;
    const targetFeature = featureOf(target);
    if (!targetFeature || targetFeature === srcFeature) continue;
    if (await declaresServiceClass(target)) {
      violations.push(
        `${relative(REPO_ROOT, file)} → ${spec}  (cross-feature service class; import via ${targetFeature}'s public surface)`,
      );
    }
  }
}

if (violations.length > 0) {
  console.error("Feature-boundary violations (no cross-feature service-class imports):\n");
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}

console.log(`checkBoundaries: OK (${files.length} files)`);
