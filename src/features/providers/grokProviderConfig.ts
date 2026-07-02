import type { BrowserProvider } from "./browserProviderTypes.ts";
import { GenericWebChatPage } from "./genericWebChatPage.ts";

// LIVE-VERIFY: best-effort selectors for grok.com — x.ai ships frequent UI changes, so
// confirm and expect to re-check these against the real, signed-in DOM.
export const GROK_PROVIDER: BrowserProvider = new GenericWebChatPage({
  id: "grok",
  origin: "grok.com",
  defaultUrl: "https://grok.com/",
  defaultModel: "Grok",
  displayName: "Grok",
  composerSelector: "textarea",
  assistantSelector: '[class*="message-bubble"]',
  stopSelector: 'button[aria-label*="Stop"]',
  signedOutSelector: 'button:has-text("Sign in")',
});
