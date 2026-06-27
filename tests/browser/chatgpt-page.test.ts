import { describe, expect, it } from "vitest";
import { SELECTORS } from "../../src/browser/chatgpt-page.ts";

describe("ChatGPT page selectors", () => {
  it("includes current account menu selectors used by ChatGPT settings", () => {
    expect(SELECTORS.accountMenuButton).toContain('[data-testid="accounts-profile-button"]');
    expect(SELECTORS.accountMenuButton).toContain('[role="button"][aria-label*="open profile menu" i]');
  });

  it("matches ChatGPT-generated images by estuary content path and generated-image alt", () => {
    expect(SELECTORS.generatedImage).toContain("/backend-api/estuary/content");
    expect(SELECTORS.generatedImage).toContain('img[alt^="Generated image" i]');
  });
});
