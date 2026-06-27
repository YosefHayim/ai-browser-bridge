import type { ModelOption } from "../domain/types.ts";
import type { OrchestratorEvent } from "./orchestrator.types.ts";
import { emitModelChanged } from "./orchestrator.model.events.ts";

/** Context for applying selected model from a model list. */
export interface ApplySelectedModelContext {
  models: ModelOption[];
  emit: (event: OrchestratorEvent) => void;
}

/** Return selected model label when present in a model list response. */
export function applySelectedModel(ctx: ApplySelectedModelContext): string | null {
  const selected = ctx.models.find((model) => model.selected);
  if (!selected) return null;
  emitModelChanged({ emit: ctx.emit, modelName: selected.label });
  return selected.label;
}
