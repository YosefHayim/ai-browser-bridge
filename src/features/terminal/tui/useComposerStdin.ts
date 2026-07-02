import { useEffect } from "react";
import { ESCAPE_CONTROL } from "./composerConstants.ts";

/** Options for stdin escape forwarding. */
export type ComposerStdinEscapeOptions = {
  /** Escape press handler. */
  handleEscapePress: (now?: number) => void;
};

/** Forwards raw stdin escape bytes to the composer escape handler. */
export function useComposerStdinEscape(options: ComposerStdinEscapeOptions) {
  useEffect(() => {
    const handleStdinData = (chunk: Buffer | string) => {
      forwardEscapePresses({
        text: chunk.toString(),
        handleEscapePress: options.handleEscapePress,
      });
    };
    process.stdin.on("data", handleStdinData);
    return () => {
      process.stdin.off("data", handleStdinData);
    };
  }, [options.handleEscapePress]);
}

function forwardEscapePresses(input: { text: string; handleEscapePress: (now?: number) => void }) {
  const escapeCount = input.text.length - input.text.replaceAll(ESCAPE_CONTROL, "").length;
  if (escapeCount === 0) return;
  const now = Date.now();
  for (let index = 0; index < escapeCount; index += 1) {
    input.handleEscapePress(now + index);
  }
}
