import type { BrowserProvider } from "./browserProviderTypes.ts";
import { GenericWebChatPage } from "./genericWebChatPage.ts";

// LIVE-VERIFY: best-effort selectors for chat.deepseek.com — confirm against the real,
// signed-in DOM before trusting this provider.
export const DEEPSEEK_PROVIDER: BrowserProvider = new GenericWebChatPage({
  id: "deepseek",
  origin: "chat.deepseek.com",
  defaultUrl: "https://chat.deepseek.com/",
  defaultModel: "DeepSeek",
  displayName: "DeepSeek",
  composerSelector: "textarea#chat-input, textarea",
  assistantSelector: ".ds-markdown",
  stopSelector: 'div[role="button"][aria-label*="Stop"]',
  signedOutSelector: 'button:has-text("Log in")',
});
