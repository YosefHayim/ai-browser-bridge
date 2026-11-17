import {
  GENERATED_IMAGE_SELECTOR,
  PDF_EXTENSION,
  PDF_MIME_TYPE,
  PNG_EXTENSION,
} from "@/providers/chatgpt/page/chatgpt-page-constants.ts";

const ONE_AND_HALF_SECONDS_MILLISECONDS = 1_500;

const JPEG_MIME_TYPE = "image/jpeg";

const GIF_EXTENSION = ".gif";

const WEBP_EXTENSION = ".webp";

const JPG_EXTENSION = ".jpg";

// A multi-image reply shows one large preview plus a thumbnail strip holding every image once.
export const LIST_GENERATED_IMAGES_ORIGIN = `
const listGeneratedImagesIn = (scope) => {
  const stripImages = Array.from(scope.querySelectorAll(${JSON.stringify('[role="group"][aria-label="Generated images"] img')}));
  const hasStripImages = stripImages.length > 0;
  if (hasStripImages) return stripImages;
  return Array.from(scope.querySelectorAll(${JSON.stringify(GENERATED_IMAGE_SELECTOR)}));
};
`;

const DOM_SNAPSHOT_HELPERS_ORIGIN = `
${LIST_GENERATED_IMAGES_ORIGIN}

const TURN_SELECTOR = '[data-testid^="conversation-turn-"]';

const UNIT_SELECTOR = '[data-content-search-unit-key$=":user"], [data-content-search-unit-key$=":assistant"]';

const hasAssistantUnit = (units) =>
  units.some((unit) => unit.getAttribute("data-content-search-unit-key").endsWith(":assistant"));

const conversationTurns = () => {
  const sections = Array.from(document.querySelectorAll(TURN_SELECTOR));
  if (sections.length > 0) return sections;
  const turns = [];
  for (const keyed of Array.from(document.querySelectorAll("[data-turn-key]"))) {
    const units = Array.from(keyed.querySelectorAll(UNIT_SELECTOR));
    turns.push(...units);
    if (!hasAssistantUnit(units) && listGeneratedImagesIn(keyed).length > 0) turns.push(keyed);
  }
  return turns;
};

const imageScope = (turn) => {
  const unitKey = turn.getAttribute("data-content-search-unit-key");
  if (unitKey === null || !unitKey.endsWith(":assistant")) return turn;
  const keyed = turn.closest("[data-turn-key]");
  return keyed === null ? turn : keyed;
};

const turnRoleBlock = (turn) => {
  const authored = turn.querySelector("[data-message-author-role]");
  const isAuthoredFound = authored != null;
  if (isAuthoredFound) {
    const authorRole = authored.getAttribute("data-message-author-role");
    return { block: authored, role: authorRole === null ? "unknown" : authorRole };
  }
  const unitKey = turn.getAttribute("data-content-search-unit-key");
  if (unitKey === null) return null;
  if (unitKey.endsWith(":assistant")) {
    const markdown = turn.querySelector('[data-markdown-text-style="assistant-message"]');
    return { block: markdown === null ? turn : markdown, role: "assistant" };
  }
  if (unitKey.endsWith(":user")) {
    const bubble = turn.querySelector("[data-user-message-bubble]");
    return { block: bubble === null ? turn : bubble, role: "user" };
  }
  return null;
};

const serializeMessage = (element, role, messageIndex) => {
  let messageText = "";
  if (element instanceof HTMLElement) {
    messageText = element.innerText;
  } else if (element.textContent !== null) {
    messageText = element.textContent;
  }
  return {
    role,
    messageIndex,
    text: messageText,
    root: snapshotNode(element),
  };
};

// A turn holding only a generated image has no role block, so it counts as assistant.
const serializeTurn = (turn, messageIndex) => {
  const roleBlock = turnRoleBlock(turn);
  const generatedImages = listGeneratedImagesIn(imageScope(turn));
  const isRoleBlockMissing = roleBlock == null;
  if (isRoleBlockMissing) {
    if (generatedImages.length === 0) return null;
    let turnText = "";
    if (turn instanceof HTMLElement) {
      turnText = turn.innerText;
    } else if (turn.textContent !== null) {
      turnText = turn.textContent;
    }
    return {
      role: "assistant",
      messageIndex,
      text: turnText,
      root: { type: "element", tagName: "div", attributes: {}, children: generatedImages.map(snapshotNode) },
    };
  }
  const message = serializeMessage(roleBlock.block, roleBlock.role, messageIndex);
  const outsideBlock = generatedImages.filter((image) => !roleBlock.block.contains(image));
  if (outsideBlock.length > 0) {
    message.root.children.push(...outsideBlock.map(snapshotNode));
  }
  return message;
};

const turnRole = (turn) => {
  const roleBlock = turnRoleBlock(turn);
  const isRoleBlockFound = roleBlock != null;
  if (isRoleBlockFound) return roleBlock.role;
  if (listGeneratedImagesIn(turn).length > 0) return "assistant";
  return null;
};

const snapshotNode = (node) => {
  if (node.nodeType === Node.TEXT_NODE) {
    return { type: "text", text: node.textContent === null ? "" : node.textContent };
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return { type: "text", text: "" };
  }
  const element = node;
  const attributes = {};
  for (const attribute of Array.from(element.attributes)) {
    attributes[attribute.name] = attribute.value;
  }
  if (element instanceof HTMLImageElement && element.currentSrc) {
    attributes.currentSrc = element.currentSrc;
  }
  return {
    type: "element",
    tagName: element.tagName.toLowerCase(),
    attributes,
    children: Array.from(element.childNodes).map(snapshotNode),
  };
};
`;

