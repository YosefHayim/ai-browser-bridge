import type { ComposerAssistPanelProps } from "./ComposerAssistPanel.tsx";
import type { ComposerInputBarProps } from "./ComposerInputBar.tsx";
import type { StatusBarProps } from "./StatusBar.tsx";
import { buildStatusBarProps } from "./StatusBar.tsx";
import type { AppProps } from "./appTypes.ts";
import { useComposerCommands } from "./useComposerCommands.ts";
import { useComposerInputHandlers } from "./useComposerInput.ts";
import { useComposerKeyboard, useComposerTabComplete } from "./useComposerKeyboard.ts";
import { useComposerSend } from "./useComposerSend.ts";
import { type ComposerState, useComposerState } from "./useComposerState.ts";
import { useComposerStdinEscape } from "./useComposerStdin.ts";
import { useComposerStop } from "./useComposerStop.ts";
import { useComposerSuggestions } from "./useComposerSuggestions.ts";

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
  const enqueueOrSendPrompt = useComposerSend({
    state: input.state,
    sendMessage: input.props.sendMessage,
  });
  useComposerStopEffects({ state: input.state, props: input.props });
  const runCommand = useComposerCommands({
    state: input.state,
    props: input.props,
    enqueueOrSendPrompt,
  });
  return useComposerInputLayer({ state: input.state, runCommand });
}

function useComposerStopEffects(options: { state: ComposerState; props: AppProps }) {
  const { handleEscapePress } = useComposerStop(options);
  useComposerStdinEscape({ handleEscapePress });
}

function useComposerInputLayer(options: {
  state: ComposerState;
  runCommand: (cmd: string) => Promise<void>;
}) {
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
    inputBar: {
      input: state.input,
      onChange: handlers.handleInputChange,
      onSubmit: handlers.handleSubmit,
    },
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
