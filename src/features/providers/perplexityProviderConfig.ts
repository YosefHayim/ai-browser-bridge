import type { BrowserProvider } from "./browserProviderTypes.ts";
import { GenericWebChatPage } from "./genericWebChatPage.ts";

// LIVE-VERIFY + SHAPE OUTLIER: perplexity.ai is an answer-engine, not a plain chat. Its
// answer blocks interleave inline citations, sources, and "related" follow-ups, so the
// generic capture will include citation noise. A clean reply needs a Perplexity-specific
// captureLastResponse (strip [1]-style markers and the sources rail) — a follow-up once
// the DOM is confirmed against a real signed-in session.
export const PERPLEXITY_PROVIDER: BrowserProvider = new GenericWebChatPage({
  id: "perplexity",
  origin: "perplexity.ai",
  defaultUrl: "https://www.perplexity.ai/",
  defaultModel: "Perplexity",
  displayName: "Perplexity",
  composerSelector: 'textarea, div[contenteditable="true"]',
  assistantSelector: ".prose",
  stopSelector: 'button[aria-label*="Stop"]',
  signedOutSelector: 'button:has-text("Sign Up")',
});
