import type { Page } from "playwright";
import { ChatGptPageControls } from "@/providers/chatgpt/backend-api/chatgpt-page-controls.ts";
import type { WorkspaceTask } from "@/providers/chatgpt/backend-api/chatgpt-workspace-types.ts";

const scheduledUrl = "https://chatgpt.com/scheduled";
const scheduledPageSettleMilliseconds = 1_200;

const SCHEDULED_LINES_ORIGIN = String.raw`
(() => {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const main = document.querySelector('main, [role="main"]') || document.body;
  const chatLines = Array.from(main.querySelectorAll('[role="row"], li, article'));
  const tasks = [];
  const seen = new Set();
  for (const chatLine of chatLines) {
    const title = clean((chatLine.querySelector('[role="gridcell"], h2, h3, a') || chatLine).textContent);
    if (!title || seen.has(title)) continue;
    seen.add(title);
    tasks.push({ title });
  }
  return tasks;
})()
`;

export async function readScheduledTasks(page: Page): Promise<WorkspaceTask[]> {
  const isOnScheduledPage = page.url().startsWith(scheduledUrl);
  if (!isOnScheduledPage) {
    await new ChatGptPageControls(page).gotoStable(scheduledUrl);
    await page.waitForTimeout(scheduledPageSettleMilliseconds);
  }

  return page.evaluate<WorkspaceTask[]>(SCHEDULED_LINES_ORIGIN);
}
