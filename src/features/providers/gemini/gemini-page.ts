export { SELECTORS } from "./selectors.config.ts";
export { injectPrompt } from "./inject-prompt.ts";
export { waitForResponse, isTurnSettled, type ResponseWaitOptions } from "./wait-response.ts";
export {
  captureLastResponse,
  countAssistantResponses,
  captureAllMessages,
} from "./capture-response.ts";
export {
  GuestSessionError,
  isGuestSession,
  assertSignedIn,
  readSidebarConversations,
  navigateToConversation,
  newConversation,
} from "./gemini-navigation.ts";
export {
  isLikelyModelLabel,
  detectCurrentModel,
  listAvailableModels,
  selectModel,
} from "./gemini-model.ts";
export {
  rewindLastUserPrompt,
  stopGenerating,
  attachFilesToPrompt,
} from "./gemini-actions.ts";
