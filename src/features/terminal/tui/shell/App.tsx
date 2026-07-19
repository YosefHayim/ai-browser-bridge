import { Box } from "ink";
import { ComposerAssistPanel } from "../assist/ComposerAssistPanel.tsx";
import { ComposerInputBar } from "../composer/ComposerInputBar.tsx";
import { useComposer } from "../composer/useComposer.ts";
import { StatusBar } from "../status/StatusBar.tsx";
import { MessagePane } from "./MessagePane.tsx";
import type { AppProps } from "./appTypes.ts";

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
