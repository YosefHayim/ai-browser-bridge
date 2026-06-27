export const DOM_SNAPSHOT_HELPERS_SOURCE = String.raw`
const GENERATED_IMAGE_SELECTOR = 'img[src*="/backend-api/estuary/content"], img[alt^="Generated image"]';

function serializeMessage(element, messageIndex) {
  return {
    role: element.getAttribute("data-message-author-role") ?? "unknown",
    messageIndex,
    text: element instanceof HTMLElement ? element.innerText : element.textContent ?? "",
    root: snapshotNode(element),
  };
}

// Serialize one conversation turn. Resolves role from an inner role block when present;
// otherwise a turn that only holds a generated image is treated as an assistant message.
// Generated images that render outside the role block (but inside the turn) are appended
// as extra children so the walker still visits them.
function serializeTurn(turn, messageIndex) {
  const roleBlock = turn.querySelector("[data-message-author-role]");
  const generatedImages = Array.from(turn.querySelectorAll(GENERATED_IMAGE_SELECTOR));

  if (!roleBlock) {
    if (generatedImages.length === 0) return null;
    return {
      role: "assistant",
      messageIndex,
      text: turn instanceof HTMLElement ? turn.innerText : turn.textContent ?? "",
      root: { type: "element", tagName: "div", attributes: {}, children: generatedImages.map(snapshotNode) },
    };
  }

  const message = serializeMessage(roleBlock, messageIndex);
  const outsideBlock = generatedImages.filter((image) => !roleBlock.contains(image));
  if (outsideBlock.length > 0) {
    message.root.children.push(...outsideBlock.map(snapshotNode));
  }
  return message;
}

function turnRole(turn) {
  const roleBlock = turn.querySelector("[data-message-author-role]");
  if (roleBlock) return roleBlock.getAttribute("data-message-author-role") ?? "unknown";
  if (turn.querySelector(GENERATED_IMAGE_SELECTOR)) return "assistant";
  return null;
}

function snapshotNode(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    return { type: "text", text: node.textContent ?? "" };
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
}
`;

export const LAST_ASSISTANT_MESSAGE_SNAPSHOT_SOURCE = String.raw`
(() => {
  ${DOM_SNAPSHOT_HELPERS_SOURCE}

  const turns = Array.from(document.querySelectorAll('section[data-testid^="conversation-turn-"]'));
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

export const ALL_MESSAGES_SNAPSHOT_SOURCE = String.raw`
(() => {
  ${DOM_SNAPSHOT_HELPERS_SOURCE}

  let assistantIndex = -1;
  let userIndex = -1;
  const messages = [];
  for (const turn of Array.from(document.querySelectorAll('section[data-testid^="conversation-turn-"]'))) {
    const role = turnRole(turn);
    if (role === null) continue;
    if (role === "assistant") assistantIndex += 1;
    if (role === "user") userIndex += 1;
    const message = serializeTurn(turn, role === "assistant" ? assistantIndex : role === "user" ? userIndex : -1);
    if (message) messages.push(message);
  }
  return messages;
})()
`;
