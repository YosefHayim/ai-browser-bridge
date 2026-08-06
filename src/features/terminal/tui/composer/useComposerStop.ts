import { useCallback } from "react";
import type { AppProps } from "../shell/appTypes.ts";
import { isDoubleEscapePress } from "../shell/shortcuts.ts";
import type { ComposerState } from "./useComposerState.ts";

/** Options for stop and escape handling. */
export type ComposerStopOptions = {
  state: ComposerState;
  props: AppProps;
};

/** Stop and escape handlers for the composer. */
export const useComposerStop = (options: ComposerStopOptions) => {
  const stopFromShortcut = useStopFromShortcut(options);
  const handleEscapePress = useEscapePress({ ...options, stopFromShortcut });
  return { stopFromShortcut, handleEscapePress };
};

const useStopFromShortcut = (options: ComposerStopOptions) => {
  const { state, props } = options;
  return useCallback(() => {
    if (state.refs.stopShortcutRunning.current) return;
    runStopShortcut({ state, orchestrator: props.orchestrator });
  }, [props.orchestrator, state]);
};

const runStopShortcut = (input: {
  state: ComposerState;
  orchestrator: AppProps["orchestrator"];
}) => {
  input.state.refs.stopShortcutRunning.current = true;
  input.state.setStatus("Stopping ChatGPT...");
  input.orchestrator
    .stopResponse()
    .then((stopped) => {
      if (stopped) input.state.setStatus("Stopped active response.");
      else input.state.setStatus("No active response to stop.");
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      input.state.setStatus(`Error: ${message}`);
      console.error(message);
    })
    .finally(() => {
      input.state.refs.stopShortcutRunning.current = false;
      input.state.forceRender((value) => value + 1);
    });
};

const useEscapePress = (options: ComposerStopOptions & { stopFromShortcut: () => void }) => {
  const { state, stopFromShortcut } = options;
  return useCallback(
    (now = Date.now()) => {
      if (consumeDoubleEscape({ state, stopFromShortcut, now })) return;
      if (state.mode === "command-list") {
        state.setMode("typing");
        return;
      }
      state.setStatus("Press Esc again to stop ChatGPT");
    },
    [state, stopFromShortcut],
  );
};

const consumeDoubleEscape = (input: {
  state: ComposerState;
  stopFromShortcut: () => void;
  now: number;
}): boolean => {
  if (!isDoubleEscapePress(input.state.refs.lastEscapeAt.current, input.now)) {
    input.state.refs.lastEscapeAt.current = input.now;
    return false;
  }
  input.state.refs.lastEscapeAt.current = 0;
  input.state.setMode("typing");
  input.stopFromShortcut();
  return true;
};
