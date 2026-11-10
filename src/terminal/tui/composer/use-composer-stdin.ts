import { useEffect } from "react";
import { ESCAPE_CONTROL } from "./composer-constants.ts";

export type ComposerStdinEscapeSettings = {
  readonly handleEscapePress: (now?: number) => void;
};

export const useComposerStdinEscape = (settings: ComposerStdinEscapeSettings) => {
  useEffect(() => {
    const forwardStdinChunk = (chunk: Buffer | string) => {
      forwardEscapePresses({
        text: chunk.toString(),
        handleEscapePress: settings.handleEscapePress,
      });
    };

    process.stdin.on("data", forwardStdinChunk);

    return () => {
      process.stdin.off("data", forwardStdinChunk);
    };
  }, [settings.handleEscapePress]);
};

const forwardEscapePresses = (details: {
  text: string;
  handleEscapePress: (now?: number) => void;
}) => {
  const escapeCount = details.text.length - details.text.replaceAll(ESCAPE_CONTROL, "").length;

  const isNoEscapePending = escapeCount === 0;
  if (isNoEscapePending) return;

  const now = Date.now();
  for (let index = 0; index < escapeCount; index += 1) {
    details.handleEscapePress(now + index);
  }
};
