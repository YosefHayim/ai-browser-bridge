import type { Page } from "playwright";
import type { BrowserProvider } from "../providers/create-provider.factory.ts";
import type { OrchestratorEvent } from "./orchestrator.types.ts";

/** Context bundle for orchestrator helper calls. */
export interface OrchestratorClassContext {
  page: Page | null;
  provider: BrowserProvider;
  modelName: string;
  emit: (event: OrchestratorEvent) => void;
}

/** Build detect-model context for the orchestrator class. */
export function detectCtx(ctx: OrchestratorClassContext) {
  return { page: ctx.page, provider: ctx.provider, modelName: ctx.modelName, emit: ctx.emit };
}

/** Build sync context for conversation message reads. */
export function syncCtx(ctx: Omit<OrchestratorClassContext, "modelName">) {
  return { page: ctx.page, provider: ctx.provider, emit: ctx.emit };
}

/** Build emit callback for the orchestrator class. */
export function classEmit(emit: (event: OrchestratorEvent) => void) {
  return (event: OrchestratorEvent) => emit(event);
}
