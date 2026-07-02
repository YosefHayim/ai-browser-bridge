import type { BrowserProvider } from "./browserProviderTypes.ts";
import { GenericWebChatPage } from "./genericWebChatPage.ts";

// LIVE-VERIFY: these selectors are a best-effort starting point and MUST be confirmed
// against the real, signed-in claude.ai DOM before this provider is trusted. The
// generic adapter degrades gracefully (empty capture) when a selector misses.
export const CLAUDE_PROVIDER: BrowserProvider = new GenericWebChatPage({
  id: "claude",
  origin: "claude.ai",
  defaultUrl: "https://claude.ai/new",
  defaultModel: "Claude",
  displayName: "Claude",
  composerSelector: 'div[contenteditable="true"]',
  assistantSelector: "div.font-claude-message",
  userSelector: '[data-testid="user-message"]',
  stopSelector: 'button[aria-label="Stop response"]',
  signedOutSelector: 'a[href*="/login"]',
});
