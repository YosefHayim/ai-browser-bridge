#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_SECTIONS = ["Rules", "Canonical example", "Golden path", "Exemplars", "Never"];
const METADATA_PATTERN =
  /^\[rule:(?<ruleId>[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*)\] · verify: (?:(?:`(?<command>[^`]+)`)|(?<judgment>judgment))$/u;

const fencedLineIndexes = (lines) => {
  const fencedLines = new Set();
  let insideFence = false;
  for (const [lineIndex, lineText] of lines.entries()) {
    if (lineText.startsWith("```")) {
      insideFence = !insideFence;
      fencedLines.add(lineIndex);
      continue;
    }
    if (insideFence) fencedLines.add(lineIndex);
  }
  return fencedLines;
};

const firstContentIndex = (lines, start, end) => {
  for (let lineIndex = start; lineIndex < end; lineIndex += 1) {
    if (lines[lineIndex]?.trim().length > 0) return lineIndex;
  }
  return -1;
};

const sectionHeadings = (lines, fencedLines) =>
  lines.flatMap((lineText, lineIndex) => {
    if (!lineText.startsWith("## ") || fencedLines.has(lineIndex)) return [];
    return [{ title: lineText.slice(3).trim(), lineIndex }];
  });

const cardRanges = (lines, fencedLines, rulesStart, rulesEnd) => {
  const headingIndexes = lines.flatMap((lineText, lineIndex) => {
    if (
      lineIndex <= rulesStart ||
      lineIndex >= rulesEnd ||
      !lineText.startsWith("### ") ||
      fencedLines.has(lineIndex)
    ) {
      return [];
    }
    return [lineIndex];
  });
  return headingIndexes.map((headingIndex, cardIndex) => {
    const nextHeadingIndex = headingIndexes[cardIndex + 1];
    return {
      headingIndex,
      end: nextHeadingIndex === undefined ? rulesEnd : nextHeadingIndex,
    };
  });
};

const validateCard = (lines, card, rulesById) => {
  const violations = [];
  const metadataIndex = firstContentIndex(lines, card.headingIndex + 1, card.end);
  const metadataText = lines[metadataIndex]?.trim();
  const metadataMatch =
    metadataText === undefined ? undefined : METADATA_PATTERN.exec(metadataText);
  if (!metadataMatch?.groups) {
    return [
      {
        ruleId: "format.rule-card",
        line: card.headingIndex + 1,
        message: "Rule card has no valid metadata line",
      },
    ];
  }

  const ruleId = metadataMatch.groups.ruleId;
  const verifyCommand = metadataMatch.groups.command;
  const documentedVerify = verifyCommand === undefined ? "judgment" : verifyCommand;
  const declaredRule = rulesById.get(ruleId);
  if (declaredRule === undefined) {
    violations.push({
      ruleId,
      line: metadataIndex + 1,
      message: "Rule has no machine mirror entry",
    });
  } else if (declaredRule.verify !== documentedVerify) {
    violations.push({
      ruleId,
      line: metadataIndex + 1,
      message: "Rule verification command differs from the machine mirror",
    });
  }

  const assertionIndex = firstContentIndex(lines, metadataIndex + 1, card.end);
  const assertion = lines[assertionIndex]?.trim();
  if (
    assertion === undefined ||
    !assertion.endsWith(".") ||
    assertion.includes(". ") ||
    assertion.startsWith("```")
  ) {
    violations.push({
      ruleId,
      line: assertionIndex + 1,
      message: "Rule assertion must be exactly one sentence",
    });
  } else if (declaredRule !== undefined && declaredRule.statement !== assertion) {
    violations.push({
      ruleId,
      line: assertionIndex + 1,
      message: "Rule assertion differs from the machine mirror",
    });
  }

  const fenceStart = lines.findIndex(
    (lineText, lineIndex) =>
      lineIndex > assertionIndex && lineIndex < card.end && lineText.startsWith("```"),
  );
  const fenceEnd = lines.findIndex(
    (lineText, lineIndex) =>
      lineIndex > fenceStart && lineIndex < card.end && lineText.startsWith("```"),
  );
  if (fenceStart < 0 || fenceEnd < 0) {
    violations.push({
      ruleId,
      line: assertionIndex + 1,
      message: "Rule needs one example block",
    });
    return violations;
  }
  const exampleText = lines.slice(fenceStart + 1, fenceEnd).join("\n");
  if (!exampleText.includes("// ✓")) {
    violations.push({
      ruleId,
      line: fenceStart + 1,
      message: "Rule example needs a chosen case",
    });
  }
  if (!exampleText.includes("// ✗")) {
    violations.push({
      ruleId,
      line: fenceStart + 1,
      message: "Rule example needs a rejected case",
    });
  }
  if (!lines.slice(fenceEnd + 1, card.end).some((lineText) => lineText.startsWith("Why:"))) {
    violations.push({
      ruleId,
      line: fenceEnd + 1,
      message: "Rule needs a Why line",
    });
  }
  return violations;
};