export const LAST_ASSISTANT_MESSAGE_SNAPSHOT_ORIGIN = `
(() => {
  ${DOM_SNAPSHOT_HELPERS_ORIGIN}
  const turns = conversationTurns();
  let assistantIndex = -1;
  let lastAssistant = null;
  for (const turn of turns) {
    if (turnRole(turn) === "assistant") {
      assistantIndex += 1;
      lastAssistant = serializeTurn(turn, assistantIndex);
    }
  }
  return lastAssistant;
})()
`;

export const LAST_ASSISTANT_TURN_STATUS_ORIGIN = String.raw`
(() => {
  ${DOM_SNAPSHOT_HELPERS_ORIGIN}
  const countImageMarkers = (text) => {
    const matches = text.match(/\[image-\d+\]/g);
    const isMatchFound = matches != null;
    return isMatchFound ? matches.length : 0;
  };
  const turns = conversationTurns();
  let lastAssistantTurn = null;
  for (const turn of turns) {
    if (turnRole(turn) === "assistant") lastAssistantTurn = turn;
  }
  const isLastAssistantTurnMissing = lastAssistantTurn == null;
  if (isLastAssistantTurnMissing) {
    return { text: "", assetCount: 0, loadedAssetCount: 0, pendingAssetCount: 0, expectedImageMarkerCount: 0 };
  }
  const images = listGeneratedImagesIn(imageScope(lastAssistantTurn));
  let loadedAssetCount = 0;
  let pendingAssetCount = 0;
  for (const node of images) {
    if (node instanceof HTMLImageElement) {
      if (node.complete && node.naturalWidth > 0) loadedAssetCount += 1;
      else pendingAssetCount += 1;
    } else {
      pendingAssetCount += 1;
    }
  }
  const roleBlock = turnRoleBlock(lastAssistantTurn);
  let rawString = "";
  const isAssistantTextFound = lastAssistantTurn.innerText !== "";
  if (roleBlock !== null && roleBlock.block instanceof HTMLElement) {
    rawString = roleBlock.block.innerText;
  } else if (isAssistantTextFound) {
    rawString = lastAssistantTurn.innerText;
  }
  const collapsedString = rawString.replace(/\s+/g, " ").trim();
  return {
    text: collapsedString,
    assetCount: images.length,
    loadedAssetCount,
    pendingAssetCount,
    expectedImageMarkerCount: countImageMarkers(collapsedString),
  };
})()
`;

export const ALL_MESSAGES_SNAPSHOT_ORIGIN = `
(() => {
  ${DOM_SNAPSHOT_HELPERS_ORIGIN}
  let assistantIndex = -1;
  let userIndex = -1;
  const messages = [];
  for (const turn of conversationTurns()) {
    const role = turnRole(turn);
    if (role === null) continue;
    if (role === "assistant") assistantIndex += 1;
    if (role === "user") userIndex += 1;
    let turnIndex = -1;
    if (role === "assistant") turnIndex = assistantIndex;
    else if (role === "user") turnIndex = userIndex;
    const message = serializeTurn(turn, turnIndex);
    const isMessageFound = message != null;
    if (isMessageFound) messages.push(message);
  }
  return messages;
})()
`;

export const MIME_EXTENSIONS: Record<string, string> = {
  "application/pdf": PDF_EXTENSION,
  "image/png": PNG_EXTENSION,
  "image/jpeg": JPG_EXTENSION,
  "image/webp": WEBP_EXTENSION,
  "image/gif": GIF_EXTENSION,
};

export const EXTENSION_MIMES = [
  [PDF_EXTENSION, PDF_MIME_TYPE],
  [PNG_EXTENSION, "image/png"],
  [JPG_EXTENSION, JPEG_MIME_TYPE],
  [".jpeg", JPEG_MIME_TYPE],
  [WEBP_EXTENSION, "image/webp"],
  [GIF_EXTENSION, "image/gif"],
] as const;

export const SETTLE_QUIET_MILLISECONDS = ONE_AND_HALF_SECONDS_MILLISECONDS;

export const ASSET_SETTLE_QUIET_MILLISECONDS = 12_000;

export const IMAGE_STALL_QUIET_MILLISECONDS = 45_000;
