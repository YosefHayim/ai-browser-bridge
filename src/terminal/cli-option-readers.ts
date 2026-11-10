import { resolve } from "node:path";
import {
  readChatGptConversationIdFromUrl,
  readChatGptConversationUrlFromIdOrUrl,
} from "@/providers/chatgpt/chatgpt-conversation-url.ts";

const DECIMAL_RADIX = 10;

export const PORT_FLAG = "--port";

export const FILES_FLAG = "--files";

export const DEBUG_PORT_FLAG = "--debug-port";

// undefined for absent/invalid so the browser layer uses its default wait.
export const convertSecondsToTimeoutMilliseconds = (
  seconds: string | undefined,
): number | undefined => {
  const isSecondsUnset = !seconds;
  if (isSecondsUnset) return undefined;

  const parsed = Number(seconds);

  const isNotPositiveNumber = Number.isNaN(parsed) || parsed <= 0;
  if (isNotPositiveNumber) return undefined;

  const millisecondsPerSecond = 1000;

  return Math.round(parsed * millisecondsPerSecond);
};

export const readPositiveIntegerFromOption = (
  flagArgument: string | undefined,
): number | undefined => {
  const isFlagArgumentMissing = flagArgument == null;
  if (isFlagArgumentMissing) return undefined;

  const parsed = Number.parseInt(flagArgument, DECIMAL_RADIX);
  const isPositiveNumber = Number.isFinite(parsed) && parsed > 0;
  return isPositiveNumber ? parsed : undefined;
};

export const readNonNegativeIntegerFromOption = (field: string | undefined): number | undefined => {
  const isOptionFieldAbsent = field == null;
  if (isOptionFieldAbsent) return undefined;

  const parsed = Number.parseInt(field, DECIMAL_RADIX);
  const isNonNegativeNumber = Number.isFinite(parsed) && parsed >= 0;
  return isNonNegativeNumber ? parsed : undefined;
};

export const readImageCountFromOption = (flagArgument: string | undefined): number | undefined => {
  const isFlagArgumentUnset = flagArgument == null;
  if (isFlagArgumentUnset) return undefined;

  const parsed = Number.parseInt(flagArgument, DECIMAL_RADIX);
  const isPositiveNumber = Number.isFinite(parsed) && parsed > 0;
  return isPositiveNumber ? parsed : undefined;
};

const LOWEST_PORT = 1;

const HIGHEST_PORT = 65535;

export const parsePortFlag = (
  flagName: string,
  portArgument: string | undefined,
): number | undefined => {
  const isPortMissing = portArgument == null || portArgument === "";
  if (isPortMissing) return undefined;

  const port = Number(portArgument);

  const isPortValid = /^\d+$/.test(portArgument) && port >= LOWEST_PORT && port <= HIGHEST_PORT;
  if (isPortValid) return port;

  throw new Error(`${flagName} must be a whole number from ${LOWEST_PORT} to ${HIGHEST_PORT}.`);
};

export const readAbsolutePathFromOption = (field: string | undefined): string | null => {
  const isFieldFound = field != null && field !== "";
  return isFieldFound ? resolve(field) : null;
};

export const readConversationUrlFromOption = (field: string): string => {
  return readChatGptConversationUrlFromIdOrUrl(field);
};

export const readConversationIdFromOption = (field: string): string => {
  const conversationUrl = readConversationUrlFromOption(field);
  const conversationId = readChatGptConversationIdFromUrl(conversationUrl);

  const isNotChatUrl = conversationId == null;
  if (isNotChatUrl) throw new Error(`Not a ChatGPT chat id or URL: ${field}`);

  return conversationId;
};

export const parseAttachmentIds = (fields: readonly string[] | undefined): string[] | null => {
  const hasNoFields = !fields;
  if (hasNoFields) return null;

  const ids = fields
    .flatMap((field) => field.split(/[\s,]+/))
    .map((id) => id.trim())
    .filter(Boolean);
  const isIdsNotEmpty = ids.length > 0;
  return isIdsNotEmpty ? ids : null;
};

export const readLimitFromOption = (field: string | undefined): number | null => {
  const hasNoField = !field;
  if (hasNoField) return null;

  const parsed = Number.parseInt(field, DECIMAL_RADIX);
  const isPositiveNumber = Number.isFinite(parsed) && parsed > 0;
  return isPositiveNumber ? parsed : null;
};
