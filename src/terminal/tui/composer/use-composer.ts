import type { ComposerAssistPanelProps } from "@/terminal/tui/assist/composer-assist-panel.tsx";
import type { ComposerPromptBarProps } from "@/terminal/tui/composer/composer-input-bar.tsx";
import { useComposerCommands } from "@/terminal/tui/composer/use-composer-commands.ts";
import { useComposerPromptHandlers } from "@/terminal/tui/composer/use-composer-input.ts";
import {
  useComposerKeyboard,
  useComposerTabComplete,
} from "@/terminal/tui/composer/use-composer-keyboard.ts";
import { useComposerSend } from "@/terminal/tui/composer/use-composer-send.ts";
import {
  type ComposerStatus,
  useComposerStatus,
} from "@/terminal/tui/composer/use-composer-state.ts";
import { useComposerStop } from "@/terminal/tui/composer/use-composer-stop.ts";
import { useComposerSuggestions } from "@/terminal/tui/composer/use-composer-suggestions.ts";
import type { AppProps } from "@/terminal/tui/shell/app-types.ts";
import type { StatusBarProps } from "@/terminal/tui/status/status-bar.tsx";
import { readStatusBarProps } from "@/terminal/tui/status/status-bar-state.ts";

export type ComposerView = {
  readonly statusBar: StatusBarProps;
  readonly inputBar: ComposerPromptBarProps;
  readonly assistPanel: ComposerAssistPanelProps;
};

export function useComposer(props: AppProps): ComposerView {
  const status = useComposerStatus();
  const handlers = useComposerHandlers({ state: status, props });
  return readComposerView({ props, state: status, handlers });
}

function useComposerHandlers(details: { state: ComposerStatus; props: AppProps }) {
  useComposerSuggestions(details.state, details.props);

  const enqueueOrSendPrompt = useComposerSend({
    state: details.state,
    sendMessage: details.props.sendMessage,
  });

  const { handleEscapePress } = useComposerStop({ state: details.state, props: details.props });

  const runCommand = useComposerCommands({
    state: details.state,
    props: details.props,
    enqueueOrSendPrompt,
  });

  return useComposerPromptLayer({ state: details.state, runCommand, handleEscapePress });
}

function useComposerPromptLayer(settings: {
  state: ComposerStatus;
  runCommand: (commandString: string) => Promise<void>;
  handleEscapePress: () => void;
}) {
  const tabComplete = useComposerTabComplete(settings.state);
  useComposerKeyboard({
    state: settings.state,
    runCommand: settings.runCommand,
    tabComplete,
    handleEscapePress: settings.handleEscapePress,
  });
  return useComposerPromptHandlers(settings);
}

function readComposerView(settings: {
  props: AppProps;
  state: ComposerStatus;
  handlers: ReturnType<typeof useComposerPromptHandlers>;
}): ComposerView {
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
      promptSuggestions: composerStatus.promptSuggestions,
      matches: composerStatus.matches,
      selectedIndex: composerStatus.selectedIndex,
      fileMentions: composerStatus.fileMentions,
      queuedPrompt: composerStatus.queuedPrompt,
    },
  };
}
