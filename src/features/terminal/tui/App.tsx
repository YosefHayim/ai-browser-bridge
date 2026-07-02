import { Box } from "ink";
import { ComposerAssistPanel } from "./ComposerAssistPanel.tsx";
import { ComposerInputBar } from "./ComposerInputBar.tsx";
import { MessagePane } from "./MessagePane.tsx";
import { StatusBar } from "./StatusBar.tsx";
import type { AppProps } from "./appTypes.ts";
import { useComposer } from "./useComposer.ts";

export { getMessageRoleTheme, shouldAutoWrapProjectPrompt } from "./roleThemeConfig.ts";
export type { AppProps } from "./appTypes.ts";

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
