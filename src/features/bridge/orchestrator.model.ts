import type { Page } from "playwright";
import type { ModelOption } from "../domain/types.ts";
import type { BrowserProvider } from "../providers/create-provider.factory.ts";
import type { OrchestratorEvent } from "./orchestrator.types.ts";
import { applySelectedModel } from "./orchestrator.model.select.ts";
import { emitModelChanged, emitModelDetected } from "./orchestrator.model.events.ts";

/** Context for detecting the current browser model. */
export interface DetectModelContext {
  page: Page | null;
  provider: BrowserProvider;
  modelName: string;
  emit: (event: OrchestratorEvent) => void;
}

/** Detect the current browser model and emit status/model_changed events. */
export async function detectModel(ctx: DetectModelContext): Promise<string> {
  if (!ctx.page) return ctx.modelName;
  const detected = await ctx.provider.detectCurrentModel(ctx.page);
  const nextName = resolveDetectedModelName({ current: ctx.modelName, detected, placeholder: ctx.provider.defaultModel, provider: ctx.provider });
  emitModelDetected({ emit: ctx.emit, modelName: nextName });
  return nextName;
}

/** Context for resolving a detected model name. */
interface ResolveDetectedModelNameContext {
  current: string;
  detected: string;
  placeholder: string;
  provider: BrowserProvider;
}

/** Resolve the model name after provider detection. */
function resolveDetectedModelName(ctx: ResolveDetectedModelNameContext): string {
  if (ctx.detected !== ctx.placeholder) return ctx.detected;
  if (!ctx.provider.isLikelyModelLabel(ctx.current)) return ctx.placeholder;
  return ctx.current;
}

/** Context for listing models from the browser UI. */
export interface ListModelsActionContext {
  page: Page;
  provider: BrowserProvider;
  emit: (event: OrchestratorEvent) => void;
  setModelName: (name: string) => void;
}

/** List models and apply the selected model label when present. */
export async function listModelsAction(ctx: ListModelsActionContext): Promise<ModelOption[]> {
  const models = await ctx.provider.listAvailableModels(ctx.page);
  const selected = applySelectedModel({ models, emit: ctx.emit });
  if (selected) ctx.setModelName(selected);
  return models;
}

/** Context for switching models through the browser UI. */
export interface SwitchModelContext {
  page: Page;
  provider: BrowserProvider;
  query: string;
  emit: (event: OrchestratorEvent) => void;
}

/** Switch model via provider UI and emit status events. */
export async function switchModelAction(ctx: SwitchModelContext): Promise<string> {
  ctx.emit({ type: "status", text: `Switching model to ${ctx.query}...` });
  const modelName = await ctx.provider.selectModel(ctx.page, ctx.query);
  emitModelChanged({ emit: ctx.emit, modelName });
  ctx.emit({ type: "status", text: `Model: ${modelName}` });
  return modelName;
}
