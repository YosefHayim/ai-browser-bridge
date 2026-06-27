import { saveConfig } from "./load-config.ts";
import { appendBridgeLog } from "../store/logging.ts";
import { appendSessionEvent, updateSession } from "../store/session-store.ts";
import { sessionsDir } from "../store/paths.ts";
import type { BridgeConfig, Message } from "../domain/types.ts";
import type { Orchestrator } from "./orchestrator.ts";
import type { ContextCounter } from "./context-counter.ts";

/** Context for wiring orchestrator events to durable persistence. */
export interface AttachPersistenceListenerContext {
  /** Browser automation coordinator. */
  orchestrator: Orchestrator;
  /** Running context token counter. */
  counter: ContextCounter;
  /** Effective bridge configuration. */
  config: BridgeConfig;
  /** Lazy session id reader so {@link Engine.setSessionId} is honoured. */
  getSessionId: () => string;
}

/** Wire orchestrator events to context counting, bridge logs, and session events. */
export function attachPersistenceListener(ctx: AttachPersistenceListenerContext): void {
  const sessionStore = { baseDir: sessionsDir(ctx.config.repoPath) };
  ctx.orchestrator.on((event) => {
    if (event.type === "message") handleMessageEvent({ ...ctx, sessionStore, message: event.message });
    if (event.type === "conversation_synced") handleConversationSynced({ ...ctx, messages: event.messages });
    if (event.type === "reset") ctx.counter.reset();
    if (event.type === "model_changed") handleModelChanged({ ...ctx, sessionStore, model: event.model, contextLimit: event.contextLimit });
  });
}

/** Context for handling a message persistence event. */
interface HandleMessageEventContext extends AttachPersistenceListenerContext {
  /** Session store options. */
  sessionStore: { baseDir: string };
  /** Message to persist. */
  message: Message;
}

/** Persist one chat message to logs and session events. */
function handleMessageEvent(ctx: HandleMessageEventContext): void {
  ctx.counter.add(ctx.message);
  appendBridgeLog({
    repoPath: ctx.config.repoPath,
    type: `chatgpt_${ctx.message.role}_message`,
    data: { content: ctx.message.content },
  }).catch(() => {});
  appendSessionEvent(ctx.getSessionId(), {
    type: "message",
    role: ctx.message.role,
    content: ctx.message.content,
    data: { messageId: ctx.message.id },
  }, ctx.sessionStore).catch(() => {});
}

/** Context for resetting the counter from synced messages. */
interface HandleConversationSyncedContext extends AttachPersistenceListenerContext {
  /** Messages read from the browser DOM. */
  messages: Message[];
}

/** Reset counter from a synced conversation transcript. */
function handleConversationSynced(ctx: HandleConversationSyncedContext): void {
  ctx.counter.reset();
  for (const message of ctx.messages) ctx.counter.add(message);
}

/** Context for handling a model_changed persistence event. */
interface HandleModelChangedContext extends AttachPersistenceListenerContext {
  /** Session store options. */
  sessionStore: { baseDir: string };
  /** New model label. */
  model: string;
  /** New context window limit. */
  contextLimit: number;
}

/** Persist model and context limit changes to config and session metadata. */
function handleModelChanged(ctx: HandleModelChangedContext): void {
  ctx.counter.setModel(ctx.model);
  ctx.config.model = ctx.model;
  ctx.config.contextLimit = ctx.contextLimit;
  saveConfig(ctx.config).catch(() => {});
  updateSession(ctx.getSessionId(), { model: ctx.model, contextLimit: ctx.contextLimit }, ctx.sessionStore).catch(() => {});
}
