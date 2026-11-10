import { useCallback, useMemo } from "react";
import type { CommandSession } from "@/domain/command-types.ts";
import { readCliFailureMessage } from "@/terminal/cli-failure.ts";
import { executeCommand } from "@/terminal/slash-commands/slash-command-registry.ts";
import type { AppProps, PromptSendReport } from "@/terminal/tui/shell/app-types.ts";
import { createProjectAwarePrompt } from "@/terminal/tui/shell/project-aware-prompt.ts";
import type { ComposerStatus } from "./use-composer-state.ts";

const COMMAND_PREFIX = "/";
const READY_STATUS = "Ready";

export type ComposerCommandSettings = {
  readonly state: ComposerStatus;
  readonly props: AppProps;
  readonly enqueueOrSendPrompt: (prompt: string) => Promise<PromptSendReport>;
};

export const useComposerCommands = (settings: ComposerCommandSettings) => {
  const commandSession = useCommandScope(settings.props);
  return useRunCommand({ ...settings, commandSession: commandSession });
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

const useRunCommand = (settings: ComposerCommandSettings & { commandSession: CommandSession }) => {
  const { state: status, enqueueOrSendPrompt, commandSession } = settings;

  return useCallback(
    async (commandString: string) => {
      try {
        await executeCommandOrPrompt({
          commandLine: commandString,
          commandSession: commandSession,
          state: status,
          enqueueOrSendPrompt,
        });
      } catch (error) {
        reportCommandError({ state: status, error });
      } finally {
        status.forceRender((field) => field + 1);
      }
    },
    [commandSession, enqueueOrSendPrompt, status],
  );
};

const executeCommandOrPrompt = async (settings: {
  commandLine: string;
  commandSession: CommandSession;
  state: ComposerStatus;
  enqueueOrSendPrompt: (prompt: string) => Promise<PromptSendReport>;
}) => {
  const handled = await executeCommand(settings.commandLine, settings.commandSession);
  if (handled) {
    settings.state.setStatus(READY_STATUS);
    return;
  }

  const isSlashCommandLine = settings.commandLine.startsWith(COMMAND_PREFIX);
  if (isSlashCommandLine) {
    reportUnknownCommand({ state: settings.state, commandLine: settings.commandLine });
    return;
  }

  await sendProjectAwarePrompt(settings);
};

const sendProjectAwarePrompt = async (settings: {
  commandLine: string;
  commandSession: CommandSession;
  state: ComposerStatus;
  enqueueOrSendPrompt: (prompt: string) => Promise<PromptSendReport>;
}): Promise<void> => {
  const prompt = await createProjectAwarePrompt({
    input: settings.commandLine,
    commandSession: settings.commandSession,
  });

  const promptSendReport = await settings.enqueueOrSendPrompt(prompt);

  const isPromptSendQueued = promptSendReport === "queued";
  if (isPromptSendQueued) return;

  settings.state.setStatus(READY_STATUS);
};

const reportUnknownCommand = (details: { state: ComposerStatus; commandLine: string }) => {
  const nameSegment = details.commandLine.slice(1).split(" ")[0];

  const isNameSegmentMissing = nameSegment == null || nameSegment === "";
  const name = isNameSegmentMissing ? COMMAND_PREFIX : nameSegment;

  details.state.setStatus(`Unknown command: ${COMMAND_PREFIX}${name}`);
  console.error(`Unknown command: ${COMMAND_PREFIX}${name}`);
};

const reportCommandError = (details: { state: ComposerStatus; error: unknown }) => {
  const commandError = details.error;
  const message = readCliFailureMessage(commandError);
  details.state.setStatus(`Error: ${message}`);
  console.error(message);
};
