import type { Page } from "playwright";
import { SELECTORS } from "@/providers/chatgpt/page/chatgpt-selectors.ts";

type ReadComposerStringDetails = {
  page: Page;
};

export async function readComposerString(details: ReadComposerStringDetails): Promise<string> {
  const composerDraft = await details.page.evaluate((selector) => {
    function isRendered(element: Element): boolean {
      return element.getClientRects().length > 0;
    }
    const prompt = [...document.querySelectorAll<HTMLElement>(selector)].find(isRendered);

    const isThereNoRenderedComposer = prompt == null;
    if (isThereNoRenderedComposer) return "";

    const promptField: unknown = Reflect.get(prompt, "value");

    const isTypeString = typeof promptField === "string";
    if (isTypeString) return promptField.trim();

    // biome-ignore lint/performance/useDomNodeTextContent: the prompt copy must match what the user sees
    return (prompt.innerText ?? prompt.textContent ?? "").trim();
  }, SELECTORS.promptInput);

  const isDraftMissing = composerDraft == null;
  if (isDraftMissing) return "";

  return composerDraft;
}
