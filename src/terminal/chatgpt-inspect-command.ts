import {
  type ChatGptRenderStatus,
  readAllChatGptTabRenderStatuses,
  readChatGptRenderStatus,
} from "@/providers/chatgpt/chatgpt-render-state.ts";
import type { ChatgptCommandSettings } from "./cli-types.ts";
import { startWorkspaceSession } from "./engine-session.ts";

const createRenderStatusLine = (status: ChatGptRenderStatus): string => {
  const parts = [
    status.streaming ? "streaming" : "idle",
    `images ${status.images.loaded}/${status.images.total}`,
  ];

  const hasPendingImages = status.images.pending > 0;
  if (hasPendingImages) parts.push(`${status.images.pending} pending`);

  const hasExpectedImages = status.expectedImageMarkers > 0;
  if (hasExpectedImages) parts.push(`${status.expectedImageMarkers} expected`);

  if (status.misfireSuspected) parts.push("misfire?");

  if (status.limitHit) {
    const limitNotice = status.limitNotice == null ? "hit" : status.limitNotice;
    parts.push(`limit: ${limitNotice}`);
  }

  return parts.join(" | ");
};

export const runChatgptInspect = async (settings: ChatgptCommandSettings): Promise<void> => {
  const { engine, page } = await startWorkspaceSession(settings);

  if (settings.allTabs) {
    const tabs = await readAllChatGptTabRenderStatuses(page);
    await engine.shutDown({ closeBrowser: false });

    if (settings.json) process.stdout.write(`${JSON.stringify(tabs)}\n`);
    else if (tabs.length === 0) process.stdout.write("No ChatGPT tabs open.\n");
    else
      for (const tab of tabs) process.stdout.write(`${createRenderStatusLine(tab)}\t${tab.url}\n`);

    return;
  }

  const status = await readChatGptRenderStatus(page);
  await engine.shutDown({ closeBrowser: false });
  process.stdout.write(
    settings.json ? `${JSON.stringify(status)}\n` : `${createRenderStatusLine(status)}\n`,
  );
};
