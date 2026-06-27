import { Box } from "ink";
import { MessagePane } from "./MessagePane.tsx";
import { StatusBar } from "./StatusBar.tsx";
import { ComposerInputBar } from "./ComposerInputBar.tsx";
import { ComposerAssistPanel } from "./ComposerAssistPanel.tsx";
import { useComposer } from "./use-composer.ts";
import type { AppProps } from "./app-types.ts";

export { getMessageRoleTheme, shouldAutoWrapProjectPrompt } from "./role-theme.config.ts";
export type { AppProps } from "./app-types.ts";

/** Terminal bridge Ink application root. */
export function BridgeApp(props: AppProps) {
  const view = useComposer(props);
  return (
    <Box flexDirection="column" height="100%">
      <MessagePane messages={props.messages} />
      <StatusBar {...view.statusBar} />
      <ComposerInputBar {...view.inputBar} />
      <ComposerAssistPanel {...view.assistPanel} />
    </Box>
  );
}