export const checkStyleGuide = ({ guideText, declaredRules }) => {
  const lines = guideText.split("\n");
  const fencedLines = fencedLineIndexes(lines);
  const headings = sectionHeadings(lines, fencedLines);
  const violations = [];
  let previousSectionIndex = -1;
  for (const requiredSection of REQUIRED_SECTIONS) {
    const sectionIndex = headings.findIndex((heading) => heading.title.startsWith(requiredSection));
    if (sectionIndex < 0) {
      violations.push({
        ruleId: "format.sections",
        line: 1,
        message: `Missing section: ${requiredSection}`,
      });
      continue;
    }
    if (sectionIndex <= previousSectionIndex) {
      violations.push({
        ruleId: "format.sections",
        line: headings[sectionIndex].lineIndex + 1,
        message: `Section is out of order: ${requiredSection}`,
      });
    }
    previousSectionIndex = sectionIndex;
  }

  const rulesHeading = headings.find((heading) => heading.title === "Rules");
  if (rulesHeading === undefined) return violations;
  const nextHeading = headings.find((heading) => heading.lineIndex > rulesHeading.lineIndex);
  const rulesEnd = nextHeading === undefined ? lines.length : nextHeading.lineIndex;
  const rulesById = new Map(declaredRules.map((rule) => [rule.id, rule]));
  const cards = cardRanges(lines, fencedLines, rulesHeading.lineIndex, rulesEnd);
  const documentedIds = [];
  for (const card of cards) {
    violations.push(...validateCard(lines, card, rulesById));
    const metadataIndex = firstContentIndex(lines, card.headingIndex + 1, card.end);
    const metadataLine = lines[metadataIndex];
    const metadataText = metadataLine === undefined ? "" : metadataLine.trim();
    const metadataMatch = METADATA_PATTERN.exec(metadataText);
    if (metadataMatch?.groups?.ruleId !== undefined) {
      documentedIds.push(metadataMatch.groups.ruleId);
    }
  }

  const duplicateIds = documentedIds.filter(
    (ruleId, ruleIndex) => documentedIds.indexOf(ruleId) !== ruleIndex,
  );
  for (const duplicateId of new Set(duplicateIds)) {
    violations.push({
      ruleId: duplicateId,
      line: 1,
      message: "Rule appears more than once",
    });
  }
  for (const declaredRule of declaredRules) {
    if (documentedIds.includes(declaredRule.id)) continue;
    violations.push({
      ruleId: declaredRule.id,
      line: 1,
      message: "Machine rule has no guide card",
    });
  }
  if (
    documentedIds.length === declaredRules.length &&
    documentedIds.some((ruleId, ruleIndex) => declaredRules[ruleIndex]?.id !== ruleId)
  ) {
    violations.push({
      ruleId: "format.order",
      line: 1,
      message: "Guide cards and machine rules use different orders",
    });
  }
  return violations;
};

const reportRepositoryGuide = async () => {
  const repositoryRoot = join(import.meta.dirname, "..");
  const guideText = await readFile(join(repositoryRoot, "CODE-STYLE.md"), "utf8");
  const rulesText = await readFile(join(repositoryRoot, "code-style.rules.json"), "utf8");
  const declaredRules = JSON.parse(rulesText).rules;
  const violations = checkStyleGuide({ guideText, declaredRules });
  if (violations.length === 0) {
    console.log(`checkStyleGuide: OK (${declaredRules.length} rules)`);
    return;
  }
  for (const violation of violations) {
    console.error(`${violation.ruleId}:${violation.line} ${violation.message}`);
  }
  process.exitCode = 1;
};

const invokedPath = process.argv[1];
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  await reportRepositoryGuide();
}
