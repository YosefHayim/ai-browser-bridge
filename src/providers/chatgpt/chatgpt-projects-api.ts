import type { Page } from "playwright";
import { chatGptApiReplyStateFrom, requestChatGptApi } from "./chatgpt-backend-api.ts";
import { type ChatGptProject, lookUpProjectIds } from "./chatgpt-project-lookup.ts";

const PROJECT_SIDEBAR_PATH = "/backend-api/gizmos/snorlax/sidebar";
// Guards the cursor loop: a Project list this long is a bug, not a real account.
const MAX_PROJECT_SIDEBAR_PAGES = 50;

interface ProjectSidebarItem {
  gizmo: {
    id: string;
    display: { name: string };
  };
}

interface ProjectSidebarReply {
  items: ProjectSidebarItem[];
  cursor?: string | null;
}

const readProjectSidebarPage = async (
  page: Page,
  cursor: string | null,
): Promise<ProjectSidebarReply> => {
  const hasCursor = cursor !== null;
  const apiPath = hasCursor
    ? `${PROJECT_SIDEBAR_PATH}?cursor=${encodeURIComponent(cursor)}`
    : PROJECT_SIDEBAR_PATH;
  const reply = await requestChatGptApi(page, { method: "GET", apiPath });

  const state = chatGptApiReplyStateFrom(reply.status);
  const isRateLimited = state === "rate-limited";
  if (isRateLimited) {
    throw new Error(
      "ChatGPT rate-limited the Project list (HTTP 429). Nothing was moved; resume later.",
    );
  }

  const isFailedState = state === "failed";
  if (isFailedState) {
    throw new Error(`ChatGPT Project list failed with HTTP ${reply.status}.`);
  }

  return JSON.parse(reply.bodyText) as ProjectSidebarReply;
};

export const listChatGptProjects = async (page: Page): Promise<ChatGptProject[]> => {
  const projects: ChatGptProject[] = [];
  let cursor: string | null = null;
  let isLastPage = false;
  let pagesRead = 0;

  while (!isLastPage) {
    const hasTooManyPages = pagesRead >= MAX_PROJECT_SIDEBAR_PAGES;
    if (hasTooManyPages) {
      throw new Error(`ChatGPT Project list had more than ${MAX_PROJECT_SIDEBAR_PAGES} pages.`);
    }

    const sidebarPage = await readProjectSidebarPage(page, cursor);
    pagesRead += 1;

    for (const item of sidebarPage.items) {
      projects.push({ id: item.gizmo.id, name: item.gizmo.display.name });
    }
    cursor = sidebarPage.cursor ?? null;
    const isPageEmpty = sidebarPage.items.length === 0;
    isLastPage = cursor === null || isPageEmpty;
  }
  return projects;
};

// Reads the Project list once per run and returns the id of every planned Project name.
export const readProjectIds = async (
  page: Page,
  plannedNames: string[],
): Promise<Map<string, string>> => {
  const projects = await listChatGptProjects(page);
  const lookup = lookUpProjectIds(projects, plannedNames);

  const hasLookupProblemMessage = lookup.problemMessage !== null;
  if (hasLookupProblemMessage) throw new Error(lookup.problemMessage);

  return lookup.projectIdByName;
};
