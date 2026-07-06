// ChatGPT attachment + conversation-content surface. The implementation lives in
// chatgptPage.ts today; the feature door re-exports these helpers so external
// features do not import the provider class directly.
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
} from "./chatgptPage.ts";
