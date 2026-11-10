import {
  type ChatGptRenderStatus,
  readAllChatGptTabRenderStatuses,
  readChatGptRenderStatus,
} from "@/providers/chatgpt/chatgpt-render-state.ts";
import type { ChatgptCommandSettings } from "./cli-types.ts";
import { startWorkspaceSession } from "./engine-session.ts";

const createRenderStatusLine = (status: ChatGptRenderStatus): string => {
  const isStreaming = status.streaming;
  const parts = [
    isStreaming ? "streaming" : "idle",
    `images ${status.images.loaded}/${status.images.total}`,
  ];

  const hasPendingImages = status.images.pending > 0;
  if (hasPendingImages) parts.push(`${status.images.pending} pending`);

  const hasExpectedImages = status.expectedImageMarkers > 0;
  if (hasExpectedImages) parts.push(`${status.expectedImageMarkers} expected`);

  const isMisfireSuspected = status.misfireSuspected;
  if (isMisfireSuspected) parts.push("misfire?");

  const isLimitHit = status.limitHit;
  if (isLimitHit) {
    const limitNotice = status.limitNotice ?? "hit";
    parts.push(`limit: ${limitNotice}`);
  }

  return parts.join(" | ");
};

export const runChatgptInspect = async (settings: ChatgptCommandSettings): Promise<void> => {
  const { engine, page } = await startWorkspaceSession(settings);

  const isAllTabs = settings.allTabs === true;
  if (isAllTabs) {
    const tabs = await readAllChatGptTabRenderStatuses(page);
    await engine.shutDown({ closeBrowser: false });

    const isThereNoTab = tabs.length === 0;

    const isMachineReadable = settings.json;
    if (isMachineReadable) process.stdout.write(`${JSON.stringify(tabs)}\n`);
    else if (isThereNoTab) process.stdout.write("No ChatGPT tabs open.\n");
    else
      for (const tab of tabs) process.stdout.write(`${createRenderStatusLine(tab)}\t${tab.url}\n`);

    return;
  }

  const status = await readChatGptRenderStatus(page);
  await engine.shutDown({ closeBrowser: false });

  const isMachineReadable = settings.json;
  process.stdout.write(
    isMachineReadable ? `${JSON.stringify(status)}\n` : `${createRenderStatusLine(status)}\n`,
  );
};
