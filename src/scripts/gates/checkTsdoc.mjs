#!/usr/bin/env node
// Dev-only gate. Public callables carry complete TSDoc and named callable
// declarations stay out of source. Anonymous generator expressions remain valid
// where the language requires them.
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";

const ROOT = join(import.meta.dirname, "..", "..", "..", "src");

const walk = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (/\.(mjs|tsx?)$/.test(entry.name) && !/\.(test|d)\.tsx?$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
};

const scriptKindFor = (file) => {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".mjs") || file.endsWith(".js")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
};

const hasExportModifier = (node) => {
  return node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
};

/** @param node {import('typescript').ClassDeclaration} */
const extendsError = (node, sourceFile) => {
  if (!node.heritageClauses) return false;
  for (const clause of node.heritageClauses) {
    if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
    for (const type of clause.types) {
      const heritage = type.expression.getText(sourceFile);
      if (heritage.endsWith("Error") || heritage.startsWith("Data.TaggedError(")) return true;
    }
  }
  return false;
};

/** @param node {import('typescript').Node} */
const isPublicMethod = (node) => {
  if (!ts.isMethodDeclaration(node) || !node.name) return false;
  const isPrivate = node.modifiers?.some(
    (modifier) =>
      modifier.kind === ts.SyntaxKind.PrivateKeyword ||
      modifier.kind === ts.SyntaxKind.ProtectedKeyword,
  );
  return !isPrivate;
};

const isFunctionLikeInitializer = (initializer) => {
  return initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer));
};

const parameterName = (parameter, index) => {
  const text = parameter.name.getText().replace(/^\.{3}/, "");
  return /^[A-Za-z_$][\w$]*$/.test(text) ? text : `param${index + 1}`;
};

const tsdocText = (node) => {
  return ts
    .getJSDocCommentsAndTags(node)
    .filter((comment) => ts.isJSDoc(comment))
    .map((comment) => comment.getFullText())
    .join("\n");
};

const hasSummary = (doc) => {
  return doc
    .replace(/^\/\*\*/, "")
    .replace(/\*\/$/, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\* ?/, "").trim())
    .some((line) => line && !line.startsWith("@") && !line.startsWith("```"));
};

const validateTsdoc = ({ doc, name, parameters, file }) => {
  const missing = [];
  if (!doc) missing.push("TSDoc");
  if (doc && !hasSummary(doc)) missing.push("summary");
  for (let index = 0; index < parameters.length; index += 1) {
    const paramName = parameterName(parameters[index], index);
    if (!new RegExp(`@param\\s+${paramName}\\b`).test(doc)) missing.push(`@param ${paramName}`);
  }
  if (!/@returns?\b/.test(doc)) missing.push("@returns");
  if (!/@example\b/.test(doc)) missing.push("@example");
  return missing.length > 0 ? `${file}: ${name} missing ${missing.join(", ")}` : null;
};

const exportedNames = (sourceFile) => {
  const names = new Set();
  for (const statement of sourceFile.statements) {
    if (
      ts.isExportDeclaration(statement) &&
      !statement.moduleSpecifier &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        names.add((element.propertyName ?? element.name).text);
      }
    }
  }
  return names;
};

const collectViolations = (file, sourceFile) => {
  const violations = [];
  const localExports = exportedNames(sourceFile);
  let publicFunctionCount = 0;

  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      violations.push(`${file}: ${node.name.text} uses a named callable declaration`);
    }

    if (ts.isVariableStatement(node)) {
      const directExport = hasExportModifier(node);
      for (const declaration of node.declarationList.declarations) {
        if (
          !ts.isIdentifier(declaration.name) ||
          !isFunctionLikeInitializer(declaration.initializer)
        ) {
          continue;
        }
        if (!directExport && !localExports.has(declaration.name.text)) continue;
        publicFunctionCount += 1;
        const violation = validateTsdoc({
          doc: tsdocText(node),
          name: declaration.name.text,
          parameters: declaration.initializer.parameters,
          file,
        });
        if (violation) violations.push(violation);
      }
    }

    if (
      ts.isClassDeclaration(node) &&
      node.name &&
      hasExportModifier(node) &&
      !extendsError(node, sourceFile)
    ) {
      for (const member of node.members) {
        if (!isPublicMethod(member)) continue;
        publicFunctionCount += 1;
        const violation = validateTsdoc({
          doc: tsdocText(member),
          name: `${node.name.text}.${member.name.getText(sourceFile)}`,
          parameters: member.parameters,
          file,
        });
        if (violation) violations.push(violation);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return { violations, publicFunctionCount };
};

const violations = [];
let publicFunctions = 0;

for (const file of await walk(ROOT)) {
  const text = await readFile(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(file),
  );
  const result = collectViolations(file, sourceFile);
  violations.push(...result.violations);
  publicFunctions += result.publicFunctionCount;
}

if (violations.length > 0) {
  console.error("TSDoc/callable-style violations:\n");
  for (const violation of violations) console.error(`  ${violation}`);
  process.exit(1);
}

console.log(`checkTsdoc: OK (${publicFunctions} public callables scanned)`);
