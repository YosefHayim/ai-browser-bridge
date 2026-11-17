import { saveSettings } from "@/bridge-engine/repo-settings.ts";
import type { BridgeSettings } from "@/bridge-types.ts";
import type { Message } from "@/message-types.ts";
import type { TokenCounter } from "@/orchestrator/context-counter.ts";
import type { Orchestrator, OrchestratorEvent } from "@/orchestrator/orchestrator.ts";
import { readErrorMessage } from "@/read-error-message.ts";
import { appendBridgeLog } from "@/repo-files/logging.ts";
import { readSessionsDirectory } from "@/repo-files/paths.ts";
import { appendSessionEvent, MESSAGE_EVENT_TYPE, updateSession } from "@/sessions/session-store.ts";

interface SessionStore {
  baseDir: string;
}

interface PersistMessageDetails {
  bridgeSettings: BridgeSettings;
  getSessionId: () => string;
  message: Message;
  sessionStore: SessionStore;
  log: (line: string) => void;
}

interface PersistModelChangeDetails {
  bridgeSettings: BridgeSettings;
  getSessionId: () => string;
  model: string;
  contextLimit: number;
  sessionStore: SessionStore;
  log: (line: string) => void;
}

export interface PersistenceListenerDetails {
  orchestrator: Orchestrator;
  counter: TokenCounter;
  bridgeSettings: BridgeSettings;
  getSessionId: () => string;
  persistent: boolean;
  log: (line: string) => void;
}

async function persistMessageEvent(details: PersistMessageDetails): Promise<void> {
  const sessionId = details.getSessionId();
  const logType = `chatgpt_${details.message.role}_message`;

  try {
    await appendBridgeLog({
      repoPath: details.bridgeSettings.repoPath,
      type: logType,
      data: { content: details.message.content },
    });
    await appendSessionEvent(
      sessionId,
      {
        type: MESSAGE_EVENT_TYPE,
        role: details.message.role,
        content: details.message.content,
        data: { messageId: details.message.id },
      },
      details.sessionStore,
    );
  } catch (error) {
    const reason = readErrorMessage(error);
    details.log(`Session log: could not save a message (${reason}).`);
  }
}

async function persistModelChange(details: PersistModelChangeDetails): Promise<void> {
  const sessionId = details.getSessionId();

  try {
    await saveSettings(details.bridgeSettings);
    await updateSession(
      sessionId,
      { model: details.model, contextLimit: details.contextLimit },
      details.sessionStore,
    );
  } catch (error) {
    const reason = readErrorMessage(error);
    details.log(`Session log: could not save the model change (${reason}).`);
  }
}

export function attachPersistenceListener(details: PersistenceListenerDetails): void {
  const sessionStore = { baseDir: readSessionsDirectory(details.bridgeSettings.repoPath) };

  function listenToEvent(event: OrchestratorEvent): void {
    const isEventTypeMessage = event.type === MESSAGE_EVENT_TYPE;
    if (isEventTypeMessage) {
      details.counter.add(event.message);

      const isNotPersistent = !details.persistent;
      if (isNotPersistent) return;

      void persistMessageEvent({
        bridgeSettings: details.bridgeSettings,
        getSessionId: details.getSessionId,
        message: event.message,
        sessionStore,
        log: details.log,
      });
      return;
    }

    const isEventTypeConversationSynced = event.type === "conversation_synced";
    if (isEventTypeConversationSynced) {
      details.counter.reset();
      for (const message of event.messages) details.counter.add(message);
      return;
    }

    const isEventTypeReset = event.type === "reset";
    if (isEventTypeReset) {
      details.counter.reset();
      return;
    }

    const isEventTypeModelChanged = event.type === "model_changed";
    if (isEventTypeModelChanged) {
      details.counter.setModel(event.model);
      details.bridgeSettings.model = event.model;
      details.bridgeSettings.contextLimit = event.contextLimit;

      const isSessionTransient = !details.persistent;
      if (isSessionTransient) return;

      void persistModelChange({
        bridgeSettings: details.bridgeSettings,
        getSessionId: details.getSessionId,
        model: event.model,
        contextLimit: event.contextLimit,
        sessionStore,
        log: details.log,
      });
    }
  }

  details.orchestrator.subscribe(listenToEvent);
}
