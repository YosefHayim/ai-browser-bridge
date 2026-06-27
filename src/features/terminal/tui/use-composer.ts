import type { AppProps } from "./app-types.ts";
import type { ComposerAssistPanelProps } from "./ComposerAssistPanel.tsx";
import type { ComposerInputBarProps } from "./ComposerInputBar.tsx";
import type { StatusBarProps } from "./StatusBar.tsx";
import { buildStatusBarProps } from "./StatusBar.tsx";
import { useComposerState, type ComposerState } from "./use-composer-state.ts";
import { useComposerSuggestions } from "./use-composer-suggestions.ts";
import { useComposerSend } from "./use-composer-send.ts";
import { useComposerStop } from "./use-composer-stop.ts";
import { useComposerStdinEscape } from "./use-composer-stdin.ts";
import { useComposerCommands } from "./use-composer-commands.ts";
import { useComposerInputHandlers } from "./use-composer-input.ts";
import { useComposerKeyboard, useComposerTabComplete } from "./use-composer-keyboard.ts";

/** View-model returned by the composer hook. */
export type ComposerView = {
  /** Status bar props. */
  statusBar: StatusBarProps;
  /** Input bar props. */
  inputBar: ComposerInputBarProps;
  /** Assist panel props. */
  assistPanel: ComposerAssistPanelProps;
};

/** Wires composer state, handlers, and keyboard shortcuts. */
export function useComposer(props: AppProps): ComposerView {
  const state = useComposerState();
  const handlers = useComposerHandlers({ state, props });
  return buildComposerView({ props, state, handlers });
}

function useComposerHandlers(input: { state: ComposerState; props: AppProps }) {
  useComposerSuggestions(input.state, input.props);
  const enqueueOrSendPrompt = useComposerSend({ state: input.state, sendMessage: input.props.sendMessage });
  useComposerStopEffects({ state: input.state, props: input.props });
  const runCommand = useComposerCommands({ state: input.state, props: input.props, enqueueOrSendPrompt });
  return useComposerInputLayer({ state: input.state, runCommand });
}

function useComposerStopEffects(options: { state: ComposerState; props: AppProps }) {
  const { handleEscapePress } = useComposerStop(options);
  useComposerStdinEscape({ handleEscapePress });
}

function useComposerInputLayer(options: { state: ComposerState; runCommand: (cmd: string) => Promise<void> }) {
  const tabComplete = useComposerTabComplete(options.state);
  useComposerKeyboard({ state: options.state, runCommand: options.runCommand, tabComplete });
  return useComposerInputHandlers(options);
}

function buildComposerView(options: {
  props: AppProps;
  state: ComposerState;
  handlers: ReturnType<typeof useComposerInputHandlers>;
}): ComposerView {
  const { props, state, handlers } = options;
  return {
    statusBar: buildStatusBarProps({ props, status: state.status, counter: props.counter }),
    inputBar: { input: state.input, onChange: handlers.handleInputChange, onSubmit: handlers.handleSubmit },
    assistPanel: {
      mode: state.mode,
      inputSuggestions: state.inputSuggestions,
      matches: state.matches,
      selectedIdx: state.selectedIdx,
      fileMentions: state.fileMentions,
      queuedPrompt: state.queuedPrompt,
    },
  };
}
