export interface ChatGptProject {
  id: string;
  name: string;
}

export interface ProjectIdLookup {
  projectIdByName: Map<string, string>;
  problemMessage: string | null;
}

const readQuotedNames = (names: string[]): string => names.map((name) => `"${name}"`).join(", ");

export const findProjectIds = (
  projects: ChatGptProject[],
  plannedNames: string[],
): ProjectIdLookup => {
  const uniqueNames = [...new Set(plannedNames)];
  const projectIdByName = new Map<string, string>();
  const missingNames: string[] = [];
  const duplicateNames: string[] = [];
  for (const name of uniqueNames) {
    const hits = projects.filter((project) => project.name === name);
    const [onlyHit] = hits;
    const isMissing = onlyHit == null;
    const hasDuplicates = hits.length > 1;

    if (isMissing) missingNames.push(name);

    if (hasDuplicates) duplicateNames.push(name);

    const isSingleHit = !isMissing && !hasDuplicates;
    if (isSingleHit) projectIdByName.set(name, onlyHit.id);
  }

  const problems: string[] = [];

  const hasMissingNames = missingNames.length > 0;
  if (hasMissingNames) {
    problems.push(
      `Projects not found in ChatGPT (create them first): ${readQuotedNames(missingNames)}.`,
    );
  }

  const hasDuplicateNames = duplicateNames.length > 0;
  if (hasDuplicateNames) {
    problems.push(
      `Project names that match more than one Project: ${readQuotedNames(duplicateNames)}.`,
    );
  }

  const hasProblems = problems.length > 0;
  return { projectIdByName, problemMessage: hasProblems ? problems.join(" ") : null };
};

export const readProjectIdNamed = (
  projectIdByName: Map<string, string>,
  projectName: string,
): string => {
  const projectId = projectIdByName.get(projectName);

  const isProjectIdMissing = projectId == null;
  if (isProjectIdMissing) {
    throw new Error(`No ChatGPT Project id was looked up for "${projectName}".`);
  }

  return projectId;
};
