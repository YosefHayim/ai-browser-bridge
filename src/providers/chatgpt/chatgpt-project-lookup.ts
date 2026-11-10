export interface ChatGptProject {
  id: string;
  name: string;
}

export interface ProjectIdLookup {
  projectIdByName: Map<string, string>;
  problemMessage: string | null;
}

const quotedNames = (names: string[]): string => names.map((name) => `"${name}"`).join(", ");

export const lookUpProjectIds = (
  projects: ChatGptProject[],
  plannedNames: string[],
): ProjectIdLookup => {
  const uniqueNames = [...new Set(plannedNames)];
  const projectIdByName = new Map<string, string>();
  const missingNames: string[] = [];
  const duplicateNames: string[] = [];
  for (const name of uniqueNames) {
    const matches = projects.filter((project) => project.name === name);
    const [onlyMatch] = matches;
    const isMissing = onlyMatch === undefined;
    const hasDuplicates = matches.length > 1;

    if (isMissing) missingNames.push(name);

    if (hasDuplicates) duplicateNames.push(name);

    const isSingleMatch = !isMissing && !hasDuplicates;
    if (isSingleMatch) projectIdByName.set(name, onlyMatch.id);
  }

  const problems: string[] = [];

  const hasMissingNames = missingNames.length > 0;
  if (hasMissingNames) {
    problems.push(
      `Projects not found in ChatGPT (create them first): ${quotedNames(missingNames)}.`,
    );
  }

  const hasDuplicateNames = duplicateNames.length > 0;
  if (hasDuplicateNames) {
    problems.push(
      `Project names that match more than one Project: ${quotedNames(duplicateNames)}.`,
    );
  }

  const hasProblems = problems.length > 0;
  return { projectIdByName, problemMessage: hasProblems ? problems.join(" ") : null };
};

export const projectIdNamed = (
  projectIdByName: Map<string, string>,
  projectName: string,
): string => {
  const projectId = projectIdByName.get(projectName);

  const isProjectIdMissing = projectId === undefined;
  if (isProjectIdMissing) {
    throw new Error(`No ChatGPT Project id was looked up for "${projectName}".`);
  }

  return projectId;
};
