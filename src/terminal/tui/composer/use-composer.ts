import type { ComposerAssistPanelProps } from "@/terminal/tui/assist/composer-assist-panel.tsx";
import type { AppProps } from "@/terminal/tui/shell/app-types.ts";
import type { StatusBarProps } from "@/terminal/tui/status/status-bar.tsx";
import { readStatusBarProps } from "@/terminal/tui/status/status-bar-state.ts";
import type { ComposerPromptBarProps } from "./composer-input-bar.tsx";
import { useComposerCommands } from "./use-composer-commands.ts";
import { useComposerPromptHandlers } from "./use-composer-input.ts";
import { useComposerKeyboard, useComposerTabComplete } from "./use-composer-keyboard.ts";
import { useComposerSend } from "./use-composer-send.ts";
import { type ComposerStatus, useComposerStatus } from "./use-composer-state.ts";
import { useComposerStdinEscape } from "./use-composer-stdin.ts";
import { useComposerStop } from "./use-composer-stop.ts";
import { useComposerSuggestions } from "./use-composer-suggestions.ts";

export type ComposerView = {
  readonly statusBar: StatusBarProps;
  readonly inputBar: ComposerPromptBarProps;
  readonly assistPanel: ComposerAssistPanelProps;
};

export const useComposer = (props: AppProps): ComposerView => {
  const status = useComposerStatus();
  const handlers = useComposerHandlers({ state: status, props });
  return readComposerView({ props, state: status, handlers });
};

const useComposerHandlers = (details: { state: ComposerStatus; props: AppProps }) => {
  useComposerSuggestions(details.state, details.props);
  const enqueueOrSendPrompt = useComposerSend({
    state: details.state,
    sendMessage: details.props.sendMessage,
  });
  useComposerStopEffects({ state: details.state, props: details.props });
  const runCommand = useComposerCommands({
    state: details.state,
    props: details.props,
    enqueueOrSendPrompt,
  });
  return useComposerPromptLayer({ state: details.state, runCommand });
};

const useComposerStopEffects = (settings: { state: ComposerStatus; props: AppProps }) => {
  const { handleEscapePress } = useComposerStop(settings);
  useComposerStdinEscape({ handleEscapePress });
};

const useComposerPromptLayer = (settings: {
  state: ComposerStatus;
  runCommand: (commandString: string) => Promise<void>;
}) => {
  const tabComplete = useComposerTabComplete(settings.state);
  useComposerKeyboard({ state: settings.state, runCommand: settings.runCommand, tabComplete });
  return useComposerPromptHandlers(settings);
};

const readComposerView = (settings: {
  props: AppProps;
  state: ComposerStatus;
  handlers: ReturnType<typeof useComposerPromptHandlers>;
}): ComposerView => {
  const { props, state: composerStatus, handlers } = settings;
  return {
    statusBar: readStatusBarProps({ props, status: composerStatus.status, counter: props.counter }),
    inputBar: {
      input: composerStatus.input,
      onChange: handlers.handleInputChange,
      onSubmit: handlers.handleSubmit,
    },
    assistPanel: {
      mode: composerStatus.mode,
      inputSuggestions: composerStatus.inputSuggestions,
      matches: composerStatus.matches,
      selectedIndex: composerStatus.selectedIndex,
      fileMentions: composerStatus.fileMentions,
      queuedPrompt: composerStatus.queuedPrompt,
    },
  };
};
