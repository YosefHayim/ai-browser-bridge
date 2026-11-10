import { useCallback, useMemo } from "react";
import type { CommandSession } from "@/domain/command-types.ts";
import { executeCommand } from "@/terminal/cli-operations.ts";
import type { AppProps, PromptSendReport } from "@/terminal/tui/shell/app-types.ts";
import { createProjectAwarePrompt } from "@/terminal/tui/shell/project-aware-prompt.ts";
import type { ComposerStatus } from "./use-composer-state.ts";

export type ComposerCommandSettings = {
  readonly state: ComposerStatus;
  readonly props: AppProps;
  readonly enqueueOrSendPrompt: (prompt: string) => Promise<PromptSendReport>;
};

export const useComposerCommands = (settings: ComposerCommandSettings) => {
  const commandScope = useCommandScope(settings.props);
  return useRunCommand({ ...settings, ctx: commandScope });
};

const useCommandScope = (props: AppProps): CommandSession => {
  return useMemo(
    () => ({
      config: props.config,
      messages: props.messages,
      sendMessage: props.sendMessage,
      clearMessages: props.clearMessages,
      shutdown: props.shutdown,
      counter: props.counter,
      orchestrator: props.orchestrator,
      permission: props.permission,
      session: props.session,
      statusline: props.statusline,
    }),
    [props],
  );
};

const useRunCommand = (settings: ComposerCommandSettings & { ctx: CommandSession }) => {
  const { state: status, enqueueOrSendPrompt, ctx: commandScope } = settings;

  return useCallback(
    async (commandString: string) => {
      try {
        await executeCommandOrPrompt({
          commandLine: commandString,
          ctx: commandScope,
          state: status,
          enqueueOrSendPrompt,
        });
      } catch (error) {
        reportCommandError({ state: status, error });
      } finally {
        status.forceRender((field) => field + 1);
      }
    },
    [commandScope, enqueueOrSendPrompt, status],
  );
};

const executeCommandOrPrompt = async (settings: {
  commandLine: string;
  ctx: CommandSession;
  state: ComposerStatus;
  enqueueOrSendPrompt: (prompt: string) => Promise<PromptSendReport>;
}) => {
  const handled = await executeCommand(settings.commandLine, settings.ctx);
  if (handled) {
    settings.state.setStatus("Ready");
    return;
  }

  const isSlashCommandLine = settings.commandLine.startsWith("/");
  if (isSlashCommandLine) {
    reportUnknownCommand({ state: settings.state, commandLine: settings.commandLine });
    return;
  }

  await sendProjectAwarePrompt(settings);
};

const sendProjectAwarePrompt = async (settings: {
  commandLine: string;
  ctx: CommandSession;
  state: ComposerStatus;
  enqueueOrSendPrompt: (prompt: string) => Promise<PromptSendReport>;
}): Promise<void> => {
  const prompt = await createProjectAwarePrompt({ input: settings.commandLine, ctx: settings.ctx });

  const promptSendReport = await settings.enqueueOrSendPrompt(prompt);

  const isPromptSendQueued = promptSendReport === "queued";
  if (isPromptSendQueued) return;

  settings.state.setStatus("Ready");
};

const reportUnknownCommand = (details: { state: ComposerStatus; commandLine: string }) => {
  const nameSegment = details.commandLine.slice(1).split(" ")[0];

  let name = nameSegment;
  if (name == null || name === "") name = "/";

  details.state.setStatus(`Unknown command: /${name}`);
  console.error(`Unknown command: /${name}`);
};

const reportCommandError = (details: { state: ComposerStatus; error: unknown }) => {
  const isErrorObject = details.error instanceof Error;
  const message = isErrorObject ? details.error.message : String(details.error);
  details.state.setStatus(`Error: ${message}`);
  console.error(message);
};
