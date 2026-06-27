import type { Page } from "playwright";
import { attachFilesViaChooser } from "./attach-files-via-chooser.ts";
import { attachFilesViaInput } from "./attach-files-via-input.ts";

/** Attach local files to the ChatGPT composer when the browser UI exposes file upload. */
export async function attachFilesToPrompt(page: Page, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  if (await attachFilesViaInput({ page, paths })) return;
  await attachFilesViaChooser({ page, paths });
}
