import { findModelProfile } from "../domain/models.config.ts";
import type { OrchestratorEvent } from "./orchestrator.types.ts";

/** Emit model_changed for a model label. */
export function emitModelChanged(ctx: { emit: (event: OrchestratorEvent) => void; modelName: string }): void {
  const profile = findModelProfile(ctx.modelName);
  ctx.emit({ type: "model_changed", model: ctx.modelName, contextLimit: profile.contextWindow });
}

/** Context for emitting model detection status. */
export interface EmitModelDetectedContext {
  emit: (event: OrchestratorEvent) => void;
  modelName: string;
}

/** Emit status and model_changed after detection. */
export function emitModelDetected(ctx: EmitModelDetectedContext): void {
  const profile = findModelProfile(ctx.modelName);
  ctx.emit({ type: "status", text: `Model: ${ctx.modelName}` });
  ctx.emit({ type: "model_changed", model: ctx.modelName, contextLimit: profile.contextWindow });
}
