import { Box } from "ink";
import { ComposerAssistPanel } from "@/terminal/tui/assist/composer-assist-panel.tsx";
import { ComposerPromptBar } from "@/terminal/tui/composer/composer-input-bar.tsx";
import { useComposer } from "@/terminal/tui/composer/use-composer.ts";
import { StatusBar } from "@/terminal/tui/status/status-bar.tsx";
import type { AppProps } from "./app-types.ts";
import { MessagePane } from "./message-pane.tsx";

export const BridgeApp = (props: AppProps) => {
  const view = useComposer(props);

  return (
    <Box flexDirection="column" height="100%">
      <MessagePane messages={props.messages} />
      <StatusBar {...view.statusBar} />
      <ComposerPromptBar {...view.inputBar} />
      <ComposerAssistPanel {...view.assistPanel} />
    </Box>
  );
};
