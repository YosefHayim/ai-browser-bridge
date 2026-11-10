import { useCallback } from "react";
import type { AppProps } from "@/terminal/tui/shell/app-types.ts";
import { isDoubleEscapePress } from "@/terminal/tui/shell/shortcuts.ts";
import type { ComposerStatus } from "./use-composer-state.ts";

export type ComposerStopSettings = {
  readonly state: ComposerStatus;
  readonly props: AppProps;
};

export const useComposerStop = (settings: ComposerStopSettings) => {
  const stopFromShortcut = useStopFromShortcut(settings);
  const handleEscapePress = useEscapePress({ ...settings, stopFromShortcut });
  return { stopFromShortcut, handleEscapePress };
};

const useStopFromShortcut = (settings: ComposerStopSettings) => {
  const { state: status, props } = settings;
  return useCallback(() => {
    if (status.refs.stopShortcutRunning.current) return;

    stopChatFromShortcut({ state: status, orchestrator: props.orchestrator });
  }, [props.orchestrator, status]);
};

const stopChatFromShortcut = (details: {
  state: ComposerStatus;
  orchestrator: AppProps["orchestrator"];
}) => {
  details.state.refs.stopShortcutRunning.current = true;
  details.state.setStatus("Stopping ChatGPT...");
  details.orchestrator
    .stopReply()
    .then((stopped) => {
      if (stopped) details.state.setStatus("Stopped active response.");
      else details.state.setStatus("No active response to stop.");
    })
    .catch((error: unknown) => {
      const isErrorObject = error instanceof Error;
      const message = isErrorObject ? error.message : String(error);
      details.state.setStatus(`Error: ${message}`);
      console.error(message);
    })
    .finally(() => {
      details.state.refs.stopShortcutRunning.current = false;
      details.state.forceRender((field) => field + 1);
    });
};

const useEscapePress = (settings: ComposerStopSettings & { stopFromShortcut: () => void }) => {
  const { state: status, stopFromShortcut } = settings;
  return useCallback(
    (now = Date.now()) => {
      const isDoubleEscapeConsumed = consumeDoubleEscape({ state: status, stopFromShortcut, now });
      if (isDoubleEscapeConsumed) return;

      const isStatusModeCommandList = status.mode === "command-list";
      if (isStatusModeCommandList) {
        status.setMode("typing");
        return;
      }

      status.setStatus("Press Esc again to stop ChatGPT");
    },
    [status, stopFromShortcut],
  );
};

const consumeDoubleEscape = (details: {
  state: ComposerStatus;
  stopFromShortcut: () => void;
  now: number;
}): boolean => {
  const isNotDoubleEscapePressLastEscapeAtCurrent = !isDoubleEscapePress(
    details.state.refs.lastEscapeAt.current,
    details.now,
  );
  if (isNotDoubleEscapePressLastEscapeAtCurrent) {
    details.state.refs.lastEscapeAt.current = details.now;
    return false;
  }

  details.state.refs.lastEscapeAt.current = 0;
  details.state.setMode("typing");
  details.stopFromShortcut();
  return true;
};
