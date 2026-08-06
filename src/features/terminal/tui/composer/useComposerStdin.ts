import { useEffect } from "react";
import { ESCAPE_CONTROL } from "./composerConstants.ts";

export type ComposerStdinEscapeOptions = {
  readonly handleEscapePress: (now?: number) => void;
};

/** Forwards raw stdin ESC bytes that Ink does not surface as key events. */
export const useComposerStdinEscape = (options: ComposerStdinEscapeOptions) => {
  useEffect(() => {
    const handleStdinChunk = (chunk: Buffer | string) => {
      forwardEscapePresses({
        text: chunk.toString(),
        handleEscapePress: options.handleEscapePress,
      });
    };
    process.stdin.on("data", handleStdinChunk);
    return () => {
      process.stdin.off("data", handleStdinChunk);
    };
  }, [options.handleEscapePress]);
};

const forwardEscapePresses = (input: {
  text: string;
  handleEscapePress: (now?: number) => void;
}) => {
  const escapeCount = input.text.length - input.text.replaceAll(ESCAPE_CONTROL, "").length;
  if (escapeCount === 0) return;
  const now = Date.now();
  for (let index = 0; index < escapeCount; index += 1) {
    input.handleEscapePress(now + index);
  }
};
