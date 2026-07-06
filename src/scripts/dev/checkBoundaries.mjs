#!/usr/bin/env node
// Dev-only gate. No file under src/features/<A> may import a module in another
// feature <B> that declares a non-error service class. Cross-feature access goes
// through a feature's public surface (index door / factory / types / config), never
// implementation classes (which live in <B>/**/internal/). The same gate also keeps
// module shape rules that depend on import/export ordering. See CODE-STYLE.md and ADR 0002.
import { readFile, readdir } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";

const IMPORT_RE = /(?:import|export)\b[\s\S]*?\bfrom\s*["']([^"']+)["']/g;

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const SRC_ROOT = join(REPO_ROOT, "src");
const FEATURES_ROOT = join(REPO_ROOT, "src", "features");

/** The top-level feature a path belongs to, or null if outside src/features. */
const featureOf = (absPath) => {
  const rel = relative(FEATURES_ROOT, absPath);
  if (rel.startsWith("..")) return null;
  return rel.split(sep)[0];
};

const walk = async (dir, pattern = /\.tsx?$/) => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path, pattern)));
    else if (pattern.test(entry.name) && !/\.(test|d)\.tsx?$/.test(entry.name)) files.push(path);
  }
  return files;
};

const scriptKindFor = (file) => {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".mjs")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
};

const isIndexDoor = (file) => {
  return basename(file) === "index.ts" || basename(file) === "index.tsx";
};

const exportDeclarationsAfterImport = (file, text) => {
  const sourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(file),
  );
  const fileViolations = [];
  let sawImport = false;
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) || ts.isImportEqualsDeclaration(statement)) {
      sawImport = true;
      continue;
    }
    if (ts.isExportDeclaration(statement)) {
      const position = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile));
      const line = position.line + 1;
      if (sawImport) {
        fileViolations.push(
          `${relative(REPO_ROOT, file)}:${line}  re-export declaration after import; move it above imports or inline-export the declaration`,
        );
      }
      if (isIndexDoor(file) && statement.exportClause) {
        fileViolations.push(
          `${relative(REPO_ROOT, file)}:${line}  index doors use wildcard exports; replace named re-export with export *`,
        );
      }
      if (!isIndexDoor(file) && !statement.exportClause) {
        fileViolations.push(
          `${relative(REPO_ROOT, file)}:${line}  wildcard exports are allowed only in index doors`,
        );
      }
    }
  }
  return fileViolations;
};

const isAllCapsName = (name) => {
  return /^[A-Z][A-Z0-9_]*$/.test(name);
};

const rootIdentifier = (node) => {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return rootIdentifier(node.expression);
  return null;
};

const importedNames = (sourceFile) => {
  const names = new Set();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const clause = statement.importClause;
    if (!clause) continue;
    if (clause.name) names.add(clause.name.text);
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const specifier of clause.namedBindings.elements) names.add(specifier.name.text);
    }
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      names.add(clause.namedBindings.name.text);
    }
  }
  return names;
};

const isStaticExpression = (node, sourceFile, imported) => {
  if (!node) return false;
  if (
    ts.isStringLiteralLike(node) ||
    ts.isNumericLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.NullKeyword ||
    node.kind === ts.SyntaxKind.RegularExpressionLiteral ||
    ts.isNoSubstitutionTemplateLiteral(node)
  ) {
    return true;
  }
  if (ts.isPrefixUnaryExpression(node))
    return isStaticExpression(node.operand, sourceFile, imported);
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    return isStaticExpression(node.expression, sourceFile, imported);
  }
  if (ts.isIdentifier(node)) return isAllCapsName(node.text) || imported.has(node.text);
  if (ts.isPropertyAccessExpression(node)) {
    const root = rootIdentifier(node);
    return root === "String" || Boolean(root && (isAllCapsName(root) || imported.has(root)));
  }
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "join"
  ) {
    return (
      isStaticExpression(node.expression.expression, sourceFile, imported) &&
      node.arguments.every((arg) => isStaticExpression(arg, sourceFile, imported))
    );
  }
  if (ts.isTemplateExpression(node)) {
    return node.templateSpans.every((span) =>
      isStaticExpression(span.expression, sourceFile, imported),
    );
  }
  if (ts.isTaggedTemplateExpression(node)) {
    return (
      node.tag.getText(sourceFile) === "String.raw" &&
      (ts.isNoSubstitutionTemplateLiteral(node.template) || ts.isTemplateExpression(node.template))
    );
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.every(
      (element) =>
        !ts.isSpreadElement(element) && isStaticExpression(element, sourceFile, imported),
    );
  }
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.every((property) => {
      if (ts.isPropertyAssignment(property)) {
        return isStaticExpression(property.initializer, sourceFile, imported);
      }
      if (ts.isShorthandPropertyAssignment(property)) {
        return isAllCapsName(property.name.text) || imported.has(property.name.text);
      }
      if (ts.isSpreadAssignment(property))
        return isStaticExpression(property.expression, sourceFile, imported);
      return false;
    });
  }
  if (ts.isNewExpression(node)) {
    const name = node.expression.getText(sourceFile);
    return (
      ["Set", "Map", "RegExp"].includes(name) &&
      (node.arguments ?? []).every((arg) => isStaticExpression(arg, sourceFile, imported))
    );
  }
  return false;
};

const isStaticAllCapsVariable = (statement, sourceFile, imported) => {
  return (
    ts.isVariableStatement(statement) &&
    statement.declarationList.declarations.length > 0 &&
    statement.declarationList.declarations.every(
      (declaration) =>
        ts.isIdentifier(declaration.name) &&
        isAllCapsName(declaration.name.text) &&
        isStaticExpression(declaration.initializer, sourceFile, imported),
    )
  );
};

const isModulePrologueStatement = (statement, sourceFile, imported) => {
  return (
    ts.isImportDeclaration(statement) ||
    ts.isImportEqualsDeclaration(statement) ||
    ts.isExportDeclaration(statement) ||
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isEnumDeclaration(statement) ||
    isStaticAllCapsVariable(statement, sourceFile, imported)
  );
};

const staticConstantsAfterRuntime = (file, text) => {
  const sourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(file),
  );
  const imported = importedNames(sourceFile);
  const fileViolations = [];
  let inPrologue = true;
  for (const statement of sourceFile.statements) {
    if (isStaticAllCapsVariable(statement, sourceFile, imported) && !inPrologue) {
      const names = statement.declarationList.declarations.map((declaration) =>
        declaration.name.getText(sourceFile),
      );
      const position = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile));
      fileViolations.push(
        `${relative(REPO_ROOT, file)}:${position.line + 1}  static SCREAMING_CASE constant ${names.join(", ")} must live in the module prologue after imports`,
      );
    }
    if (!isModulePrologueStatement(statement, sourceFile, imported)) inPrologue = false;
  }
  return fileViolations;
};

// Whether a module declares an exported class that is not (solely) an Error subclass.
// Error-only modules (shared error types) are importable across features.
const classCache = new Map();
const declaresServiceClass = async (absPath) => {
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
};

const files = await walk(FEATURES_ROOT);
const sourceFiles = await walk(SRC_ROOT, /\.(tsx?|mjs)$/);
const violations = [];

for (const file of sourceFiles) {
  const text = await readFile(file, "utf8");
  violations.push(...exportDeclarationsAfterImport(file, text));
  violations.push(...staticConstantsAfterRuntime(file, text));
}

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
  console.error("Boundary/style violations:\n");
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}

console.log(`checkBoundaries: OK (${files.length} files)`);
