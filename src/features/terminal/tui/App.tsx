export { getMessageRoleTheme, shouldAutoWrapProjectPrompt } from "./roleThemeConfig.ts";
export type { AppProps } from "./appTypes.ts";

import { Box } from "ink";
import { ComposerAssistPanel } from "./ComposerAssistPanel.tsx";
import { ComposerInputBar } from "./ComposerInputBar.tsx";
import { MessagePane } from "./MessagePane.tsx";
import { StatusBar } from "./StatusBar.tsx";
import type { AppProps } from "./appTypes.ts";
import { useComposer } from "./useComposer.ts";

/**
 * Terminal bridge Ink application root.
 *
 * @param props - Props passed to the component.
 * @returns The rendered component.
 * @example
 * ```tsx
 * const node = <BridgeApp {...props} />;
 * ```
 */
export const BridgeApp = (props: AppProps) => {
  const view = useComposer(props);
  return (
    <Box flexDirection="column" height="100%">
      <MessagePane messages={props.messages} />
      <StatusBar {...view.statusBar} />
      <ComposerInputBar {...view.inputBar} />
      <ComposerAssistPanel {...view.assistPanel} />
    </Box>
  );
};
