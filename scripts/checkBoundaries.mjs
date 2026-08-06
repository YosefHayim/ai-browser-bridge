#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";

const REPOSITORY_ROOT = join(import.meta.dirname, "..");
const SOURCE_ROOT = join(REPOSITORY_ROOT, "src");
const FEATURES_ROOT = join(SOURCE_ROOT, "features");

const sourceFilesUnder = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const sourceFiles = [];
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      sourceFiles.push(...(await sourceFilesUnder(entryPath)));
      continue;
    }
    if (/\.(?:ts|tsx|mjs)$/u.test(entry.name)) sourceFiles.push(entryPath);
  }
  return sourceFiles;
};

const featureNameFor = (sourcePath) => {
  const featurePath = relative(FEATURES_ROOT, sourcePath);
  if (featurePath.startsWith("..")) return undefined;
  return featurePath.split(sep)[0];
};

const scriptKindFor = (sourcePath) => {
  if (sourcePath.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (sourcePath.endsWith(".mjs")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
};

const importBindingViolations = (sourcePath, sourceFile, importDeclaration) => {
  const violations = [];
  const bindings = importDeclaration.importClause?.namedBindings;
  if (bindings && ts.isNamespaceImport(bindings)) {
    const location = sourceFile.getLineAndCharacterOfPosition(bindings.getStart(sourceFile));
    violations.push(
      `${relative(REPOSITORY_ROOT, sourcePath)}:${location.line + 1} namespace imports are forbidden`,
    );
  }
  if (bindings && ts.isNamedImports(bindings)) {
    for (const importSpecifier of bindings.elements) {
      if (!importSpecifier.propertyName) continue;
      const location = sourceFile.getLineAndCharacterOfPosition(
        importSpecifier.getStart(sourceFile),
      );
      violations.push(
        `${relative(REPOSITORY_ROOT, sourcePath)}:${location.line + 1} import aliases are forbidden`,
      );
    }
  }
  return violations;
};

const featureImportViolation = (sourcePath, moduleSpecifier) => {
  const sourceFeature = featureNameFor(sourcePath);
  if (moduleSpecifier.startsWith("@/features/")) {
    const moduleParts = moduleSpecifier.split("/");
    const targetFeature = moduleParts[2];
    if (moduleParts.length !== 3) {
      return `${relative(REPOSITORY_ROOT, sourcePath)} -> ${moduleSpecifier} must use the feature door`;
    }
    if (sourceFeature === targetFeature) {
      return `${relative(REPOSITORY_ROOT, sourcePath)} -> ${moduleSpecifier} must be relative inside one feature`;
    }
    return undefined;
  }
  if (!moduleSpecifier.startsWith(".") || sourceFeature === undefined) return undefined;
  const targetFeature = featureNameFor(resolve(dirname(sourcePath), moduleSpecifier));
  if (targetFeature === undefined || targetFeature === sourceFeature) return undefined;
  return `${relative(REPOSITORY_ROOT, sourcePath)} -> ${moduleSpecifier} crosses a feature without its door`;
};

const sourceFiles = await sourceFilesUnder(SOURCE_ROOT);
const violations = [];

for (const sourcePath of sourceFiles) {
  const sourceText = await readFile(sourcePath, "utf8");
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(sourcePath),
  );
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    violations.push(...importBindingViolations(sourcePath, sourceFile, statement));
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const boundaryViolation = featureImportViolation(sourcePath, statement.moduleSpecifier.text);
    if (boundaryViolation !== undefined) violations.push(boundaryViolation);
  }
}

if (violations.length > 0) {
  console.error("Feature boundary violations:");
  for (const violation of violations) console.error(`  ${violation}`);
  process.exitCode = 1;
} else {
  console.log(`checkBoundaries: OK (${sourceFiles.length} files)`);
}
