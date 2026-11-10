import type { ComposerAssistPanelProps } from "@/terminal/tui/assist/composer-assist-panel.tsx";
import type { AppProps } from "@/terminal/tui/shell/app-types.ts";
import type { StatusBarProps } from "@/terminal/tui/status/status-bar.tsx";
import { statusBarProps } from "@/terminal/tui/status/status-bar-state.ts";
import type { ComposerInputBarProps } from "./composer-input-bar.tsx";
import { useComposerCommands } from "./use-composer-commands.ts";
import { useComposerInputHandlers } from "./use-composer-input.ts";
import { useComposerKeyboard, useComposerTabComplete } from "./use-composer-keyboard.ts";
import { useComposerSend } from "./use-composer-send.ts";
import { type ComposerState, useComposerState } from "./use-composer-state.ts";
import { useComposerStdinEscape } from "./use-composer-stdin.ts";
import { useComposerStop } from "./use-composer-stop.ts";
import { useComposerSuggestions } from "./use-composer-suggestions.ts";

export type ComposerView = {
  readonly statusBar: StatusBarProps;
  readonly inputBar: ComposerInputBarProps;
  readonly assistPanel: ComposerAssistPanelProps;
};

export const useComposer = (props: AppProps): ComposerView => {
  const state = useComposerState();
  const handlers = useComposerHandlers({ state, props });
  return composerView({ props, state, handlers });
};

const useComposerHandlers = (input: { state: ComposerState; props: AppProps }) => {
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
};

const useComposerStopEffects = (options: { state: ComposerState; props: AppProps }) => {
  const { handleEscapePress } = useComposerStop(options);
  useComposerStdinEscape({ handleEscapePress });
};

const useComposerInputLayer = (options: {
  state: ComposerState;
  runCommand: (commandText: string) => Promise<void>;
}) => {
  const tabComplete = useComposerTabComplete(options.state);
  useComposerKeyboard({ state: options.state, runCommand: options.runCommand, tabComplete });
  return useComposerInputHandlers(options);
};

const composerView = (options: {
  props: AppProps;
  state: ComposerState;
  handlers: ReturnType<typeof useComposerInputHandlers>;
}): ComposerView => {
  const { props, state, handlers } = options;
  return {
    statusBar: statusBarProps({ props, status: state.status, counter: props.counter }),
    inputBar: {
      input: state.input,
      onChange: handlers.handleInputChange,
      onSubmit: handlers.handleSubmit,
    },
    assistPanel: {
      mode: state.mode,
      inputSuggestions: state.inputSuggestions,
      matches: state.matches,
      selectedIndex: state.selectedIndex,
      fileMentions: state.fileMentions,
      queuedPrompt: state.queuedPrompt,
    },
  };
};
