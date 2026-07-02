import { useCallback } from "react";
import type { AppProps } from "./appTypes.ts";
import { isDoubleEscapePress } from "./shortcuts.ts";
import type { ComposerState } from "./useComposerState.ts";

/** Options for stop and escape handling. */
export type ComposerStopOptions = {
  /** Composer state container. */
  state: ComposerState;
  /** App props containing the orchestrator. */
  props: AppProps;
};

/** Creates stop and escape handlers for the composer. */
export function useComposerStop(options: ComposerStopOptions) {
  const stopFromShortcut = useStopFromShortcut(options);
  const handleEscapePress = useHandleEscapePress({ ...options, stopFromShortcut });
  return { stopFromShortcut, handleEscapePress };
}

function useStopFromShortcut(options: ComposerStopOptions) {
  const { state, props } = options;
  return useCallback(() => {
    if (state.refs.stopShortcutRunning.current) return;
    runStopShortcut({ state, orchestrator: props.orchestrator });
  }, [props.orchestrator, state]);
}

function runStopShortcut(input: { state: ComposerState; orchestrator: AppProps["orchestrator"] }) {
  input.state.refs.stopShortcutRunning.current = true;
  input.state.setStatus("Stopping ChatGPT...");
  input.orchestrator
    .stopResponse()
    .then((stopped) => {
      input.state.setStatus(stopped ? "Stopped active response." : "No active response to stop.");
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
}

function useHandleEscapePress(options: ComposerStopOptions & { stopFromShortcut: () => void }) {
  const { state, stopFromShortcut } = options;
  return useCallback(
    (now = Date.now()) => {
      if (handleDoubleEscape({ state, stopFromShortcut, now })) return;
      if (state.mode === "command-list") {
        state.setMode("typing");
        return;
      }
      state.setStatus("Press Esc again to stop ChatGPT");
    },
    [state, stopFromShortcut],
  );
}

function handleDoubleEscape(input: {
  state: ComposerState;
  stopFromShortcut: () => void;
  now: number;
}) {
  if (!isDoubleEscapePress(input.state.refs.lastEscapeAt.current, input.now)) {
    input.state.refs.lastEscapeAt.current = input.now;
    return false;
  }
  input.state.refs.lastEscapeAt.current = 0;
  input.state.setMode("typing");
  input.stopFromShortcut();
  return true;
}
