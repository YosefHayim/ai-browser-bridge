// Public attachment + conversation-content surface of the providers feature. The
// implementation lives in chatgpt/chatgptPage.ts (ChatGPT-only today); other
// features import from here, never from the provider class directly (CODE-STYLE.md).
//
// NOTE: the persistence functions (loadManifest/saveManifest/download*) conceptually
// belong under store/; physically relocating them out of the 4.7k-line provider class
// is a deferred refactor (ADR 0004) — this door keeps the boundary clean meanwhile.
export {
  AttachmentDownloadError,
  downloadAll,
  downloadAttachment,
  extractAllMessages,
  loadManifest,
  saveManifest,
} from "./chatgpt/chatgptPage.ts";
